//! Encodes BYOK provider output as Cursor RunInference server messages.
use std::collections::BTreeMap;

use crate::{
    cursor::protocol::proto::aiserver::v1::{
        inference_stream_response::Response, run_inference_server_message::Message,
        InferenceExtendedUsageInfo, InferenceInvocationIdInfo, InferenceRequestedModel,
        InferenceStreamResponse, InferenceTextStreamPart, InferenceThinkingStreamPart,
        InferenceToolCallStreamPart, InferenceUsageInfo, RunInferenceHeartbeat,
        RunInferenceInvocationEnd, RunInferenceInvocationError, RunInferenceInvocationResponse,
        RunInferencePromptModelMetadata, RunInferenceRunReady, RunInferenceServerMessage,
    },
    model::{ModelSpec, ProviderType, Usage},
    provider::ModelEvent,
};

use super::replay;

/// Connect status codes carried in `RunInferenceInvocationError.code`.
const CODE_CANCELED: i32 = 1;
const CODE_INTERNAL: i32 = 13;
/// Prompt families Cursor's harness recognizes; anything else falls back to its defaults.
const PROMPT_VERSION: &str = "latest";
const REASONING_EFFORTS: [&str; 6] = ["low", "medium", "high", "extra-high", "xhigh", "max"];

pub fn run_ready(
    requested: &InferenceRequestedModel,
    provider: ProviderType,
    model: &ModelSpec,
) -> RunInferenceServerMessage {
    let vendor = match provider {
        ProviderType::Anthropic => "anthropic",
        ProviderType::OpenAiChat | ProviderType::OpenAiResponses => "openai",
        ProviderType::Plugin => "unknown",
    };
    server(Message::RunReady(RunInferenceRunReady {
        resolved_model: Some(requested.clone()),
        prompt_model_metadata: Some(RunInferencePromptModelMetadata {
            vendor: vendor.into(),
            prompt_version: PROMPT_VERSION.into(),
            reasoning_effort: model
                .reasoning
                .effort
                .as_deref()
                .filter(|effort| REASONING_EFFORTS.contains(effort))
                .map(str::to_owned),
            // Cursor's client loop sizes compaction and the context ring from this limit.
            agent_token_limit: model.context_window_tokens.map(tokens),
            ..Default::default()
        }),
        accepts_client_heartbeat: true,
        ..Default::default()
    }))
}

pub fn heartbeat() -> RunInferenceServerMessage {
    server(Message::Heartbeat(RunInferenceHeartbeat::default()))
}

pub fn invocation_end(
    invocation_id: &str,
    failure: Option<(bool, String)>,
) -> RunInferenceServerMessage {
    server(Message::InvocationEnd(RunInferenceInvocationEnd {
        invocation_id: invocation_id.into(),
        error: failure.map(|(canceled, message)| RunInferenceInvocationError {
            code: if canceled {
                CODE_CANCELED
            } else {
                CODE_INTERNAL
            },
            message,
            ..Default::default()
        }),
        delta_refused: None,
    }))
}

/// Streams one invocation's provider events as `InvocationResponse` messages.
pub struct ResponseEncoder {
    invocation_id: String,
    context_window: Option<u64>,
    calls: BTreeMap<usize, ToolCallState>,
}

struct ToolCallState {
    call_id: String,
    name: String,
    arguments: String,
}

impl ResponseEncoder {
    pub fn new(invocation_id: impl Into<String>, context_window: Option<u64>) -> Self {
        Self {
            invocation_id: invocation_id.into(),
            context_window,
            calls: BTreeMap::new(),
        }
    }

    /// Names the invocation before any output; without it Cursor's client invents its own id
    /// and logs "Invocation ID mismatch" after every step.
    pub fn opening(&self) -> RunInferenceServerMessage {
        self.wrap(Response::InvocationId(InferenceInvocationIdInfo {
            invocation_id: self.invocation_id.clone(),
        }))
    }

    pub fn encode(&mut self, event: ModelEvent) -> Vec<RunInferenceServerMessage> {
        self.responses(event)
            .into_iter()
            .map(|response| self.wrap(response))
            .collect()
    }

    fn wrap(&self, response: Response) -> RunInferenceServerMessage {
        server(Message::InvocationResponse(
            RunInferenceInvocationResponse {
                invocation_id: self.invocation_id.clone(),
                response: Some(InferenceStreamResponse {
                    first_output_timing: None,
                    response: Some(response),
                }),
            },
        ))
    }

    fn responses(&mut self, event: ModelEvent) -> Vec<Response> {
        match event {
            ModelEvent::TextDelta(text) if !text.is_empty() => {
                vec![Response::TextPart(InferenceTextStreamPart {
                    text,
                    is_final: false,
                })]
            }
            ModelEvent::ThinkingDelta(text) if !text.is_empty() => {
                vec![Response::ThinkingPart(InferenceThinkingStreamPart {
                    text,
                    ..Default::default()
                })]
            }
            ModelEvent::ProviderReplayState(state) => {
                vec![Response::ThinkingPart(InferenceThinkingStreamPart {
                    redacted_data: Some(replay::encode(&state)),
                    ..Default::default()
                })]
            }
            ModelEvent::ToolCallStart {
                index,
                call_id,
                name,
            } => {
                self.calls.insert(
                    index,
                    ToolCallState {
                        call_id: call_id.clone(),
                        name: name.clone(),
                        arguments: String::new(),
                    },
                );
                vec![tool_part(&call_id, &name, String::new(), false, index)]
            }
            ModelEvent::ToolCallArgumentsDelta { index, delta } => {
                let Some(call) = self.calls.get_mut(&index) else {
                    return Vec::new();
                };
                call.arguments.push_str(&delta);
                vec![tool_part(&call.call_id, "", delta, false, index)]
            }
            ModelEvent::ToolCallEnd { index } => {
                let Some(call) = self.calls.remove(&index) else {
                    return Vec::new();
                };
                let arguments = if call.arguments.trim().is_empty() {
                    "{}".to_owned()
                } else {
                    call.arguments
                };
                vec![tool_part(&call.call_id, &call.name, arguments, true, index)]
            }
            ModelEvent::Usage(usage) => usage_parts(&usage, self.context_window),
            ModelEvent::Done(_) => {
                vec![Response::TextPart(InferenceTextStreamPart {
                    text: String::new(),
                    is_final: true,
                })]
            }
            ModelEvent::Start { .. }
            | ModelEvent::TextStart
            | ModelEvent::TextDelta(_)
            | ModelEvent::TextEnd
            | ModelEvent::ThinkingStart
            | ModelEvent::ThinkingDelta(_)
            | ModelEvent::ThinkingEnd => Vec::new(),
        }
    }
}

fn tool_part(call_id: &str, name: &str, args: String, complete: bool, index: usize) -> Response {
    Response::ToolCallPart(InferenceToolCallStreamPart {
        tool_call_id: call_id.into(),
        tool_name: name.into(),
        args,
        is_complete: complete,
        tool_index: i32::try_from(index).ok(),
        call_signature: None,
    })
}

fn usage_parts(usage: &Usage, context_window: Option<u64>) -> Vec<Response> {
    let count = |value: Option<u64>| value.map_or(0, tokens);
    let input = usage.context_input_tokens.or(usage.input_tokens);
    vec![
        Response::Usage(InferenceUsageInfo {
            prompt_tokens: count(input),
            completion_tokens: count(usage.output_tokens),
            total_tokens: usage.total_tokens.map(tokens),
        }),
        Response::ExtendedUsage(InferenceExtendedUsageInfo {
            input_tokens: count(input),
            output_tokens: count(usage.output_tokens),
            cache_read_tokens: count(usage.cache_read_tokens),
            cache_write_tokens: count(usage.cache_write_tokens),
            max_tokens: count(context_window),
            reasoning_tokens: usage.reasoning_tokens.map(tokens),
        }),
    ]
}

fn tokens(value: u64) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

fn server(message: Message) -> RunInferenceServerMessage {
    RunInferenceServerMessage {
        message: Some(message),
    }
}
