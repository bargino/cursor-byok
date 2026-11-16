//! Pins the Statsig bootstrap Cursor caches on disk to BYOK's local gates.
//!
//! Cursor's agent host reads `agent_host_local_loop` once, when a window starts,
//! from the bootstrap the renderer cached on disk during the previous session.
//! A cache written while Cursor talked to its official backend would route the
//! first window after takeover to a protocol BYOK does not serve.
use std::path::Path;

use serde_json::Value;
use sqlx::{Connection, Row, SqliteConnection};

use crate::{cursor::services::analytics, Result};

const BOOTSTRAP_KEY: &str = "workbench.experiments.statsigBootstrap";

pub async fn pin_cached_bootstrap() -> Result<()> {
    pin_cached_bootstrap_at(&super::account::state_db_path()?).await
}

async fn pin_cached_bootstrap_at(path: &Path) -> Result<()> {
    if !tokio::fs::try_exists(path).await? {
        return Ok(());
    }
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(path);
    let mut connection = SqliteConnection::connect_with(&options).await?;
    let has_table =
        sqlx::query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ItemTable'")
            .fetch_optional(&mut connection)
            .await?
            .is_some();
    if !has_table {
        return Ok(());
    }
    let Some(row) = sqlx::query("SELECT CAST(value AS TEXT) AS value FROM ItemTable WHERE key = ?")
        .bind(BOOTSTRAP_KEY)
        .fetch_optional(&mut connection)
        .await?
    else {
        return Ok(());
    };
    let cached: String = row.try_get("value")?;
    let mut config: Value = serde_json::from_str(&cached)?;
    let before = config.clone();
    analytics::pin_local_gates(&mut config)?;
    if config == before {
        return Ok(());
    }
    sqlx::query("INSERT OR REPLACE INTO ItemTable(key, value) VALUES(?, ?)")
        .bind(BOOTSTRAP_KEY)
        .bind(serde_json::to_string(&config)?)
        .execute(&mut connection)
        .await?;
    tracing::info!("pinned BYOK gates in Cursor's cached Statsig bootstrap");
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    async fn database(path: &Path, bootstrap: Option<&Value>) -> SqliteConnection {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let mut connection = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)")
            .execute(&mut connection)
            .await
            .unwrap();
        if let Some(bootstrap) = bootstrap {
            sqlx::query("INSERT INTO ItemTable(key, value) VALUES(?, ?)")
                .bind(BOOTSTRAP_KEY)
                .bind(bootstrap.to_string())
                .execute(&mut connection)
                .await
                .unwrap();
        }
        connection
    }

    async fn cached(connection: &mut SqliteConnection) -> Option<Value> {
        sqlx::query("SELECT CAST(value AS TEXT) AS value FROM ItemTable WHERE key = ?")
            .bind(BOOTSTRAP_KEY)
            .fetch_optional(connection)
            .await
            .unwrap()
            .map(|row| serde_json::from_str(&row.get::<String, _>("value")).unwrap())
    }

    #[tokio::test]
    async fn official_backend_cache_is_pinned_before_cursor_starts() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.vscdb");
        let official = json!({
            "hash_used": "none",
            "feature_gates": {
                "agent_host_local_loop": { "name": "agent_host_local_loop", "value": true },
                "unrelated_gate": { "name": "unrelated_gate", "value": true }
            },
            "dynamic_configs": { "kept": { "value": { "a": 1 } } }
        });
        let mut connection = database(&path, Some(&official)).await;

        pin_cached_bootstrap_at(&path).await.unwrap();

        let pinned = cached(&mut connection).await.unwrap();
        let gates = &pinned["feature_gates"];
        assert_eq!(gates["agent_host_local_loop"]["value"], json!(false));
        assert_eq!(gates["unrelated_gate"]["value"], json!(true));
        assert_eq!(pinned["dynamic_configs"], official["dynamic_configs"]);
    }

    #[tokio::test]
    async fn missing_cursor_state_is_left_untouched() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.vscdb");

        pin_cached_bootstrap_at(&path).await.unwrap();
        assert!(!path.exists());

        let mut connection = database(&path, None).await;
        pin_cached_bootstrap_at(&path).await.unwrap();
        assert!(cached(&mut connection).await.is_none());
    }
}
