//! Exercises Cursor's binary BidiAppend messages through the Agent HTTP transport.
#[path = "support/fake_provider.rs"]
mod fake_provider;
#[path = "support/fixtures.rs"]
mod fixtures;

use std::{sync::Arc, time::Duration};

use axum::{
    body::Body,
    http::{header, Request, StatusCode},
    Router,
};
use cursor_server::{
    api::cursor::{self, bidi},
    cursor::{
        prompting::{PromptAssets, PromptCompiler},
        protocol::{
            connect,
            proto::{agent::v1 as pb, aiserver::v1 as ai},
        },
        transport::TransportRegistry,
    },
    model::{ModelConfigInput, ModelType, OPENAI_CHAT_ENDPOINT},
    network::NetworkClients,
    provider::{FinishReason, ModelEvent},
};
use futures_util::StreamExt;
use prost::Message;
use serde_json::json;
use tower::ServiceExt;

fn client_run(model_id: &str) -> pb::AgentClientMessage {
    pb::AgentClientMessage {
        message: Some(pb::agent_client_message::Message::RunRequest(
            pb::AgentRunRequest {
                action: Some(pb::ConversationAction {
                    action: Some(pb::conversation_action::Action::UserMessageAction(
                        pb::UserMessageAction {
                            user_message: Some(pb::UserMessage {
                                text: "hello binary transport".into(),
                                message_id: "binary-user".into(),
                                mode: pb::AgentMode::Agent as i32,
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                    )),
                    ..Default::default()
                }),
                conversation_id: Some("binary-conversation".into()),
                requested_model: Some(pb::RequestedModel {
                    model_id: model_id.into(),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )),
    }
}

fn wire_append(request_id: &str, seqno: i64, message: &pb::AgentClientMessage) -> Vec<u8> {
    ai::BidiAppendRequest {
        request_id: Some(ai::BidiRequestId {
            request_id: request_id.into(),
        }),
        append_seqno: seqno,
        data_binary: message.encode_to_vec(),
        ..Default::default()
    }
    .encode_to_vec()
}

async fn append(router: &Router, request_id: &str, seqno: i64, message: &pb::AgentClientMessage) {
    let response = router
        .clone()
        .oneshot(
            Request::post("/aiserver.v1.BidiService/BidiAppend")
                .header(header::CONTENT_TYPE, "application/proto")
                .body(Body::from(wire_append(request_id, seqno, message)))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[test]
fn binary_and_hex_are_current_cursor_encodings_of_the_same_message() {
    let message = client_run("model");
    let payload = message.encode_to_vec();
    let request = ai::BidiAppendRequest {
        request_id: Some(ai::BidiRequestId {
            request_id: "binary-request".into(),
        }),
        append_seqno: 4,
        data_binary: payload.clone(),
        ..Default::default()
    };
    let raw = bidi::raw(&request).expect("binary payload accepted");
    let decoded = bidi::decode(&raw).unwrap();
    assert_eq!(raw.request_id, "binary-request");
    assert_eq!(raw.seqno, 4);
    assert_eq!(decoded.message, message);

    let hex = ai::BidiAppendRequest {
        data: hex::encode(payload),
        data_binary: Vec::new(),
        ..request
    };
    assert_eq!(
        bidi::decode(&bidi::raw(&hex).unwrap()).unwrap().message,
        message
    );
}

#[test]
fn ambiguous_payloads_are_rejected_before_model_routing() {
    let request = ai::BidiAppendRequest {
        request_id: Some(ai::BidiRequestId {
            request_id: "ambiguous-request".into(),
        }),
        data: "00".into(),
        data_binary: vec![1],
        ..Default::default()
    };
    assert!(bidi::raw(&request).is_err());
}

#[tokio::test]
async fn binary_agent_request_streams_model_output_and_finishes() {
    let (_directory, store) = fixtures::temp_store().await;
    let model = store
        .create_model(&ModelConfigInput {
            sort_order: 0,
            display_name: "Binary test".into(),
            group_name: None,
            model_type: ModelType::OpenAi,
            base_url: "https://example.com/v1".into(),
            use_full_url: false,
            api_key: "test".into(),
            tooltip_data: "test".into(),
            model_id: "test-model".into(),
            reasoning_effort: None,
            openai_endpoint: OPENAI_CHAT_ENDPOINT.into(),
            openai_extra_params_enabled: false,
            openai_extra_params: json!({}),
            custom_headers_enabled: false,
            custom_headers: json!({}),
            anthropic_extra_params_enabled: false,
            anthropic_extra_params: json!({}),
            context_window_tokens: Some(200_000),
            max_completion_tokens: None,
            anthropic_max_tokens: None,
            anthropic_thinking_effort: None,
            thinking_budget_tokens: None,
        })
        .await
        .unwrap();
    let provider = fake_provider::FakeProvider::default();
    provider.push(vec![
        ModelEvent::Start {
            model_call_id: "binary-call".into(),
        },
        ModelEvent::TextStart,
        ModelEvent::TextDelta("binary works".into()),
        ModelEvent::TextEnd,
        ModelEvent::Done(FinishReason::Stop),
    ]);
    let assets =
        PromptAssets::load(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("prompt/cursor"))
            .unwrap();
    let registry = TransportRegistry::new(
        store.clone(),
        Arc::new(provider.clone()),
        PromptCompiler::new(assets),
    );
    let router = cursor::router(registry, NetworkClients::new(store)).unwrap();
    let request_id = "binary-agent-request";
    let stream_request = Request::post("/agent.v1.AgentService/RunSSE")
        .header(header::CONTENT_TYPE, "application/proto")
        .body(Body::from(
            pb::BidiRequestId {
                request_id: request_id.into(),
            }
            .encode_to_vec(),
        ))
        .unwrap();
    let stream_router = router.clone();
    let stream = tokio::spawn(async move { stream_router.oneshot(stream_request).await.unwrap() });

    append(&router, request_id, 0, &client_run(&model.model_hash)).await;
    let response = tokio::time::timeout(Duration::from_secs(5), stream)
        .await
        .expect("RunSSE is routed after the binary request")
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let mut body = response.into_body().into_data_stream();
    append(
        &router,
        request_id,
        1,
        &pb::AgentClientMessage {
            message: Some(pb::agent_client_message::Message::ClientHeartbeat(
                pb::ClientHeartbeat {},
            )),
        },
    )
    .await;

    let mut seqno = 2;
    let mut text = String::new();
    let mut saw_heartbeat = false;
    let mut saw_turn_ended = false;
    loop {
        let chunk = tokio::time::timeout(Duration::from_secs(10), body.next())
            .await
            .expect("stream frame within 10 seconds")
            .expect("stream remains open until EndStream")
            .unwrap();
        for (flags, payload) in connect::decode_frames(&chunk).unwrap() {
            if flags & connect::END_STREAM_FLAG != 0 {
                assert_eq!(
                    serde_json::from_slice::<serde_json::Value>(&payload).unwrap(),
                    json!({})
                );
                assert_eq!(text, "binary works");
                assert!(saw_heartbeat);
                assert!(saw_turn_ended);
                assert_eq!(provider.requests().len(), 1);
                return;
            }
            let message = pb::AgentServerMessage::decode(payload).unwrap();
            match message.message {
                Some(pb::agent_server_message::Message::KvServerMessage(kv)) => {
                    let ack = pb::AgentClientMessage {
                        message: Some(pb::agent_client_message::Message::KvClientMessage(
                            pb::KvClientMessage {
                                id: kv.id,
                                message: Some(pb::kv_client_message::Message::SetBlobResult(
                                    pb::SetBlobResult { error: None },
                                )),
                            },
                        )),
                    };
                    append(&router, request_id, seqno, &ack).await;
                    seqno += 1;
                }
                Some(pb::agent_server_message::Message::InteractionUpdate(update)) => {
                    match update.message {
                        Some(pb::interaction_update::Message::TextDelta(delta)) => {
                            text.push_str(&delta.text)
                        }
                        Some(pb::interaction_update::Message::Heartbeat(_)) => saw_heartbeat = true,
                        Some(pb::interaction_update::Message::TurnEnded(_)) => {
                            saw_turn_ended = true
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}
