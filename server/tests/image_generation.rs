//! Drives the native Cursor approval and file-write protocol against a local Images API.
#[path = "support/fake_provider.rs"]
mod fake_provider;
#[path = "support/fixtures.rs"]
mod fixtures;

use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{routing::post, Json, Router};
use base64::{engine::general_purpose::STANDARD, Engine};
use cursor_server::{
    cursor::{
        prompting::{PromptAssets, PromptCompiler},
        protocol::{connect, proto::agent::v1 as pb},
        TransportCommand, TransportHandle, TransportRegistry,
    },
    model::{
        ModelConfigInput, ProjectedContent, OPENAI_CHAT_ENDPOINT, OPENAI_IMAGE_GENERATION_ENDPOINT,
    },
    provider::{FinishReason, ModelEvent},
};
use pb::{agent_client_message::Message as Client, agent_server_message::Message as Server};
use prost::Message;
use serde_json::{json, Value};

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==";
const TEST_KEY: &str = "secret-image-generation-test";

fn config(id: &str, endpoint: &str, base_url: &str) -> ModelConfigInput {
    serde_json::from_value(json!({
        "type":"openai", "api_key":TEST_KEY, "model_id":id, "display_name":id,
        "tooltip_data":if endpoint == OPENAI_IMAGE_GENERATION_ENDPOINT { "" } else { id },
        "base_url":base_url, "openai_endpoint":endpoint
    }))
    .unwrap()
}

fn run(chat: &str, workspace: &Path) -> Client {
    let action = pb::UserMessageAction {
        user_message: Some(pb::UserMessage {
            text: "Generate two images".into(),
            message_id: "user".into(),
            mode: pb::AgentMode::Agent as i32,
            ..Default::default()
        }),
        request_context: Some(pb::RequestContext {
            env: Some(pb::RequestContextEnv {
                workspace_paths: vec![workspace.to_str().unwrap().into()],
                ..Default::default()
            }),
            ..Default::default()
        }),
        ..Default::default()
    };
    Client::RunRequest(pb::AgentRunRequest {
        conversation_id: Some("image-conversation".into()),
        requested_model: Some(pb::RequestedModel {
            model_id: chat.into(),
            ..Default::default()
        }),
        action: Some(pb::ConversationAction {
            action: Some(pb::conversation_action::Action::UserMessageAction(action)),
            ..Default::default()
        }),
        ..Default::default()
    })
}

fn image_call(id: &str, model: &str) -> Vec<ModelEvent> {
    vec![
        ModelEvent::Start {
            model_call_id: format!("model-{id}"),
        },
        ModelEvent::ToolCallStart {
            index: 0,
            call_id: id.into(),
            name: "GenerateImage".into(),
        },
        ModelEvent::ToolCallArgumentsDelta {
            index: 0,
            delta: json!({"description":"Draw a pear", "filename":"pear.png", "model":model})
                .to_string(),
        },
        ModelEvent::ToolCallEnd { index: 0 },
        ModelEvent::Done(FinishReason::ToolUse),
    ]
}

async fn append(handle: &TransportHandle, seqno: &mut i64, message: Client) {
    handle
        .command(TransportCommand::Append {
            seqno: *seqno,
            message: Box::new(pb::AgentClientMessage {
                message: Some(message),
            }),
        })
        .await
        .unwrap();
    *seqno += 1;
}

fn approval(id: u32, accept: bool) -> Client {
    use pb::generate_image_request_response::{Approved, Rejected, Result};
    let result = if accept {
        Result::Approved(Approved {
            description: "Draw a green pear".into(),
        })
    } else {
        Result::Rejected(Rejected {
            reason: "Skipped second image".into(),
        })
    };
    Client::InteractionResponse(pb::InteractionResponse {
        id,
        result: Some(
            pb::interaction_response::Result::GenerateImageRequestResponse(
                pb::GenerateImageRequestResponse {
                    result: Some(result),
                },
            ),
        ),
    })
}

#[tokio::test]
async fn agent_discovers_image_models_writes_approved_output_and_skips_rejection() {
    let (_database, store) = fixtures::temp_store().await;
    let workspace = tempfile::tempdir().unwrap();
    let upstream_requests = Arc::new(Mutex::new(Vec::new()));
    let received = upstream_requests.clone();
    let app = Router::new().route(
        "/v1/images/generations",
        post(move |Json(body): Json<Value>| {
            let received = received.clone();
            async move {
                received.lock().unwrap().push(body);
                Json(json!({"data":[{"b64_json":PNG}]}))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let chat = store
        .create_model(&config("chat", OPENAI_CHAT_ENDPOINT, &url))
        .await
        .unwrap();
    let first = store
        .create_model(&config("image-a", OPENAI_IMAGE_GENERATION_ENDPOINT, &url))
        .await
        .unwrap();
    let second = store
        .create_model(&config("image-b", OPENAI_IMAGE_GENERATION_ENDPOINT, &url))
        .await
        .unwrap();
    let provider = fake_provider::FakeProvider::default();
    provider.push(image_call("approved-call", &second.model_hash));
    provider.push(image_call("rejected-call", &first.model_hash));
    provider.push(vec![
        ModelEvent::Start {
            model_call_id: "done".into(),
        },
        ModelEvent::TextStart,
        ModelEvent::TextDelta("done".into()),
        ModelEvent::TextEnd,
        ModelEvent::Done(FinishReason::Stop),
    ]);
    let assets =
        PromptAssets::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("prompt/cursor")).unwrap();
    let registry = TransportRegistry::new(
        store,
        Arc::new(provider.clone()),
        PromptCompiler::new(assets),
    );
    let handle = registry
        .get_or_create("image-generation-test")
        .await
        .unwrap();
    let mut output = handle.subscribe();
    let mut seqno = 0;
    append(&handle, &mut seqno, run(&chat.model_hash, workspace.path())).await;

    let mut saved_path = None;
    let mut approvals = 0;
    let mut results = Vec::new();
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(10), output.recv())
            .await
            .expect("Cursor receives a frame within 10 seconds")
            .unwrap();
        let (flags, payload) = connect::decode_frames(&frame).unwrap().pop().unwrap();
        if flags & connect::END_STREAM_FLAG != 0 {
            assert_eq!(
                serde_json::from_slice::<Value>(&payload).unwrap(),
                json!({})
            );
            break;
        }
        let server_message = pb::AgentServerMessage::decode(payload)
            .unwrap()
            .message
            .unwrap();
        match server_message {
            Server::KvServerMessage(kv) => {
                append(
                    &handle,
                    &mut seqno,
                    Client::KvClientMessage(pb::KvClientMessage {
                        id: kv.id,
                        message: Some(pb::kv_client_message::Message::SetBlobResult(
                            pb::SetBlobResult { error: None },
                        )),
                    }),
                )
                .await;
            }
            Server::InteractionQuery(query) => {
                let Some(pb::interaction_query::Query::GenerateImageRequestQuery(image)) =
                    query.query
                else {
                    panic!("expected native image approval");
                };
                assert_eq!(upstream_requests.lock().unwrap().len(), approvals);
                let accept = approvals == 0;
                assert_eq!(
                    image.tool_call_id,
                    if accept {
                        "approved-call"
                    } else {
                        "rejected-call"
                    }
                );
                if accept {
                    let request = &provider.requests()[0];
                    assert!(request
                        .prompt
                        .tools
                        .iter()
                        .any(|tool| tool.name == "GenerateImage"));
                    let visible = serde_json::to_string(request).unwrap();
                    assert!(visible.contains("<image_generation_models>"));
                    for model in [&first, &second] {
                        assert!(visible.contains(&model.model_id));
                        assert!(visible.contains(&model.model_hash));
                    }
                    assert!(!visible.contains(TEST_KEY));
                    assert!(!visible.contains(&url));
                }
                approvals += 1;
                append(&handle, &mut seqno, approval(query.id, accept)).await;
            }
            Server::ExecServerMessage(exec) => {
                let Some(pb::exec_server_message::Message::WriteArgs(write)) = exec.message else {
                    panic!("expected binary write to the client workspace");
                };
                assert_eq!(approvals, 1);
                assert!(saved_path.is_none());
                let path = Path::new(&write.path);
                assert_eq!(path.parent(), Some(workspace.path()));
                assert_eq!(path.extension().unwrap(), "png");
                assert!(!path.exists());
                assert_eq!(write.file_bytes, STANDARD.decode(PNG).unwrap());
                std::fs::write(path, &write.file_bytes).unwrap();
                saved_path = Some(write.path.clone());
                append(
                    &handle,
                    &mut seqno,
                    Client::ExecClientMessage(pb::ExecClientMessage {
                        id: exec.id,
                        exec_id: exec.exec_id,
                        message: Some(pb::exec_client_message::Message::WriteResult(
                            pb::WriteResult {
                                result: Some(pb::write_result::Result::Success(pb::WriteSuccess {
                                    path: write.path,
                                    file_size: write.file_bytes.len() as i32,
                                    ..Default::default()
                                })),
                            },
                        )),
                        ..Default::default()
                    }),
                )
                .await;
                append(
                    &handle,
                    &mut seqno,
                    Client::ExecClientControlMessage(pb::ExecClientControlMessage {
                        message: Some(pb::exec_client_control_message::Message::StreamClose(
                            pb::ExecClientStreamClose { id: exec.id },
                        )),
                    }),
                )
                .await;
            }
            Server::InteractionUpdate(update) => {
                if let Some(pb::interaction_update::Message::ToolCallCompleted(completed)) =
                    update.message
                {
                    let Some(pb::tool_call::Tool::GenerateImageToolCall(image)) =
                        completed.tool_call.unwrap().tool
                    else {
                        panic!("expected completion for GenerateImage");
                    };
                    results.push(image.result.unwrap().result.unwrap());
                }
            }
            _ => {}
        }
    }
    assert_eq!(approvals, 2);
    let path = saved_path.expect("client wrote the generated image");
    assert_eq!(std::fs::read(&path).unwrap(), STANDARD.decode(PNG).unwrap());
    assert!(
        matches!(results.as_slice(), [pb::generate_image_result::Result::Success(ok), pb::generate_image_result::Result::Error(_)] if ok.file_path == path && ok.image_data.is_empty())
    );
    let upstream = upstream_requests.lock().unwrap();
    assert_eq!(
        upstream.len(),
        1,
        "rejected generation must never call the Images API"
    );
    assert_eq!(upstream[0]["model"], "image-b");
    assert_eq!(upstream[0]["prompt"], "Draw a green pear");
    let requests = provider.requests();
    assert_eq!(requests.len(), 3);
    let outcome = |request: &cursor_server::model::ModelRequest, rejected| {
        request
            .history
            .iter()
            .any(|message| match &message.content {
                ProjectedContent::ToolResult(result) if result.is_error == rejected => {
                    if rejected {
                        result.content.contains("Skipped second image")
                    } else {
                        result
                            .content
                            .contains(Path::new(&path).file_name().unwrap().to_str().unwrap())
                    }
                }
                _ => false,
            })
    };
    assert!(outcome(&requests[1], false));
    assert!(outcome(&requests[2], true));
    assert!(!serde_json::to_string(&requests[2]).unwrap().contains(PNG));
    server.abort();
}

#[tokio::test]
async fn cancelling_an_in_flight_image_never_sends_a_workspace_write() {
    use tokio::sync::Notify;
    let (_db, store) = fixtures::temp_store().await;
    let workspace = tempfile::tempdir().unwrap();
    let requested = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let endpoint = {
        let requested = requested.clone();
        let release = release.clone();
        post(move || {
            let requested = requested.clone();
            let release = release.clone();
            async move {
                requested.notify_one();
                release.notified().await;
                Json(json!({"data":[{"b64_json":PNG}]}))
            }
        })
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new().route("/v1/images/generations", endpoint);
    let upstream = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let chat = store
        .create_model(&config("chat", OPENAI_CHAT_ENDPOINT, &url))
        .await
        .unwrap();
    let image = store
        .create_model(&config("image", OPENAI_IMAGE_GENERATION_ENDPOINT, &url))
        .await
        .unwrap();
    let provider = fake_provider::FakeProvider::default();
    provider.push(image_call("cancelled-call", &image.model_hash));
    let registry = TransportRegistry::new(
        store,
        Arc::new(provider),
        PromptCompiler::new(PromptAssets::embedded().unwrap()),
    );
    let handle = registry.get_or_create("image-cancel-test").await.unwrap();
    let mut output = handle.subscribe();
    let mut seqno = 0;
    append(&handle, &mut seqno, run(&chat.model_hash, workspace.path())).await;
    let mut cancelled = false;
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let frame = output.recv().await.unwrap();
            let (flags, payload) = connect::decode_frames(&frame).unwrap().pop().unwrap();
            if flags & connect::END_STREAM_FLAG != 0 {
                assert!(cancelled);
                break;
            }
            let message = pb::AgentServerMessage::decode(payload)
                .unwrap()
                .message
                .unwrap();
            match message {
                Server::KvServerMessage(kv) => {
                    append(
                        &handle,
                        &mut seqno,
                        Client::KvClientMessage(pb::KvClientMessage {
                            id: kv.id,
                            message: Some(pb::kv_client_message::Message::SetBlobResult(
                                pb::SetBlobResult { error: None },
                            )),
                        }),
                    )
                    .await;
                }
                Server::InteractionQuery(query) => {
                    assert!(!cancelled);
                    append(&handle, &mut seqno, approval(query.id, true)).await;
                    requested.notified().await;
                    append(
                        &handle,
                        &mut seqno,
                        Client::ConversationAction(pb::ConversationAction {
                            action: Some(pb::conversation_action::Action::CancelAction(
                                pb::CancelAction::default(),
                            )),
                            ..Default::default()
                        }),
                    )
                    .await;
                    cancelled = true;
                    release.notify_one();
                }
                Server::ExecServerMessage(exec) => assert!(!matches!(
                    exec.message,
                    Some(pb::exec_server_message::Message::WriteArgs(_))
                )),
                _ => {}
            }
        }
    })
    .await
    .unwrap();
    upstream.abort();
}
