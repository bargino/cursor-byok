//! Serves Cursor's RunInference protocol, where Cursor runs the agent loop and BYOK only
//! answers model invocations.
//!
//! Cursor ── BidiAppend(RunInferenceClientMessage) ──► InferenceSession ── Provider
//!        ◄── RunInferenceSSE(RunInferenceServerMessage) ──┘
mod replay;
mod request;
mod response;
mod session;

use std::{collections::HashMap, sync::Arc};

use tokio::sync::Mutex;

use crate::{
    model::{ModelConfig, ModelSpec, ProviderType},
    plugin::ADAPTER_ID_PREFIX,
    provider::Provider,
    store::Store,
    Result,
};

pub use session::InferenceSession;

/// A model BYOK serves instead of Cursor.
#[derive(Clone)]
pub enum ByokModel {
    /// A model saved in BYOK settings.
    Configured(Box<ModelConfig>),
    /// A model served by a plugin adapter.
    Plugin,
}

impl ByokModel {
    pub fn provider_type(&self) -> ProviderType {
        match self {
            Self::Configured(model) => model.provider_type(),
            Self::Plugin => ProviderType::Plugin,
        }
    }

    /// Fills what Cursor left out of the request from the saved model settings.
    fn configure(&self, model: &mut ModelSpec) {
        if let Self::Configured(saved) = self {
            saved.configure(model);
        }
    }
}

/// Maps request IDs to the RunInference streams BYOK serves locally.
#[derive(Clone)]
pub struct InferenceRegistry {
    inner: Arc<Inner>,
}

struct Inner {
    store: Store,
    provider: Arc<dyn Provider>,
    sessions: Mutex<HashMap<String, Arc<InferenceSession>>>,
}

impl InferenceRegistry {
    pub fn new(store: Store, provider: Arc<dyn Provider>) -> Self {
        Self {
            inner: Arc::new(Inner {
                store,
                provider,
                sessions: Mutex::new(HashMap::new()),
            }),
        }
    }

    /// Returns the BYOK model behind a Cursor model id, or `None` for Cursor's own models.
    pub async fn byok_model(&self, model_id: &str) -> Result<Option<ByokModel>> {
        if model_id.starts_with(ADAPTER_ID_PREFIX) {
            return Ok(Some(ByokModel::Plugin));
        }
        Ok(self
            .inner
            .store
            .chat_model(model_id)
            .await?
            .map(|model| ByokModel::Configured(Box::new(model))))
    }

    pub async fn get(&self, request_id: &str) -> Option<Arc<InferenceSession>> {
        self.inner.sessions.lock().await.get(request_id).cloned()
    }

    pub async fn contains(&self, request_id: &str) -> bool {
        self.inner.sessions.lock().await.contains_key(request_id)
    }

    pub async fn create(&self, request_id: &str, byok: ByokModel) -> Arc<InferenceSession> {
        let mut sessions = self.inner.sessions.lock().await;
        if let Some(session) = sessions.get(request_id) {
            return session.clone();
        }
        let session = Arc::new(InferenceSession::new(
            request_id.into(),
            byok,
            self.inner.provider.clone(),
        ));
        sessions.insert(request_id.into(), session.clone());
        drop(sessions);
        let inner = Arc::downgrade(&self.inner);
        let request_id = request_id.to_owned();
        let finished = session.clone();
        tokio::spawn(async move {
            finished.finished().await;
            if let Some(inner) = inner.upgrade() {
                let mut sessions = inner.sessions.lock().await;
                if sessions
                    .get(&request_id)
                    .is_some_and(|current| Arc::ptr_eq(current, &finished))
                {
                    sessions.remove(&request_id);
                }
            }
        });
        session
    }

    pub async fn shutdown(&self) {
        let sessions = std::mem::take(&mut *self.inner.sessions.lock().await);
        for session in sessions.into_values() {
            session.disconnect();
        }
    }
}
