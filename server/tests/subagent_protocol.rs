//! Exercises subagent requests through the Cursor transport, including omitted wire IDs.
#[path = "support/fake_provider.rs"]
mod fake_provider;
#[path = "support/fixtures.rs"]
mod fixtures;

use std::{collections::HashMap, sync::Arc};

use cursor_server::{
    cursor::{
        prompting::{PromptAssets, PromptCompiler},
        protocol::{connect, proto::agent::v1 as pb},
        TransportCommand, TransportHandle, TransportRegistry,
    },
    model::{ContentPart, ProjectedContent},
    provider::{FinishReason, ModelEvent},
    store::Store,
};
use prost::Message;

#[tokio::test]
async fn task_child_without_message_id_completes_and_returns_to_parent() {
    let (_directory, store) = fixtures::temp_store().await;
    let provider = fake_provider::FakeProvider::default();
    provider.push(vec![
        ModelEvent::Start { model_call_id: "parent-task".into() },
        ModelEvent::ToolCallStart { index: 0, call_id: "task-call".into(), name: "Task".into() },
        ModelEvent::ToolCallArgumentsDelta {
            index: 0,
            delta: r#"{"description":"Inspect protocol","prompt":"Inspect protocol","subagent_type":"explore"}"#.into(),
        },
        ModelEvent::ToolCallEnd { index: 0 },
        ModelEvent::Done(FinishReason::ToolUse),
    ]);
    provider.push(stop("child-answer", "child result"));
    provider.push(stop("parent-answer", "parent result"));
    let registry = registry(store, &provider);
    let mut parent = child_request("parent", "Inspect protocol", None);
    parent.subagent_type_name = None;
    user(&mut parent).message_id = "parent-user".into();
    user(&mut parent).mode = pb::AgentMode::Agent as i32;
    let (checkpoint, blobs) = drive(&registry, "parent-transport", parent).await;
    assert_eq!(
        checkpoint_user(&checkpoint, &blobs).message_id,
        "parent-user"
    );

    let requests = provider.requests();
    assert_eq!(
        requests.len(),
        3,
        "parent dispatches a child and resumes after its result"
    );
    assert!(requests[1]
        .prompt
        .tools
        .iter()
        .any(|tool| tool.name == "UpdateCurrentStep"));
    assert!(!requests[1]
        .prompt
        .tools
        .iter()
        .any(|tool| tool.name == "Task"));
    assert!(requests[1]
        .history
        .iter()
        .any(|message| text(&message.content).contains("Inspect protocol")));
    assert!(requests[2].history.iter().any(|message| {
        matches!(&message.content, ProjectedContent::ToolResult(result)
            if result.call_id == "task-call" && !result.is_error && result.content.contains("child result"))
    }));
}

#[tokio::test]
async fn idless_subagent_retry_under_a_new_transport_reuses_the_runtime_message() {
    let (_directory, store) = fixtures::temp_store().await;
    let provider = fake_provider::FakeProvider::default();
    provider.push(stop("answer-1", "one"));
    provider.push(stop("answer-2", "two"));
    let registry = registry(store, &provider);
    let request = child_request("child", "Inspect protocol", None);
    let (first, first_blobs) = drive(&registry, "transport-1", request.clone()).await;
    let (retry, retry_blobs) = drive(&registry, "transport-2", request).await;
    let first_user = checkpoint_user(&first, &first_blobs);
    let retry_user = checkpoint_user(&retry, &retry_blobs);
    assert!(!first_user.message_id.is_empty());
    assert_eq!(
        first_user, retry_user,
        "the normalized ID survives checkpoint publication"
    );
    let requests = provider.requests();
    assert_eq!(
        requests[0].history, requests[1].history,
        "retry preserves content and timestamp"
    );
    assert_eq!(
        requests[1]
            .history
            .iter()
            .filter(|m| m.message_id.starts_with("runtime:"))
            .count(),
        1
    );
}

#[tokio::test]
async fn repeated_idless_prompt_after_checkpoint_hydration_is_a_new_turn_with_a_stable_prefix() {
    let (_directory, store) = fixtures::temp_store().await;
    let provider = fake_provider::FakeProvider::default();
    provider.push(stop("answer-1", "one"));
    let first_registry = registry(store.clone(), &provider);
    let (first, blobs) = drive(
        &first_registry,
        "transport-1",
        child_request("child", "Inspect protocol", None),
    )
    .await;
    let first_user = checkpoint_user(&first, &blobs);

    // Hydrate the published blobs in a fresh store, as on a new installation.
    let (_new_directory, new_store) = fixtures::temp_store().await;
    provider.push(stop("answer-2", "two"));
    let second_registry = registry(new_store, &provider);
    let mut next = child_request("child", "Inspect protocol", Some(first));
    next.pre_fetched_blobs = blobs
        .into_iter()
        .map(|(id, value)| pb::PreFetchedBlob { id, value })
        .collect();
    let (second, second_blobs) = drive(&second_registry, "transport-2", next).await;
    assert_ne!(
        first_user.message_id,
        checkpoint_user(&second, &second_blobs).message_id
    );
    let requests = provider.requests();
    assert_eq!(
        requests[0].prompt.instructions,
        requests[1].prompt.instructions
    );
    assert_eq!(
        requests[0].history,
        requests[1].history[..requests[0].history.len()]
    );
    assert_eq!(
        requests[1]
            .history
            .iter()
            .filter(|m| m.message_id.starts_with("runtime:"))
            .count(),
        2
    );
}

#[tokio::test]
async fn idless_sibling_subagents_keep_distinct_ids_and_preserve_action_context() {
    let (_directory, store) = fixtures::temp_store().await;
    let provider = fake_provider::FakeProvider::default();
    let registry = registry(store, &provider);
    let mut ids = Vec::new();
    for conversation in ["child-1", "child-2"] {
        provider.push(stop(conversation, "done"));
        let mut request = child_request(conversation, "Inspect protocol", None);
        user(&mut request).subagent_system_reminder =
            Some("Return findings to your parent.".into());
        let Some(pb::conversation_action::Action::UserMessageAction(action)) = request
            .action
            .as_mut()
            .and_then(|action| action.action.as_mut())
        else {
            panic!("user action")
        };
        action.prepend_user_messages.push(pb::UserMessage {
            text: "Only inspect the protocol adapter.".into(),
            ..Default::default()
        });
        let (state, blobs) = drive(&registry, conversation, request).await;
        ids.push(checkpoint_user(&state, &blobs).message_id);
    }
    assert_ne!(ids[0], ids[1]);
    for request in provider.requests() {
        let runtime = request
            .history
            .iter()
            .find(|m| m.message_id.starts_with("runtime:"))
            .unwrap();
        let content = text(&runtime.content);
        assert!(content.contains("Return findings to your parent."));
        assert!(content.contains("Only inspect the protocol adapter."));
    }
}

#[tokio::test]
async fn a_missing_user_message_is_rejected_before_calling_the_provider() {
    let (_directory, store) = fixtures::temp_store().await;
    let provider = fake_provider::FakeProvider::default();
    let registry = registry(store, &provider);
    let mut request = child_request("child", "Inspect protocol", None);
    let Some(pb::conversation_action::Action::UserMessageAction(action)) = request
        .action
        .as_mut()
        .and_then(|action| action.action.as_mut())
    else {
        panic!("user action")
    };
    action.user_message = None;
    let handle = registry.get_or_create("invalid-transport").await.unwrap();
    let mut output = handle.subscribe();
    append(
        &handle,
        &mut 0,
        pb::AgentClientMessage {
            message: Some(pb::agent_client_message::Message::RunRequest(request)),
        },
    )
    .await;
    let frame = tokio::time::timeout(std::time::Duration::from_secs(5), output.recv())
        .await
        .unwrap()
        .unwrap();
    let (flags, payload) = connect::decode_frames(&frame).unwrap().pop().unwrap();
    assert_ne!(flags & connect::END_STREAM_FLAG, 0);
    let end: serde_json::Value = serde_json::from_slice(&payload).unwrap();
    assert_eq!(
        end["error"]["message"],
        "Cursor user message action has no UserMessage"
    );
    assert!(provider.requests().is_empty());
}

fn registry(store: Store, provider: &fake_provider::FakeProvider) -> TransportRegistry {
    let assets =
        PromptAssets::load(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("prompt/cursor"))
            .unwrap();
    TransportRegistry::new(
        store,
        Arc::new(provider.clone()),
        PromptCompiler::new(assets),
    )
}

fn child_request(
    conversation: &str,
    prompt: &str,
    state: Option<pb::ConversationStateStructure>,
) -> pb::AgentRunRequest {
    pb::AgentRunRequest {
        conversation_id: Some(conversation.into()),
        conversation_group_id: Some("parent".into()),
        subagent_type_name: Some("explore".into()),
        conversation_state: state,
        action: Some(pb::ConversationAction {
            action: Some(pb::conversation_action::Action::UserMessageAction(
                pb::UserMessageAction {
                    // Proto3 omits message_id and mode from the encoded wire request.
                    user_message: Some(pb::UserMessage {
                        text: prompt.into(),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )),
            ..Default::default()
        }),
        requested_model: Some(pb::RequestedModel {
            model_id: "test-model".into(),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn user(request: &mut pb::AgentRunRequest) -> &mut pb::UserMessage {
    let Some(pb::conversation_action::Action::UserMessageAction(action)) =
        request.action.as_mut().and_then(|a| a.action.as_mut())
    else {
        panic!("user action")
    };
    action.user_message.as_mut().unwrap()
}

fn stop(id: &str, result: &str) -> Vec<ModelEvent> {
    vec![
        ModelEvent::Start {
            model_call_id: id.into(),
        },
        ModelEvent::TextStart,
        ModelEvent::TextDelta(result.into()),
        ModelEvent::TextEnd,
        ModelEvent::Done(FinishReason::Stop),
    ]
}

fn text(content: &ProjectedContent) -> String {
    let ProjectedContent::Parts(parts) = content else {
        return String::new();
    };
    parts
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

type Blobs = HashMap<Vec<u8>, Vec<u8>>;

fn checkpoint_user(state: &pb::ConversationStateStructure, blobs: &Blobs) -> pb::UserMessage {
    let turn = pb::ConversationTurnStructure::decode(blobs[state.turns.last().unwrap()].as_slice())
        .unwrap();
    let Some(pb::conversation_turn_structure::Turn::AgentConversationTurn(turn)) = turn.turn else {
        panic!("agent turn")
    };
    pb::UserMessage::decode(blobs[&turn.user_message].as_slice()).unwrap()
}

async fn append(handle: &TransportHandle, seqno: &mut i64, message: pb::AgentClientMessage) {
    handle
        .command(TransportCommand::Append {
            seqno: *seqno,
            message: Box::new(message),
        })
        .await
        .unwrap();
    *seqno += 1;
}

async fn drive(
    registry: &TransportRegistry,
    request_id: &str,
    request: pb::AgentRunRequest,
) -> (pb::ConversationStateStructure, Blobs) {
    let handle = registry.get_or_create(request_id).await.unwrap();
    let mut output = handle.subscribe();
    let mut seqno = 0;
    let wire = pb::AgentClientMessage {
        message: Some(pb::agent_client_message::Message::RunRequest(request)),
    }
    .encode_to_vec();
    append(
        &handle,
        &mut seqno,
        pb::AgentClientMessage::decode(wire.as_slice()).unwrap(),
    )
    .await;
    let mut checkpoint = None;
    let mut blobs = Blobs::new();
    loop {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(10), output.recv())
            .await
            .expect("Cursor response timeout")
            .unwrap();
        let (flags, payload) = connect::decode_frames(&frame).unwrap().pop().unwrap();
        if flags & connect::END_STREAM_FLAG != 0 {
            let end: serde_json::Value = serde_json::from_slice(&payload).unwrap();
            assert_eq!(
                end,
                serde_json::json!({}),
                "Cursor stream must complete successfully"
            );
            break;
        }
        match pb::AgentServerMessage::decode(payload).unwrap().message {
            Some(pb::agent_server_message::Message::KvServerMessage(kv)) => {
                let Some(pb::kv_server_message::Message::SetBlobArgs(set)) = kv.message else {
                    panic!("expected blob publication")
                };
                blobs.insert(set.blob_id, set.blob_data);
                append(
                    &handle,
                    &mut seqno,
                    pb::AgentClientMessage {
                        message: Some(pb::agent_client_message::Message::KvClientMessage(
                            pb::KvClientMessage {
                                id: kv.id,
                                message: Some(pb::kv_client_message::Message::SetBlobResult(
                                    pb::SetBlobResult { error: None },
                                )),
                            },
                        )),
                    },
                )
                .await;
            }
            Some(pb::agent_server_message::Message::ExecServerMessage(exec)) => {
                let Some(pb::exec_server_message::Message::SubagentArgs(args)) = exec.message
                else {
                    panic!("expected subagent dispatch")
                };
                assert_eq!(args.parent_conversation_id.as_deref(), Some("parent"));
                assert_eq!(args.root_parent_conversation_id.as_deref(), Some("parent"));
                assert_eq!(args.model_id, "test-model");
                let (child_checkpoint, child_blobs) = Box::pin(drive(
                    registry,
                    "child-transport",
                    child_request("child", &args.prompt, None),
                ))
                .await;
                assert!(!checkpoint_user(&child_checkpoint, &child_blobs)
                    .message_id
                    .is_empty());
                append(
                    &handle,
                    &mut seqno,
                    pb::AgentClientMessage {
                        message: Some(pb::agent_client_message::Message::ExecClientMessage(
                            pb::ExecClientMessage {
                                id: exec.id,
                                message: Some(pb::exec_client_message::Message::SubagentResult(
                                    pb::SubagentResult {
                                        result: Some(pb::subagent_result::Result::Success(
                                            pb::SubagentSuccess {
                                                agent_id: "child".into(),
                                                final_message: Some("child result".into()),
                                                ..Default::default()
                                            },
                                        )),
                                    },
                                )),
                                ..Default::default()
                            },
                        )),
                    },
                )
                .await;
                append(
                    &handle,
                    &mut seqno,
                    pb::AgentClientMessage {
                        message: Some(pb::agent_client_message::Message::ExecClientControlMessage(
                            pb::ExecClientControlMessage {
                                message: Some(
                                    pb::exec_client_control_message::Message::StreamClose(
                                        pb::ExecClientStreamClose { id: exec.id },
                                    ),
                                ),
                            },
                        )),
                    },
                )
                .await;
            }
            Some(pb::agent_server_message::Message::ConversationCheckpointUpdate(state))
                if state.pending_tool_calls.is_empty() =>
            {
                checkpoint = Some(state)
            }
            _ => {}
        }
    }
    (checkpoint.expect("settled checkpoint"), blobs)
}
