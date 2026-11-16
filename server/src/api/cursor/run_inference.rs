//! Serves Cursor's `aiserver.v1.InferenceService/RunInference` over RunInferenceSSE + BidiAppend.
use std::convert::Infallible;

use axum::{
    body::{Body, Bytes},
    extract::Extension,
    http::{header, HeaderValue, Request, Response, StatusCode},
};
use prost::Message;

use crate::{
    api::cursor::{bidi::RawAppend, proxy, run_sse},
    cursor::{
        inference::InferenceSession,
        protocol::proto::aiserver::v1::{run_inference_client_message, RunInferenceClientMessage},
        transport::{StreamKind, TransportRegistry, TransportRoute},
    },
    Error, Result,
};

pub const SSE_PATH: &str = "/aiserver.v1.InferenceService/RunInferenceSSE";

pub async fn sse(
    registry: TransportRegistry,
    upstream: proxy::CursorProxy,
    parts: axum::http::request::Parts,
    body: Bytes,
    request_id: String,
) -> Result<Response<Body>> {
    let registration = registry.open_stream(&request_id, StreamKind::Inference);
    let response = match registry.wait_route(&request_id).await {
        TransportRoute::Local => {
            let session = registry.inference().get(&request_id).await.ok_or_else(|| {
                Error::Protocol(format!("RunInference stream {request_id} already ended"))
            })?;
            local(session)
        }
        TransportRoute::Upstream(generation) => {
            let response = proxy::forward(
                Extension(upstream),
                Request::from_parts(parts, Body::from(body)),
            )
            .await?;
            run_sse::upstream(registry, request_id, generation, response, None).await
        }
    };
    Ok(run_sse::holding(response, registration))
}

fn local(session: std::sync::Arc<InferenceSession>) -> Response<Body> {
    let mut receiver = session.subscribe();
    let stream = async_stream::stream! {
        let _disconnect = Disconnect(session);
        while let Some(frame) = receiver.recv().await {
            yield Ok::<Bytes, Infallible>(frame);
        }
    };
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert("connect-protocol-version", HeaderValue::from_static("1"));
    response
}

/// Ends the RunInference session when Cursor stops reading its stream.
struct Disconnect(std::sync::Arc<InferenceSession>);

impl Drop for Disconnect {
    fn drop(&mut self) {
        self.0.disconnect();
    }
}

/// Handles one RunInference BidiAppend. The first message must be `run_request`, which picks
/// between serving the stream locally (a BYOK model) and forwarding it to Cursor.
pub async fn append(
    registry: &TransportRegistry,
    upstream: proxy::CursorProxy,
    request: Request<Body>,
    append: RawAppend,
) -> Result<Response<Body>> {
    let message = RunInferenceClientMessage::decode(append.payload.as_slice())?;
    let session = match registry.inference().get(&append.request_id).await {
        Some(session) => Some(session),
        None if registry.upstream(&append.request_id).await => None,
        None => {
            let Some(run_inference_client_message::Message::RunRequest(run)) =
                message.message.as_ref()
            else {
                return Err(Error::Protocol(
                    "first RunInference BidiAppend message must be run_request".into(),
                ));
            };
            let model_id = run
                .requested_model
                .as_ref()
                .map(|model| model.model_id.as_str())
                .unwrap_or_default();
            match registry.inference().byok_model(model_id).await? {
                Some(byok) => {
                    tracing::info!(
                        request_id = append.request_id,
                        model_id,
                        "routing Cursor RunInference to BYOK provider"
                    );
                    Some(registry.create_inference(&append.request_id, byok).await)
                }
                None => {
                    tracing::info!(
                        request_id = append.request_id,
                        model_id,
                        "routing Cursor RunInference to Cursor upstream"
                    );
                    registry.mark_upstream(&append.request_id).await;
                    None
                }
            }
        }
    };
    let Some(session) = session else {
        return proxy::forward(Extension(upstream), request).await;
    };
    session.append(append.seqno, message);
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/proto"),
    );
    Ok(response)
}
