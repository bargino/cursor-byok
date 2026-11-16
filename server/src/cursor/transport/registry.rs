//! Maps request IDs to active transport handles.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use tokio::sync::{mpsc, Mutex, Notify};

use crate::{
    cursor::{
        conversation::ConversationRegistry, inference::InferenceRegistry,
        prompting::PromptCompiler, services::observability::CursorTraceService,
    },
    plugin::PluginRegistry,
    provider::Provider,
    search::WebCache,
    store::Store,
    Result,
};

use super::{OutputHub, TransportHandle};

#[derive(Clone)]
pub struct TransportRegistry {
    inner: Arc<RegistryInner>,
}

struct RegistryInner {
    local: Mutex<HashMap<String, LocalTransport>>,
    next_local_generation: AtomicU64,
    upstream: Mutex<HashMap<String, u64>>,
    route_changed: Notify,
    streams: parking_lot::Mutex<HashMap<String, OpenStream>>,
    inference: InferenceRegistry,
    store: Store,
    traces: CursorTraceService,
    web_cache: WebCache,
    plugins: Option<PluginRegistry>,
    conversations: ConversationRegistry,
}

#[derive(Clone)]
struct LocalTransport {
    generation: u64,
    handle: TransportHandle,
}

/// The Cursor downstream stream a request ID belongs to. Both protocols send their
/// client messages through the same `BidiAppend` call, so only the stream tells them apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamKind {
    /// `agent.v1.AgentService/RunSSE`: BYOK runs the agent loop.
    Agent,
    /// `aiserver.v1.InferenceService/RunInferenceSSE`: Cursor runs the agent loop.
    Inference,
}

struct OpenStream {
    kind: StreamKind,
    open: usize,
}

/// Keeps a request ID's stream kind registered while its downstream response is alive.
pub struct StreamRegistration {
    registry: std::sync::Weak<RegistryInner>,
    request_id: String,
}

impl Drop for StreamRegistration {
    fn drop(&mut self) {
        let Some(registry) = self.registry.upgrade() else {
            return;
        };
        let mut streams = registry.streams.lock();
        if let Some(stream) = streams.get_mut(&self.request_id) {
            stream.open -= 1;
            if stream.open == 0 {
                streams.remove(&self.request_id);
            }
        }
    }
}

/// How long a BidiAppend that does not decode as an AgentService message waits for its
/// RunInferenceSSE stream. The client opens the stream and starts appending concurrently.
const STREAM_KIND_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportRoute {
    Local,
    Upstream(u64),
}

impl TransportRegistry {
    pub fn new(store: Store, provider: Arc<dyn Provider>, compiler: PromptCompiler) -> Self {
        Self::with_web_cache(store, provider, compiler, WebCache::default())
    }

    pub fn with_web_cache(
        store: Store,
        provider: Arc<dyn Provider>,
        compiler: PromptCompiler,
        web_cache: WebCache,
    ) -> Self {
        Self::build(store, provider, compiler, web_cache, None, None)
    }

    /// 附带本地 rules 目录的构造;编译请求上下文时会合并该目录下的 md 规则。
    pub fn with_local_rules(
        store: Store,
        provider: Arc<dyn Provider>,
        compiler: PromptCompiler,
        local_rules_dir: std::path::PathBuf,
    ) -> Self {
        Self::build(
            store,
            provider,
            compiler,
            WebCache::default(),
            None,
            Some(local_rules_dir),
        )
    }

    pub fn with_plugins(
        store: Store,
        provider: Arc<dyn Provider>,
        compiler: PromptCompiler,
        web_cache: WebCache,
        plugins: PluginRegistry,
        local_rules_dir: std::path::PathBuf,
    ) -> Self {
        Self::build(
            store,
            provider,
            compiler,
            web_cache,
            Some(plugins),
            Some(local_rules_dir),
        )
    }

    fn build(
        store: Store,
        provider: Arc<dyn Provider>,
        compiler: PromptCompiler,
        web_cache: WebCache,
        plugins: Option<PluginRegistry>,
        local_rules_dir: Option<std::path::PathBuf>,
    ) -> Self {
        Self {
            inner: Arc::new(RegistryInner {
                local: Mutex::new(HashMap::new()),
                next_local_generation: AtomicU64::new(1),
                upstream: Mutex::new(HashMap::new()),
                route_changed: Notify::new(),
                streams: parking_lot::Mutex::new(HashMap::new()),
                inference: InferenceRegistry::new(store.clone(), provider.clone()),
                traces: CursorTraceService::new(store.clone()),
                conversations: ConversationRegistry::new(
                    store.clone(),
                    provider,
                    compiler,
                    web_cache.clone(),
                    local_rules_dir,
                ),
                store,
                web_cache,
                plugins,
            }),
        }
    }

    pub fn store(&self) -> &Store {
        &self.inner.store
    }

    pub fn trace(
        &self,
        request_id: &str,
    ) -> crate::cursor::services::observability::CursorTraceRecorder {
        self.inner.traces.recorder(request_id)
    }

    pub fn web_cache(&self) -> &WebCache {
        &self.inner.web_cache
    }

    pub fn plugins(&self) -> Option<&PluginRegistry> {
        self.inner.plugins.as_ref()
    }

    pub fn conversations(&self) -> &ConversationRegistry {
        &self.inner.conversations
    }

    pub fn inference(&self) -> &InferenceRegistry {
        &self.inner.inference
    }

    /// Records which downstream stream Cursor opened for `request_id`.
    pub fn open_stream(&self, request_id: &str, kind: StreamKind) -> StreamRegistration {
        let mut streams = self.inner.streams.lock();
        let stream = streams
            .entry(request_id.into())
            .or_insert(OpenStream { kind, open: 0 });
        stream.kind = kind;
        stream.open += 1;
        drop(streams);
        self.inner.route_changed.notify_waiters();
        StreamRegistration {
            registry: Arc::downgrade(&self.inner),
            request_id: request_id.into(),
        }
    }

    /// Picks the protocol of a BidiAppend. A registered stream or an existing transport
    /// decides directly; otherwise an append that decodes as an AgentService message is one,
    /// and anything else waits briefly for its RunInferenceSSE stream.
    pub async fn stream_kind(&self, request_id: &str, decodes_as_agent: bool) -> StreamKind {
        if let Some(kind) = self.registered_kind(request_id).await {
            return kind;
        }
        if decodes_as_agent {
            return StreamKind::Agent;
        }
        let waited = tokio::time::timeout(STREAM_KIND_WAIT, async {
            loop {
                let changed = self.inner.route_changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                if let Some(kind) = self.registered_kind(request_id).await {
                    return kind;
                }
                changed.await;
            }
        })
        .await;
        waited.unwrap_or(StreamKind::Agent)
    }

    async fn registered_kind(&self, request_id: &str) -> Option<StreamKind> {
        if let Some(stream) = self.inner.streams.lock().get(request_id) {
            return Some(stream.kind);
        }
        if self.inner.local.lock().await.contains_key(request_id) {
            return Some(StreamKind::Agent);
        }
        if self.inner.inference.contains(request_id).await {
            return Some(StreamKind::Inference);
        }
        None
    }

    /// Creates the local RunInference session for `request_id` and wakes its waiting stream.
    pub async fn create_inference(
        &self,
        request_id: &str,
        byok: crate::cursor::inference::ByokModel,
    ) -> Arc<crate::cursor::inference::InferenceSession> {
        let session = self.inner.inference.create(request_id, byok).await;
        self.inner.route_changed.notify_waiters();
        session
    }

    pub async fn get_or_create(&self, request_id: &str) -> Result<TransportHandle> {
        self.get_or_create_for_append(request_id, false).await
    }

    pub(crate) async fn get_or_create_for_append(
        &self,
        request_id: &str,
        replace_closing: bool,
    ) -> Result<TransportHandle> {
        let mut local = self.inner.local.lock().await;
        if let Some(transport) = local.get(request_id) {
            if transport.handle.accepting_appends() || !replace_closing {
                return Ok(transport.handle.clone());
            }
        }
        local.remove(request_id);
        let (commands, receiver) = mpsc::channel(128);
        let output = Arc::new(OutputHub::default());
        let trace = self.inner.traces.recorder(request_id);
        trace.resume();
        let handle = TransportHandle::new(request_id.into(), commands, output, trace);
        let generation = self
            .inner
            .next_local_generation
            .fetch_add(1, Ordering::Relaxed);
        local.insert(
            request_id.into(),
            LocalTransport {
                generation,
                handle: handle.clone(),
            },
        );
        drop(local);
        self.inner.route_changed.notify_waiters();
        self.inner
            .conversations
            .bind_transport(handle.clone(), receiver);

        let registry = Arc::downgrade(&self.inner);
        let request_id = request_id.to_string();
        let lifecycle = handle.clone();
        tokio::spawn(async move {
            lifecycle.wait_transport_closed().await;
            if let Some(registry) = registry.upgrade() {
                let mut local = registry.local.lock().await;
                if local
                    .get(&request_id)
                    .is_some_and(|transport| transport.generation == generation)
                {
                    local.remove(&request_id);
                }
            }
        });
        Ok(handle)
    }

    pub async fn local(&self, request_id: &str) -> Option<TransportHandle> {
        self.inner
            .local
            .lock()
            .await
            .get(request_id)
            .map(|transport| transport.handle.clone())
    }

    pub async fn mark_upstream(&self, request_id: &str) {
        let mut upstream = self.inner.upstream.lock().await;
        let generation = upstream.get(request_id).copied().unwrap_or_default() + 1;
        upstream.insert(request_id.into(), generation);
        drop(upstream);
        self.inner.route_changed.notify_waiters();
    }

    pub async fn upstream(&self, request_id: &str) -> bool {
        self.inner.upstream.lock().await.contains_key(request_id)
    }

    pub async fn wait_route(&self, request_id: &str) -> TransportRoute {
        loop {
            let changed = self.inner.route_changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.inner.local.lock().await.contains_key(request_id)
                || self.inner.inference.contains(request_id).await
            {
                return TransportRoute::Local;
            }
            if let Some(generation) = self.inner.upstream.lock().await.get(request_id).copied() {
                return TransportRoute::Upstream(generation);
            }
            changed.await;
        }
    }

    pub fn finish_upstream(&self, request_id: String, generation: u64) {
        let registry = self.clone();
        tokio::spawn(async move {
            let mut upstream = registry.inner.upstream.lock().await;
            if upstream.get(&request_id) == Some(&generation) {
                upstream.remove(&request_id);
            }
        });
    }

    pub async fn shutdown(&self) {
        self.inner.conversations.shutdown().await;
        self.inner.inference.shutdown().await;
        let handles = std::mem::take(&mut *self.inner.local.lock().await);
        self.inner.upstream.lock().await.clear();
        for transport in handles.into_values() {
            transport.handle.disconnect().await;
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                transport.handle.wait_transport_closed(),
            )
            .await;
        }
    }
}
