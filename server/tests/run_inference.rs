//! Drives Cursor's RunInference protocol (RunInferenceSSE + BidiAppend) through the router.
#[path = "support/fake_provider.rs"]
mod fake_provider;
#[path = "support/fixtures.rs"]
mod fixtures;

use std::sync::Arc;

use axum::{
    body::{to_bytes, Body},
    http::{header, Request, StatusCode},
    Router,
};
use cursor_server::{
    api::cursor,
    cursor::{
        prompting::{PromptAssets, PromptCompiler},
        protocol::{
            connect,
            proto::aiserver::v1::{
                self as ai, inference_content_part, inference_core_message,
                inference_stream_response, run_inference_client_message::Message as Client,
                run_inference_server_message::Message as Server,
            },
        },
        transport::TransportRegistry,
    },
    model::{
        ContentPart, ModelConfigInput, ModelType, ProjectedContent, ProviderReplayState, Role,
        Usage, OPENAI_CHAT_ENDPOINT,
    },
    network::NetworkClients,
    provider::{FinishReason, ModelEvent},
};
use futures_util::StreamExt;
use prost::Message;
use serde_json::json;
use tower::ServiceExt;

const CONTEXT_WINDOW: u64 = 200_000;

struct Harness {
    router: Router,
    provider: fake_provider::FakeProvider,
    model_id: String,
    _directory: tempfile::TempDir,
}

async fn harness() -> Harness {
    let (directory, store) = fixtures::temp_store().await;
    let model = store
        .create_model(&ModelConfigInput {
            sort_order: 0,
            display_name: "Example".into(),
            group_name: None,
            model_type: ModelType::OpenAi,
            base_url: "https://example.com/v1".into(),
            use_full_url: false,
            api_key: "upstream".into(),
            tooltip_data: "test".into(),
            model_id: "qwen/model".into(),
            reasoning_effort: None,
            openai_endpoint: OPENAI_CHAT_ENDPOINT.into(),
            openai_extra_params_enabled: false,
            openai_extra_params: json!({}),
            custom_headers_enabled: false,
            custom_headers: json!({}),
            anthropic_extra_params_enabled: false,
            anthropic_extra_params: json!({}),
            context_window_tokens: Some(CONTEXT_WINDOW),
            max_completion_tokens: None,
            anthropic_max_tokens: None,
            anthropic_thinking_effort: None,
            thinking_budget_tokens: None,
        })
        .await
        .unwrap();
    let assets =
        PromptAssets::load(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("prompt/cursor"))
            .unwrap();
    let provider = fake_provider::FakeProvider::default();
    let registry = TransportRegistry::new(
        store.clone(),
        Arc::new(provider.clone()),
        PromptCompiler::new(assets),
    );
    Harness {
        router: cursor::router(registry, NetworkClients::new(store)).unwrap(),
        provider,
        model_id: model.model_hash,
        _directory: directory,
    }
}

/// Opens RunInferenceSSE and returns a channel of decoded server messages plus the end frame.
fn open_stream(
    router: &Router,
    request_id: &str,
) -> tokio::sync::mpsc::UnboundedReceiver<Result<ai::RunInferenceServerMessage, String>> {
    let (sender, receiver) = tokio::sync::mpsc::unbounded_channel();
    let request = Request::post("/aiserver.v1.InferenceService/RunInferenceSSE")
        .header(header::CONTENT_TYPE, "application/proto")
        .body(Body::from(
            ai::BidiRequestId {
                request_id: request_id.into(),
            }
            .encode_to_vec(),
        ))
        .unwrap();
    let router = router.clone();
    tokio::spawn(async move {
        let response = router.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let mut body = response.into_body().into_data_stream();
        let mut buffer = Vec::new();
        while let Some(chunk) = body.next().await {
            buffer.extend_from_slice(&chunk.unwrap());
            while buffer.len() >= 5 {
                let length =
                    u32::from_be_bytes([buffer[1], buffer[2], buffer[3], buffer[4]]) as usize;
                if buffer.len() < 5 + length {
                    break;
                }
                let frame: Vec<u8> = buffer.drain(..5 + length).collect();
                let message = if frame[0] & connect::END_STREAM_FLAG != 0 {
                    Err(String::from_utf8_lossy(&frame[5..]).into_owned())
                } else {
                    Ok(ai::RunInferenceServerMessage::decode(&frame[5..]).unwrap())
                };
                if sender.send(message).is_err() {
                    return;
                }
            }
        }
    });
    receiver
}

async fn append(router: &Router, request_id: &str, seqno: i64, message: Client) -> StatusCode {
    append_with_encoding(router, request_id, seqno, message, false).await
}

async fn append_with_encoding(
    router: &Router,
    request_id: &str,
    seqno: i64,
    message: Client,
    binary: bool,
) -> StatusCode {
    let payload = ai::RunInferenceClientMessage {
        message: Some(message),
    }
    .encode_to_vec();
    let body = ai::BidiAppendRequest {
        data: if binary {
            String::new()
        } else {
            hex::encode(&payload)
        },
        request_id: Some(ai::BidiRequestId {
            request_id: request_id.into(),
        }),
        append_seqno: seqno,
        data_binary: if binary { payload } else { Vec::new() },
    }
    .encode_to_vec();
    let response = router
        .clone()
        .oneshot(
            Request::post("/aiserver.v1.BidiService/BidiAppend")
                .header(header::CONTENT_TYPE, "application/proto")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let _ = to_bytes(response.into_body(), 64 * 1024).await;
    status
}

#[tokio::test]
async fn binary_bidi_append_drives_inference_and_heartbeat() {
    let harness = harness().await;
    harness.provider.push(vec![
        ModelEvent::TextDelta("binary inference works".into()),
        ModelEvent::Done(FinishReason::Stop),
    ]);
    let request_id = "binary-inference";
    let mut stream = open_stream(&harness.router, request_id);
    assert_eq!(
        append_with_encoding(
            &harness.router,
            request_id,
            0,
            run_request(&harness.model_id),
            true
        )
        .await,
        StatusCode::OK
    );
    assert!(matches!(
        next(&mut stream).await.unwrap(),
        Server::RunReady(_)
    ));
    assert_eq!(
        append_with_encoding(
            &harness.router,
            request_id,
            1,
            Client::ClientHeartbeat(Default::default()),
            true
        )
        .await,
        StatusCode::OK
    );
    assert!(matches!(
        next(&mut stream).await.unwrap(),
        Server::Heartbeat(_)
    ));
    let user = message(
        ai::InferenceMessageRole::User,
        inference_core_message::Content::Text("hello".into()),
    );
    assert_eq!(
        append_with_encoding(
            &harness.router,
            request_id,
            2,
            invoke("binary-call", vec![user]),
            true
        )
        .await,
        StatusCode::OK
    );
    let (responses, end) = invocation(&mut stream).await;
    assert!(end.error.is_none());
    assert!(responses.iter().any(|response| matches!(
        response,
        inference_stream_response::Response::TextPart(part) if part.text.contains("binary inference works")
    )));
    assert_eq!(harness.provider.requests().len(), 1);
    assert_eq!(
        append_with_encoding(
            &harness.router,
            request_id,
            3,
            Client::FinishRun(Default::default()),
            true
        )
        .await,
        StatusCode::OK
    );
    assert_eq!(next(&mut stream).await, Err("{}".into()));
}

async fn next(
    stream: &mut tokio::sync::mpsc::UnboundedReceiver<
        Result<ai::RunInferenceServerMessage, String>,
    >,
) -> Result<Server, String> {
    let message = tokio::time::timeout(std::time::Duration::from_secs(5), stream.recv())
        .await
        .expect("server message within 5s")
        .expect("stream still open");
    message.map(|message| message.message.expect("server message set"))
}

/// Collects one invocation's responses up to and including its `invocation_end`.
async fn invocation(
    stream: &mut tokio::sync::mpsc::UnboundedReceiver<
        Result<ai::RunInferenceServerMessage, String>,
    >,
) -> (
    Vec<inference_stream_response::Response>,
    ai::RunInferenceInvocationEnd,
) {
    let mut responses = Vec::new();
    loop {
        match next(stream).await.unwrap() {
            Server::InvocationResponse(response) => {
                responses.push(response.response.unwrap().response.unwrap())
            }
            Server::InvocationEnd(end) => return (responses, end),
            other => panic!("unexpected {other:?}"),
        }
    }
}

fn run_request(model_id: &str) -> Client {
    Client::RunRequest(ai::RunInferenceRunRequest {
        conversation_id: "45f5b907-33a5-4767-86ab-9ed156b8dcde".into(),
        requested_model: Some(ai::InferenceRequestedModel {
            model_id: model_id.into(),
            parameters: vec![ai::InferenceModelParameterValue {
                id: "reasoning".into(),
                value: "high".into(),
            }],
            ..Default::default()
        }),
        ..Default::default()
    })
}

fn message(
    role: ai::InferenceMessageRole,
    content: inference_core_message::Content,
) -> ai::InferenceCoreMessage {
    ai::InferenceCoreMessage {
        role: role as i32,
        content: Some(content),
        ..Default::default()
    }
}

fn invoke(id: &str, messages: Vec<ai::InferenceCoreMessage>) -> Client {
    let mut parameters = prost_types::Struct::default();
    parameters.fields.insert(
        "type".into(),
        prost_types::Value {
            kind: Some(prost_types::value::Kind::StringValue("object".into())),
        },
    );
    Client::InvokeModel(ai::RunInferenceInvokeModel {
        invocation_id: id.into(),
        request: Some(ai::InferenceStreamRequest {
            messages,
            tools: vec![ai::InferenceAgentTool {
                name: "Read".into(),
                description: "Read a file".into(),
                parameters: Some(parameters),
                custom_tool_format: None,
            }],
            ..Default::default()
        }),
        ..Default::default()
    })
}

#[tokio::test]
async fn byok_model_serves_a_tool_round_trip_with_reasoning_replay() {
    let harness = harness().await;
    let replay = ProviderReplayState {
        provider_kind: "openai_chat".into(),
        value: json!({ "reasoning_content": "kept" }),
    };
    harness.provider.push(vec![
        ModelEvent::Start {
            model_call_id: "m1".into(),
        },
        ModelEvent::ThinkingDelta("plan".into()),
        ModelEvent::TextDelta("Reading".into()),
        ModelEvent::ToolCallStart {
            index: 0,
            call_id: "call_1".into(),
            name: "Read".into(),
        },
        ModelEvent::ToolCallArgumentsDelta {
            index: 0,
            delta: r#"{"path":"#.into(),
        },
        ModelEvent::ToolCallArgumentsDelta {
            index: 0,
            delta: r#""a.txt"}"#.into(),
        },
        ModelEvent::ToolCallEnd { index: 0 },
        ModelEvent::ProviderReplayState(replay.clone()),
        ModelEvent::Usage(Usage {
            input_tokens: Some(12),
            output_tokens: Some(3),
            ..Default::default()
        }),
        ModelEvent::Done(FinishReason::ToolUse),
    ]);
    harness.provider.push(vec![
        ModelEvent::TextDelta("done".into()),
        ModelEvent::Done(FinishReason::Stop),
    ]);
    let request_id = "inference-turn";
    let mut stream = open_stream(&harness.router, request_id);
    assert_eq!(
        append(
            &harness.router,
            request_id,
            0,
            run_request(&harness.model_id)
        )
        .await,
        StatusCode::OK
    );

    let Server::RunReady(ready) = next(&mut stream).await.unwrap() else {
        panic!("first server message must be run_ready");
    };
    assert_eq!(ready.resolved_model.unwrap().model_id, harness.model_id);
    let metadata = ready.prompt_model_metadata.unwrap();
    assert_eq!(
        (
            metadata.vendor.as_str(),
            metadata.reasoning_effort.as_deref(),
            metadata.agent_token_limit,
        ),
        ("openai", Some("high"), Some(CONTEXT_WINDOW as i32))
    );

    let system = message(
        ai::InferenceMessageRole::System,
        inference_core_message::Content::Text("Be brief.".into()),
    );
    let user = message(
        ai::InferenceMessageRole::User,
        inference_core_message::Content::Text("Read a.txt".into()),
    );
    append(
        &harness.router,
        request_id,
        1,
        invoke("inv-1", vec![system.clone(), user.clone()]),
    )
    .await;
    let (responses, end) = invocation(&mut stream).await;
    assert_eq!(end.invocation_id, "inv-1");
    assert!(end.error.is_none());
    use inference_stream_response::Response as R;
    assert!(
        matches!(responses.first(), Some(R::InvocationId(info)) if info.invocation_id == "inv-1"),
        "Cursor's client needs the invocation id before any output"
    );
    assert!(responses.iter().any(
        |r| matches!(r, R::ExtendedUsage(usage) if usage.max_tokens == CONTEXT_WINDOW as i32)
    ));
    let complete = responses
        .iter()
        .find_map(|response| match response {
            R::ToolCallPart(part) if part.is_complete => Some(part.clone()),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        (complete.tool_call_id.as_str(), complete.tool_name.as_str()),
        ("call_1", "Read")
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&complete.args).unwrap(),
        json!({ "path": "a.txt" })
    );
    let redacted = responses
        .iter()
        .find_map(|response| match response {
            R::ThinkingPart(part) => part.redacted_data.clone(),
            _ => None,
        })
        .unwrap();
    assert!(responses
        .iter()
        .any(|r| matches!(r, R::Usage(usage) if usage.prompt_tokens == 12)));
    assert!(matches!(responses.last(), Some(R::TextPart(part)) if part.is_final));

    let first = &harness.provider.requests()[0];
    assert_eq!(first.prompt.instructions, "Be brief.");
    assert_eq!(first.prompt.tools[0].name, "Read");
    assert_eq!(first.history.len(), 1);

    let assistant = ai::InferenceCoreMessage {
        role: ai::InferenceMessageRole::Assistant as i32,
        content: Some(inference_core_message::Content::Text("Reading".into())),
        tool_calls: vec![ai::InferenceToolCall {
            tool_call_id: "call_1".into(),
            tool_name: "Read".into(),
            args: None,
            raw_tool_call_args: Some(complete.args.clone()),
        }],
        reasoning_parts: vec![ai::InferenceReasoningPart {
            is_redacted: true,
            redacted_data: Some(redacted),
            ..Default::default()
        }],
        ..Default::default()
    };
    let tool = message(
        ai::InferenceMessageRole::Tool,
        inference_core_message::Content::ToolContent(ai::InferenceToolResultContent {
            parts: vec![ai::InferenceToolResultPart {
                tool_call_id: "call_1".into(),
                tool_name: "Read".into(),
                result: Some(prost_types::Value {
                    kind: Some(prost_types::value::Kind::StringValue("hello".into())),
                }),
                experimental_content: vec![ai::InferenceContentPart {
                    part: Some(inference_content_part::Part::Text(ai::InferenceTextPart {
                        text: "hello".into(),
                        provider_options: None,
                    })),
                }],
                ..Default::default()
            }],
        }),
    );
    append(
        &harness.router,
        request_id,
        2,
        invoke("inv-2", vec![system, user, assistant, tool]),
    )
    .await;
    let (_, end) = invocation(&mut stream).await;
    assert!(end.error.is_none());

    let second = &harness.provider.requests()[1];
    assert_eq!(second.history.len(), 3);
    let ProjectedContent::Assistant {
        replay_state,
        calls,
        ..
    } = &second.history[1].content
    else {
        panic!("second message must be the assistant turn");
    };
    assert_eq!(replay_state.as_ref(), Some(&replay));
    assert_eq!(calls[0].arguments, json!({ "path": "a.txt" }));
    let ProjectedContent::ToolResult(result) = &second.history[2].content else {
        panic!("third message must be the tool result");
    };
    assert_eq!(
        (result.call_id.as_str(), result.content.as_str()),
        ("call_1", "hello")
    );
    assert_eq!(
        result.provider_parts,
        vec![ContentPart::Text {
            text: "hello".into()
        }]
    );
    assert_eq!(second.history[2].role, Role::Tool);

    append(
        &harness.router,
        request_id,
        3,
        Client::FinishRun(Default::default()),
    )
    .await;
    assert_eq!(next(&mut stream).await, Err("{}".into()));
}

#[tokio::test]
async fn cancel_invocation_ends_a_pending_provider_call() {
    let harness = harness().await;
    harness.provider.push_pending();
    let request_id = "inference-cancel";
    let mut stream = open_stream(&harness.router, request_id);
    append(
        &harness.router,
        request_id,
        0,
        run_request(&harness.model_id),
    )
    .await;
    assert!(matches!(
        next(&mut stream).await.unwrap(),
        Server::RunReady(_)
    ));
    let user = message(
        ai::InferenceMessageRole::User,
        inference_core_message::Content::Text("hi".into()),
    );
    append(&harness.router, request_id, 1, invoke("inv-1", vec![user])).await;
    append(
        &harness.router,
        request_id,
        2,
        Client::CancelInvocation(ai::RunInferenceCancelInvocation {
            invocation_id: "inv-1".into(),
        }),
    )
    .await;
    let (_, end) = invocation(&mut stream).await;
    assert_eq!(end.error.map(|error| error.code), Some(1));
}

#[tokio::test]
async fn append_before_stream_waits_for_run_inference_sse() {
    let harness = harness().await;
    let request_id = "inference-append-first";
    let router = harness.router.clone();
    let model_id = harness.model_id.clone();
    let early =
        tokio::spawn(async move { append(&router, request_id, 0, run_request(&model_id)).await });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let mut stream = open_stream(&harness.router, request_id);
    assert_eq!(early.await.unwrap(), StatusCode::OK);
    assert!(matches!(
        next(&mut stream).await.unwrap(),
        Server::RunReady(_)
    ));
}

#[tokio::test]
async fn invoke_before_run_request_is_rejected() {
    let harness = harness().await;
    let request_id = "inference-no-run";
    let _stream = open_stream(&harness.router, request_id);
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let user = message(
        ai::InferenceMessageRole::User,
        inference_core_message::Content::Text("hi".into()),
    );
    assert_eq!(
        append(&harness.router, request_id, 0, invoke("inv-1", vec![user])).await,
        StatusCode::BAD_REQUEST
    );
    assert!(harness.provider.requests().is_empty());
}

#[tokio::test]
async fn turn_reports_for_byok_models_stay_local() {
    let harness = harness().await;
    let user = message(
        ai::InferenceMessageRole::User,
        inference_core_message::Content::Text("private".into()),
    );
    let reports = [
        (
            "/aiserver.v1.InferenceService/RecordAgentFollowupClassification",
            ai::AgentFollowupCategorizationRequest {
                request_id: "turn".into(),
                messages: vec![user.clone()],
                model_name: Some(harness.model_id.clone()),
                ..Default::default()
            }
            .encode_to_vec(),
        ),
        (
            "/aiserver.v1.InferenceService/RecordAgentPostTurnLabeling",
            ai::AgentPostTurnLabelingRequest {
                request_id: "turn".into(),
                messages: vec![user],
                model_name: Some(harness.model_id.clone()),
                ..Default::default()
            }
            .encode_to_vec(),
        ),
    ];
    for (path, body) in reports {
        let response = harness
            .router
            .clone()
            .oneshot(
                Request::post(path)
                    .header(header::CONTENT_TYPE, "application/proto")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        assert!(body.is_empty(), "{path} must answer google.protobuf.Empty");
    }
}
