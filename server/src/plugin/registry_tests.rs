//! Real Deno worker tests using an isolated plugin, account store, and SQLite database.
use super::*;
use crate::model::{ModelRequest, ModelSpec, NewLlmCall, PromptSpec, ProviderType};
use futures_util::StreamExt;

#[tokio::test]
#[ignore = "requires the installed Deno plugin runtime"]
async fn all_bundled_account_plugins_load_with_their_native_official_icons() {
    let root = tempfile::tempdir().unwrap();
    super::super::builtin::install(&root.path().join("installed")).unwrap();
    let runtime = PluginRuntime::managed().unwrap();
    let executable = runtime
        .executable()
        .expect("initialize the pinned Deno plugin runtime first");
    let entries = PluginCatalog::for_test(root.path())
        .unwrap()
        .entries(&executable)
        .await;
    assert_eq!(
        entries.len(),
        7,
        "all bundled plugins must load their shipped files"
    );
    for (id, count) in [
        ("dev.cursorbyok.qoder-auth", 2),
        ("dev.cursorbyok.kiro-auth", 2),
        ("dev.cursorbyok.teleagent-auth", 1),
    ] {
        let plugin = entries
            .iter()
            .find(|entry| entry.manifest.id == id)
            .unwrap();
        assert_eq!(plugin.definition.providers.len(), count);
        assert_eq!(plugin.definition.resources.len(), count);
        assert!(plugin.icon.starts_with("data:image/"));
    }
    let workbuddy = entries
        .iter()
        .find(|entry| entry.manifest.id == "dev.cursorbyok.workbuddy-auth")
        .unwrap();
    assert_eq!(workbuddy.definition.providers.len(), 2);
    assert_eq!(workbuddy.definition.resources.len(), 2);
    for resource in &workbuddy.definition.resources {
        assert!(resource.can_refresh);
        assert_eq!(resource.add.len(), 1);
        assert!(resource
            .actions
            .iter()
            .any(|action| action.id == "credit-packages"));
    }
}

async fn fixture(behaviors: &[(&str, &str)]) -> (tempfile::TempDir, PluginRegistry) {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("installed/fixture");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(
        directory.join("plugin.json"),
        r#"{
      "apiVersion":1,"id":"test.pool","name":"Pool fixture","version":"1.0.0",
      "entry":"main.ts","icon":"icon.svg","permissions":{"network":[]}
    }"#,
    )
    .unwrap();
    std::fs::write(
        directory.join("icon.svg"),
        "<svg xmlns=\"http://www.w3.org/2000/svg\"/>",
    )
    .unwrap();
    std::fs::write(directory.join("main.ts"), r#"
      import { defineProviderPlugin } from "cursor-byok:plugin";
      export default defineProviderPlugin({
        resources: [{type: "account", displayName: "Accounts", present: r => ({displayName:r.key})}],
        providers: [{id:"test", displayName:"Test", providerType:"test", resourceType:"account",
          invoke: async ({resource}, output) => {
            const behavior = resource.privateData.behavior;
            if (behavior === "request") return {status:"request-error",message:"bad request"};
            if (behavior !== "resource") {
              output.emit({type:"text-start"});
              output.emit({type:"text-delta",text:resource.key});
            }
            if (behavior === "resource" || behavior === "partial") return {
              status:"resource-error",message:"account expired",patch:{state:{status:"invalid"}}
            };
            output.emit({type:"text-end"});
            output.emit({type:"done",reason:"stop"});
            return {status:"completed"};
          }
        }]
      });
    "#).unwrap();
    let store = Store::connect(&format!(
        "sqlite://{}",
        root.path().join("test.db").display()
    ))
    .await
    .unwrap();
    let state = PluginStateStore::new(PluginDataStore::for_test(root.path().join("data")).unwrap());
    state
        .upsert_resources(
            "test.pool",
            "account",
            behaviors
                .iter()
                .map(|(key, behavior)| ResourceDraft {
                    key: key.to_string(),
                    private_data: serde_json::json!({"behavior":behavior}),
                    state: None,
                })
                .collect(),
        )
        .await
        .unwrap();
    let model =
        StoredModel::from_definition(&serde_json::json!({"id":"model", "displayName":"Model"}))
            .unwrap();
    state
        .replace_models("test.pool", "test", &[model])
        .await
        .unwrap();
    let runtime = PluginRuntime::managed().unwrap();
    assert!(
        runtime.executable().is_some(),
        "initialize the pinned Deno plugin runtime before running these ignored integration tests"
    );
    let registry = PluginRegistry {
        inner: Arc::new(RegistryInner {
            store,
            runtime,
            state,
            pool: ResourcePool::default(),
            catalog: PluginCatalog::for_test(root.path()).unwrap(),
            entries: RwLock::new(None),
            workers: Mutex::new(HashMap::new()),
            oauth_sessions: Mutex::new(HashMap::new()),
        }),
    };
    (root, registry)
}

async fn call(registry: &PluginRegistry) -> Vec<Result<ModelEvent>> {
    let id = uuid::Uuid::new_v4().to_string();
    let recorder = CallRecorder::start(
        registry.inner.store.clone(),
        NewLlmCall {
            call_id: id.clone(),
            run_id: "run".into(),
            conversation_id: "conversation".into(),
            provider_call_index: 0,
            model_hash: "plugin:test.pool/test/model".into(),
            provider_type: ProviderType::Plugin,
            provider_url: "plugin://test.pool/test".into(),
            request_type: ProviderType::Plugin,
            request_url: "plugin://test.pool/test".into(),
            model_id: "model".into(),
            display_name: "Model".into(),
            reasoning_effort: None,
            fast: false,
            message_count: 0,
            tool_count: 0,
            detailed: false,
        },
    )
    .await
    .unwrap();
    registry
        .stream_model(
            ModelInvocation {
                call_id: id,
                run_id: "run".into(),
                conversation_id: "conversation".into(),
                provider_call_index: 0,
                request: ModelRequest {
                    model: ModelSpec::new("plugin:test.pool/test/model"),
                    prompt: PromptSpec {
                        instructions: "test".into(),
                        tools: vec![],
                    },
                    history: vec![],
                },
            },
            CancellationToken::new(),
            recorder,
        )
        .collect()
        .await
}

fn output(events: &[Result<ModelEvent>]) -> String {
    events
        .iter()
        .filter_map(|e| match e {
            Ok(ModelEvent::TextDelta(text)) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

#[tokio::test]
#[ignore = "requires the installed Deno plugin runtime"]
async fn real_worker_fails_over_and_rotates_remaining_ready_accounts() {
    let (_root, registry) = fixture(&[("a", "resource"), ("b", "success"), ("c", "success")]).await;
    for expected in ["b", "c", "b", "c"] {
        let events = call(&registry).await;
        assert!(events.iter().all(Result::is_ok), "{events:?}");
        assert_eq!(output(&events), expected);
    }
    let records = registry
        .inner
        .state
        .resources("test.pool", "account")
        .await
        .unwrap();
    assert_eq!(records.len(), 3);
    assert!(!records[0].state.is_ready(now_ms()));
    registry.remove("test.pool").await.unwrap();
}

#[tokio::test]
#[ignore = "requires the installed Deno plugin runtime"]
async fn real_worker_never_retries_partial_output_or_request_errors() {
    for (behavior, expected) in [("partial", "a"), ("request", "")] {
        let (_root, registry) = fixture(&[("a", behavior), ("b", "success")]).await;
        let events = call(&registry).await;
        assert!(events.iter().any(Result::is_err));
        assert_eq!(
            output(&events),
            expected,
            "must not splice another account into a failed response"
        );
        registry.remove("test.pool").await.unwrap();
    }
}

#[tokio::test]
#[ignore = "requires the installed Deno plugin runtime"]
async fn real_worker_stops_after_each_account_has_failed_once() {
    let (_root, registry) = fixture(&[("a", "resource"), ("b", "resource")]).await;
    let events = tokio::time::timeout(Duration::from_secs(5), call(&registry))
        .await
        .unwrap();
    assert!(events.iter().any(Result::is_err));
    assert_eq!(output(&events), "");
    let records = registry
        .inner
        .state
        .resources("test.pool", "account")
        .await
        .unwrap();
    assert!(records.iter().all(|r| !r.state.is_ready(now_ms())));
    let events = call(&registry).await;
    assert!(events.iter().any(Result::is_err));
    registry.remove("test.pool").await.unwrap();
}
