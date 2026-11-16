//! Keeps Cursor's per-turn classification calls local for BYOK models.
//!
//! On the RunInference path Cursor's client reports every turn to
//! `aiserver.v1.InferenceService` for follow-up classification and post-turn labeling. Each
//! report carries the turn's full messages and the selected model id. Cursor cannot resolve a
//! BYOK model id, so it rejects the report, and the conversation has already left the machine.
//! Reports for BYOK models are acknowledged here instead; Cursor's own models still reach Cursor.
use axum::{
    body::{to_bytes, Body},
    extract::{Extension, Request, State},
    http::{header, HeaderValue, Response, StatusCode},
};
use prost::Message;

use crate::{
    api::cursor::proxy::{self, CursorProxy},
    cursor::{
        protocol::{
            connect,
            proto::aiserver::v1::{
                AgentFollowupCategorizationRequest, AgentPostTurnLabelingRequest,
            },
        },
        transport::TransportRegistry,
    },
    Error, Result,
};

pub const FOLLOWUP_CLASSIFICATION_PATH: &str =
    "/aiserver.v1.InferenceService/RecordAgentFollowupClassification";
pub const POST_TURN_LABELING_PATH: &str =
    "/aiserver.v1.InferenceService/RecordAgentPostTurnLabeling";

pub async fn followup_classification(
    State(registry): State<TransportRegistry>,
    Extension(upstream): Extension<CursorProxy>,
    request: Request<Body>,
) -> Result<Response<Body>> {
    route::<AgentFollowupCategorizationRequest>(&registry, upstream, request, |report| {
        report.model_name
    })
    .await
}

pub async fn post_turn_labeling(
    State(registry): State<TransportRegistry>,
    Extension(upstream): Extension<CursorProxy>,
    request: Request<Body>,
) -> Result<Response<Body>> {
    route::<AgentPostTurnLabelingRequest>(&registry, upstream, request, |report| report.model_name)
        .await
}

async fn route<M: Message + Default>(
    registry: &TransportRegistry,
    upstream: CursorProxy,
    request: Request<Body>,
    model_name: impl FnOnce(M) -> Option<String>,
) -> Result<Response<Body>> {
    let (parts, body) = request.into_parts();
    let body = to_bytes(body, usize::MAX)
        .await
        .map_err(|error| Error::Protocol(format!("cannot read request body: {error}")))?;
    let model_id = model_name(connect::decode_unary(&body)?).unwrap_or_default();
    if registry.inference().byok_model(&model_id).await?.is_some() {
        return Ok(acknowledged());
    }
    proxy::forward(
        Extension(upstream),
        Request::from_parts(parts, Body::from(body)),
    )
    .await
}

/// `google.protobuf.Empty`, which encodes to no bytes.
fn acknowledged() -> Response<Body> {
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::OK;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/proto"),
    );
    response
}
