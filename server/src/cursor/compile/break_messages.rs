//! Compiles runtime information that interrupts the current cycle before appending.
use std::collections::BTreeMap;

use chrono::{Offset, Utc};
use chrono_tz::Tz;

use crate::{
    cursor::{
        prompting::{Mode, PromptCompiler},
        protocol::proto::agent::v1 as pb,
        services::blob_sync::BlobSynchronizer,
    },
    model::{CanonicalMessage, MessageContent, Origin, Role},
    store::BlobId,
    Error, Result,
};

use super::{context, images};

pub(crate) enum RuntimeAction {
    Inject(pb::InjectContextAction),
    UserMessage(pb::UserMessageAction),
}

pub(crate) async fn compile_user_message_action(
    action: &pb::UserMessageAction,
    current_mode: i32,
    compiler: &PromptCompiler,
    blobs: &BlobSynchronizer,
) -> Result<CanonicalMessage> {
    let user = action
        .user_message
        .as_ref()
        .ok_or_else(|| Error::Protocol("Cursor user message action has no UserMessage".into()))?;
    if user.message_id.is_empty() {
        return Err(Error::Protocol(
            "Cursor user message action has no message_id".into(),
        ));
    }
    let mode = if user.mode == pb::AgentMode::Unspecified as i32 {
        current_mode
    } else {
        user.mode
    };
    let mut action_context = action
        .prepend_user_messages
        .iter()
        .map(|message| message.text.trim())
        .filter(|text| !text.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    action_context.extend(
        user.subagent_system_reminder
            .iter()
            .filter(|text| !text.is_empty())
            .cloned(),
    );
    let empty_context = pb::RequestContext::default();
    compile(
        format!("user-message:{}", user.message_id),
        super::run::mode_from_proto(mode)?,
        user,
        action.request_context.as_ref().unwrap_or(&empty_context),
        &action_context.join("\\n\\n"),
        compiler,
        blobs,
    )
    .await
}

pub(crate) async fn compile_injection(
    injection: &pb::InjectContextAction,
    mode: i32,
    compiler: &PromptCompiler,
    blobs: &BlobSynchronizer,
) -> Result<CanonicalMessage> {
    if injection.injection_id.is_empty() {
        return Err(Error::Protocol(
            "InjectContextAction has no injection_id".into(),
        ));
    }
    let event_id = format!("inject-context:{}", injection.injection_id);
    match injection.payload.as_ref() {
        Some(pb::inject_context_action::Payload::UserContext(context)) => {
            let user = context.user_message.as_ref().ok_or_else(|| {
                Error::Protocol("InjectContextAction UserContext has no UserMessage".into())
            })?;
            if user.message_id.is_empty() {
                return Err(Error::Protocol(
                    "InjectContextAction UserMessage has no message_id".into(),
                ));
            }
            let empty_context = pb::RequestContext::default();
            compile(
                event_id,
                super::run::mode_from_proto(mode)?,
                user,
                context.request_context.as_ref().unwrap_or(&empty_context),
                "",
                compiler,
                blobs,
            )
            .await
        }
        Some(pb::inject_context_action::Payload::SystemContext(context)) => {
            Ok(CanonicalMessage {
                message_id: format!("runtime:{event_id}"),
                role: Role::User,
                origin: Origin::Runtime,
                content: MessageContent::Parts {
                    parts: vec![crate::model::ContentPart::Text {
                        text: format!(
                            "<system_context_injection>\n<producer>{}</producer>\n{}\n</system_context_injection>",
                            context.producer, context.content
                        ),
                    }],
                },
                runtime_event_id: Some(event_id),
            })
        }
        None => Err(Error::Protocol(
            "InjectContextAction has no payload".into(),
        )),
    }
}

pub async fn compile(
    event_id: String,
    mode: Mode,
    user: &pb::UserMessage,
    request_context: &pb::RequestContext,
    action_context: &str,
    compiler: &PromptCompiler,
    blobs: &BlobSynchronizer,
) -> Result<CanonicalMessage> {
    let timestamp = Time::now(
        request_context
            .env
            .as_ref()
            .map(|env| env.time_zone.as_str()),
    )?
    .timestamp;
    compile_with_timestamp(
        event_id,
        mode,
        user,
        request_context,
        action_context,
        timestamp,
        compiler,
        blobs,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn user_event_id(
    input_id: &str,
    mode: Mode,
    user: &pb::UserMessage,
    request_context: &pb::RequestContext,
    action_context: &str,
    projected_request_context: Option<&MessageContent>,
    compiler: &PromptCompiler,
    blobs: &BlobSynchronizer,
) -> Result<String> {
    let runtime = compile_with_timestamp(
        "identity".into(),
        mode,
        user,
        request_context,
        action_context,
        String::new(),
        compiler,
        blobs,
    )
    .await?;
    let semantic = serde_json::to_vec(&(projected_request_context, runtime.content))?;
    Ok(format!(
        "{input_id}:{}",
        BlobId::digest(&semantic).to_base64()
    ))
}

#[allow(clippy::too_many_arguments)]
async fn compile_with_timestamp(
    event_id: String,
    mode: Mode,
    user: &pb::UserMessage,
    request_context: &pb::RequestContext,
    action_context: &str,
    timestamp: String,
    compiler: &PromptCompiler,
    blobs: &BlobSynchronizer,
) -> Result<CanonicalMessage> {
    let mut values = BTreeMap::from([
        ("OPEN_FILES", section(open_files(user))),
        (
            "SELECTED_CONTEXT",
            section(
                context::selected_context(user)
                    .filter(|value| !value.is_empty())
                    .map(|value| format!("<selected_context>\n{value}\n</selected_context>"))
                    .unwrap_or_default(),
            ),
        ),
        ("ACTION_CONTEXT", section(action_context.to_string())),
        ("TIMESTAMP", timestamp),
        ("USER_QUERY", user.text.clone()),
        ("DEBUG_SERVER_ENDPOINT", String::new()),
        ("DEBUG_LOG_PATH", String::new()),
        ("DEBUG_SESSION_ID", String::new()),
    ]);
    if let Some(debug) = &request_context.debug_mode_config {
        values.insert("DEBUG_SERVER_ENDPOINT", debug.server_endpoint.clone());
        values.insert("DEBUG_LOG_PATH", debug.log_path.clone());
        values.insert("DEBUG_SESSION_ID", debug.session_id.clone());
    }
    message(
        event_id,
        user,
        compiler.runtime_message(mode, &values)?,
        blobs,
    )
    .await
}

pub(super) fn compile_request_context(
    event_id: &str,
    request_context: &pb::RequestContext,
    image_models: &[crate::cursor::tools::runtime::ImageModel],
    history: &[CanonicalMessage],
) -> Result<Option<CanonicalMessage>> {
    let time = Time::now(
        request_context
            .env
            .as_ref()
            .map(|env| env.time_zone.as_str()),
    )?;
    let mut text = context::compile_context(request_context, &time.today);
    const TAG: &str = "<image_generation_models>";
    let previous = history
        .iter()
        .rev()
        .find(|message| message.message_id.starts_with("request-context:"));
    let previously_listed = previous.is_some_and(|message| match &message.content {
        MessageContent::Parts { parts } => parts.iter().any(
            |part| matches!(part, crate::model::ContentPart::Text { text } if text.contains(TAG)),
        ),
        _ => false,
    });
    if !image_models.is_empty() || previously_listed {
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        let catalog = serde_json::to_string(image_models)?
            .replace('<', "\\u003c")
            .replace('>', "\\u003e");
        text.push_str(&format!("{TAG}\nConfigured image generation models in default order. Use the first entry unless the user specifies a model. Pass its id to GenerateImage.\n{catalog}\n</image_generation_models>"));
    }
    if text.is_empty() {
        return Ok(None);
    }
    let message = CanonicalMessage::text(
        format!("request-context:{event_id}"),
        Role::User,
        Origin::Prompt,
        text,
    );
    Ok(previous
        .is_none_or(|previous| previous.content != message.content)
        .then_some(message))
}

pub async fn compile_background(
    event_id: String,
    user: &pb::UserMessage,
    request_context: &pb::RequestContext,
    action_context: &str,
    blobs: &BlobSynchronizer,
) -> Result<(CanonicalMessage, String)> {
    let timestamp = Time::now(
        request_context
            .env
            .as_ref()
            .map(|env| env.time_zone.as_str()),
    )?
    .timestamp;
    let text = format!(
        "<timestamp>{timestamp}</timestamp>\n{}\n<user_query>{}</user_query>",
        action_context.trim(),
        user.text
    );
    let message = message(event_id, user, text.clone(), blobs).await?;
    Ok((message, text))
}

async fn message(
    event_id: String,
    user: &pb::UserMessage,
    text: String,
    blobs: &BlobSynchronizer,
) -> Result<CanonicalMessage> {
    Ok(CanonicalMessage {
        message_id: format!("runtime:{event_id}"),
        role: Role::User,
        origin: Origin::Runtime,
        content: MessageContent::Parts {
            parts: images::parts(user, text, blobs).await?,
        },
        runtime_event_id: Some(event_id),
    })
}

fn section(value: String) -> String {
    let value = value.trim();
    if value.is_empty() {
        String::new()
    } else {
        format!("{value}\n\n")
    }
}

fn open_files(user: &pb::UserMessage) -> String {
    let Some(ide) = user
        .selected_context
        .as_ref()
        .and_then(|selected| selected.invocation_context.as_ref())
        .and_then(|invocation| invocation.data.as_ref())
        .and_then(|data| match data {
            pb::invocation_context::Data::IdeState(ide) => Some(ide),
            _ => None,
        })
    else {
        return String::new();
    };
    if ide.visible_files.is_empty() && ide.recently_viewed_files.is_empty() {
        return String::new();
    }

    let mut output = String::from("<open_and_recently_viewed_files>\n");
    if !ide.recently_viewed_files.is_empty() {
        output.push_str("Recently viewed files (recent at the top, oldest at the bottom):\n");
        for file in &ide.recently_viewed_files {
            output.push_str(&format!(
                "- {} (total lines: {})\n",
                file.path, file.total_lines
            ));
        }
        output.push('\n');
    }
    if !ide.visible_files.is_empty() {
        output.push_str("Files that are currently open and visible in the user's IDE:\n");
        for (index, file) in ide.visible_files.iter().enumerate() {
            output.push_str(&format!("- {} (", file.path));
            if index == 0 {
                output.push_str("currently focused file");
                if let Some(cursor) = &file.cursor_position {
                    output.push_str(&format!(", cursor is on line {}", cursor.line));
                }
                output.push_str(&format!(", total lines: {}", file.total_lines));
            } else {
                output.push_str(&format!("total lines: {}", file.total_lines));
            }
            output.push_str(")\n");
        }
        output.push('\n');
    }
    output.push_str(
        "Note: these files may or may not be relevant to the current conversation. Use the read file tool if you need to get the contents of some of them.\n</open_and_recently_viewed_files>",
    );
    output
}

struct Time {
    timestamp: String,
    today: String,
}

impl Time {
    fn now(time_zone: Option<&str>) -> Result<Self> {
        let zone = match time_zone.filter(|value| !value.is_empty()) {
            Some(value) => value
                .parse::<Tz>()
                .map_err(|_| Error::Protocol(format!("invalid Cursor time zone: {value}")))?,
            None => chrono_tz::UTC,
        };
        let now = Utc::now().with_timezone(&zone);
        let offset = now.offset().fix().local_minus_utc();
        let sign = if offset < 0 { '-' } else { '+' };
        let offset = offset.unsigned_abs();
        let hours = offset / 3600;
        let minutes = (offset % 3600) / 60;
        let utc = if minutes == 0 {
            format!("UTC{sign}{hours}")
        } else {
            format!("UTC{sign}{hours}:{minutes:02}")
        };
        Ok(Self {
            timestamp: format!("{} ({utc})", now.format("%A, %b %-d, %Y, %-I:%M %p")),
            today: now.format("%A %b %-d,\n%Y").to_string(),
        })
    }
}

#[cfg(test)]
mod image_catalog_tests {
    use super::*;
    use crate::cursor::tools::runtime::ImageModel;

    #[test]
    fn changing_or_removing_image_models_appends_exactly_one_catalog_update() {
        let one = vec![ImageModel {
            id: "route".into(),
            model: "image-v1".into(),
            name: "<Image>".into(),
        }];
        let context = pb::RequestContext::default();
        let mut history = Vec::new();
        let first = compile_request_context("1", &context, &one, &history)
            .unwrap()
            .unwrap();
        let contents = serde_json::to_string(&first.content).unwrap();
        assert!(contents.contains("image-v1"));
        assert!(!contents.contains("<Image>"));
        history.push(first.clone());
        assert!(compile_request_context("2", &context, &one, &history)
            .unwrap()
            .is_none());
        let mut two = one.clone();
        two.push(ImageModel {
            id: "another".into(),
            model: "image-v2".into(),
            name: "Image 2".into(),
        });
        let added = compile_request_context("added", &context, &two, &history)
            .unwrap()
            .unwrap();
        let added_text = serde_json::to_string(&added.content).unwrap();
        assert!(added_text.find("image-v1").unwrap() < added_text.find("image-v2").unwrap());
        history.push(added);
        two.reverse();
        let reordered = compile_request_context("reordered", &context, &two, &history)
            .unwrap()
            .unwrap();
        let reordered_text = serde_json::to_string(&reordered.content).unwrap();
        assert!(
            reordered_text.find("image-v2").unwrap() < reordered_text.find("image-v1").unwrap()
        );
        history.push(reordered);
        let empty = compile_request_context("3", &context, &[], &history)
            .unwrap()
            .unwrap();
        assert!(!serde_json::to_string(&empty.content)
            .unwrap()
            .contains("image-v1"));
        history.push(empty);
        assert!(compile_request_context("4", &context, &[], &history)
            .unwrap()
            .is_none());
        let restored = compile_request_context("5", &context, &one, &history)
            .unwrap()
            .unwrap();
        assert_eq!(restored.content, first.content);
        assert_ne!(restored.message_id, first.message_id);
    }
}
