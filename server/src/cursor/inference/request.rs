//! Translates a Cursor RunInference model request into a BYOK provider request.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Map, Value};

use crate::{
    cursor::protocol::proto::{
        aiserver::v1::{
            inference_content_part::Part, inference_core_message::Content, InferenceAgentTool,
            InferenceContentPart, InferenceCoreMessage, InferenceMessageRole,
            InferenceStreamRequest, InferenceToolCall, InferenceToolResultPart,
        },
        prost_json,
    },
    model::{
        ContentPart, ModelRequest, ModelSpec, ProjectedContent, ProjectedMessage, PromptSpec, Role,
        ToolCallContent, ToolDefinition, ToolResultContent,
    },
    Error, Result,
};

use super::replay;

pub fn model_request(request: &InferenceStreamRequest, model: ModelSpec) -> Result<ModelRequest> {
    if !request.provider_defined_tools.is_empty() {
        tracing::warn!(
            count = request.provider_defined_tools.len(),
            "ignoring Cursor provider-defined tools; BYOK providers receive function tools only"
        );
    }
    let mut instructions = Vec::new();
    let mut history = Vec::new();
    for (index, message) in request.messages.iter().enumerate() {
        let role = role(message)?;
        if role == Role::System && history.is_empty() {
            instructions.push(text_of(message.content.as_ref()));
            continue;
        }
        project(index, role, message, &mut history)?;
    }
    Ok(ModelRequest {
        prompt: PromptSpec {
            instructions: instructions.join("\n\n"),
            tools: request.tools.iter().map(tool).collect(),
        },
        model,
        history,
    })
}

fn role(message: &InferenceCoreMessage) -> Result<Role> {
    match InferenceMessageRole::try_from(message.role) {
        Ok(InferenceMessageRole::User) => Ok(Role::User),
        Ok(InferenceMessageRole::Assistant) => Ok(Role::Assistant),
        Ok(InferenceMessageRole::Tool) => Ok(Role::Tool),
        Ok(InferenceMessageRole::System) => Ok(Role::System),
        Ok(InferenceMessageRole::Unspecified) | Err(_) => Err(Error::Protocol(format!(
            "Cursor RunInference message has unsupported role {}",
            message.role
        ))),
    }
}

fn project(
    index: usize,
    role: Role,
    message: &InferenceCoreMessage,
    history: &mut Vec<ProjectedMessage>,
) -> Result<()> {
    match role {
        Role::Tool => {
            let Some(Content::ToolContent(content)) = message.content.as_ref() else {
                return Err(Error::Protocol(
                    "Cursor RunInference tool message has no tool results".into(),
                ));
            };
            for (part_index, part) in content.parts.iter().enumerate() {
                history.push(ProjectedMessage {
                    message_id: format!("{index}.{part_index}"),
                    role: Role::Tool,
                    content: ProjectedContent::ToolResult(tool_result(part)?),
                });
            }
        }
        Role::Assistant => history.push(ProjectedMessage {
            message_id: index.to_string(),
            role,
            content: assistant(message)?,
        }),
        Role::User | Role::System => history.push(ProjectedMessage {
            message_id: index.to_string(),
            role,
            content: ProjectedContent::Parts(parts(message.content.as_ref())?),
        }),
    }
    Ok(())
}

fn assistant(message: &InferenceCoreMessage) -> Result<ProjectedContent> {
    let mut text = text_of(message.content.as_ref());
    if text.is_empty() {
        text = message.assistant_text_parts.concat();
    }
    let thinking = message
        .reasoning_parts
        .iter()
        .filter(|part| !part.is_redacted)
        .map(|part| part.text.as_str())
        .collect::<String>();
    let replay_state = message
        .reasoning_parts
        .iter()
        .filter(|part| part.is_redacted)
        .find_map(|part| part.redacted_data.as_deref().and_then(replay::decode));
    let calls = message
        .tool_calls
        .iter()
        .enumerate()
        .map(|(index, call)| tool_call(index, call))
        .collect();
    Ok(ProjectedContent::Assistant {
        text,
        thinking,
        replay_state,
        calls,
    })
}

fn tool_call(index: usize, call: &InferenceToolCall) -> ToolCallContent {
    let raw = call
        .raw_tool_call_args
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .filter(Value::is_object);
    let arguments = raw
        .or_else(|| call.args.as_ref().map(struct_json))
        .unwrap_or_else(|| json!({}));
    ToolCallContent {
        index,
        call_id: call.tool_call_id.clone(),
        name: call.tool_name.clone(),
        arguments,
    }
}

fn tool_result(part: &InferenceToolResultPart) -> Result<ToolResultContent> {
    let content = match part.result.as_ref().map(prost_json) {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text,
        Some(value) => value.to_string(),
    };
    let provider_parts = part
        .experimental_content
        .iter()
        .filter_map(|part| content_part(part).transpose())
        .collect::<Result<Vec<_>>>()?;
    Ok(ToolResultContent {
        call_id: part.tool_call_id.clone(),
        name: part.tool_name.clone(),
        content,
        is_error: part.is_error || part.cursor_tool_call_is_error == Some(true),
        image: None,
        provider_parts,
    })
}

fn text_of(content: Option<&Content>) -> String {
    match content {
        Some(Content::Text(text)) => text.clone(),
        Some(Content::Parts(parts)) => parts
            .parts
            .iter()
            .filter_map(|part| match part.part.as_ref() {
                Some(Part::Text(text)) => Some(text.text.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(Content::ToolContent(_)) | None => String::new(),
    }
}

fn parts(content: Option<&Content>) -> Result<Vec<ContentPart>> {
    match content {
        Some(Content::Text(text)) => Ok(vec![ContentPart::Text { text: text.clone() }]),
        Some(Content::Parts(parts)) => parts
            .parts
            .iter()
            .filter_map(|part| content_part(part).transpose())
            .collect(),
        Some(Content::ToolContent(_)) => Err(Error::Protocol(
            "Cursor RunInference sent tool results outside a tool message".into(),
        )),
        None => Ok(Vec::new()),
    }
}

fn content_part(part: &InferenceContentPart) -> Result<Option<ContentPart>> {
    match part.part.as_ref() {
        Some(Part::Text(text)) => Ok(Some(ContentPart::Text {
            text: text.text.clone(),
        })),
        Some(Part::Image(image)) => image_part(&image.data, image.mime_type.as_deref()).map(Some),
        Some(Part::File(file)) if file.media_type.starts_with("image/") => {
            image_part(&file.data, Some(&file.media_type)).map(Some)
        }
        Some(Part::File(file)) => Ok(Some(ContentPart::Text {
            text: format!(
                "[Attached file {} ({}) cannot be sent through this BYOK model channel]",
                file.filename.as_deref().unwrap_or("unnamed"),
                file.media_type
            ),
        })),
        None => Ok(None),
    }
}

fn image_part(data: &str, mime_type: Option<&str>) -> Result<ContentPart> {
    let (mime_type, encoded) = match data.strip_prefix("data:") {
        Some(rest) => {
            let (header, encoded) = rest
                .split_once(',')
                .ok_or_else(|| Error::Protocol("Cursor image data URL has no payload".into()))?;
            let mime = header.strip_suffix(";base64").ok_or_else(|| {
                Error::Protocol("Cursor image data URL is not base64 encoded".into())
            })?;
            (mime.to_owned(), encoded)
        }
        None if data.starts_with("http://") || data.starts_with("https://") => {
            return Err(Error::Protocol(
                "Cursor sent a remote image URL; BYOK providers need inline image data".into(),
            ))
        }
        None => (mime_type.unwrap_or("image/png").to_owned(), data),
    };
    let data = STANDARD
        .decode(encoded.trim())
        .map_err(|error| Error::Protocol(format!("Cursor image is not valid base64: {error}")))?;
    Ok(ContentPart::Image { mime_type, data })
}

fn tool(tool: &InferenceAgentTool) -> ToolDefinition {
    if let Some(format) = tool.custom_tool_format.as_ref() {
        tracing::warn!(
            tool = tool.name,
            format = format.r#type,
            "Cursor custom-format tool is sent to BYOK providers as a JSON function tool"
        );
    }
    ToolDefinition {
        name: tool.name.clone(),
        description: tool.description.clone(),
        parameters: tool
            .parameters
            .as_ref()
            .map(struct_json)
            .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
    }
}

fn struct_json(value: &prost_types::Struct) -> Value {
    Value::Object(
        value
            .fields
            .iter()
            .map(|(key, value)| (key.clone(), prost_json(value)))
            .collect::<Map<_, _>>(),
    )
}
