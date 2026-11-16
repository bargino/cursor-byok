//! Rotates ready accounts and serializes operations on each account's credentials.
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Weak},
};

use parking_lot::Mutex;
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard};

use super::state::ResourceRecord;

#[derive(Default)]
pub(super) struct ResourcePool {
    last: Mutex<HashMap<(String, String), String>>,
    leases: Mutex<HashMap<String, Weak<AsyncMutex<()>>>>,
}

impl ResourcePool {
    pub fn select(
        &self,
        plugin_id: &str,
        resource_type: &str,
        records: &[ResourceRecord],
        attempted: &HashSet<String>,
        now: i64,
    ) -> Option<ResourceRecord> {
        let mut last = self.last.lock();
        let key = (plugin_id.to_owned(), resource_type.to_owned());
        let start = last
            .get(&key)
            .and_then(|id| records.iter().position(|r| &r.id == id))
            .map_or(0, |index| index + 1);
        let record = (0..records.len())
            .map(|offset| &records[(start + offset) % records.len()])
            .find(|r| r.state.is_ready(now) && !attempted.contains(&r.id))?;
        last.insert(key, record.id.clone());
        Some(record.clone())
    }

    pub async fn lease(&self, resource_id: &str) -> OwnedMutexGuard<()> {
        let lock = {
            let mut leases = self.leases.lock();
            // Do not retain locks for deleted accounts indefinitely.
            leases.retain(|_, lock| lock.strong_count() > 0);
            leases
                .get(resource_id)
                .and_then(Weak::upgrade)
                .unwrap_or_else(|| {
                    let lock = Arc::new(AsyncMutex::new(()));
                    leases.insert(resource_id.to_owned(), Arc::downgrade(&lock));
                    lock
                })
        };
        lock.lock_owned().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin::state::ResourceState;

    fn account(id: &str, state: ResourceState) -> ResourceRecord {
        ResourceRecord {
            id: id.into(),
            key: id.into(),
            state,
            private_data: serde_json::Value::Null,
            created_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn rotates_ready_accounts_skips_failures_and_recovers_expired_cooldowns() {
        let pool = ResourcePool::default();
        let records = vec![
            account("a", ResourceState::Ready),
            account("b", ResourceState::Ready),
            account(
                "c",
                ResourceState::Cooling {
                    retry_at_ms: Some(200),
                    message: None,
                },
            ),
            account("d", ResourceState::Invalid { message: None }),
        ];
        let empty = HashSet::new();
        for expected in ["a", "b", "a", "b"] {
            assert_eq!(
                pool.select("plugin", "account", &records, &empty, 100)
                    .unwrap()
                    .id,
                expected
            );
        }
        assert_eq!(
            pool.select("plugin", "account", &records, &empty, 300)
                .unwrap()
                .id,
            "c"
        );
        let attempted = HashSet::from(["a".into(), "b".into(), "c".into()]);
        assert!(pool
            .select("plugin", "account", &records, &attempted, 300)
            .is_none());
        assert!(pool
            .select("plugin", "account", &records[3..], &empty, 300)
            .is_none());
        assert!(pool.select("plugin", "empty", &[], &empty, 300).is_none());
    }

    #[tokio::test]
    async fn account_operations_share_a_lease_but_other_accounts_do_not_wait() {
        let pool = Arc::new(ResourcePool::default());
        let first = pool.lease("a").await;
        let second_pool = pool.clone();
        let mut waiting = tokio::spawn(async move { second_pool.lease("a").await });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut waiting)
                .await
                .is_err()
        );
        let _other = pool.lease("b").await;
        drop(first);
        tokio::time::timeout(std::time::Duration::from_secs(1), waiting)
            .await
            .unwrap()
            .unwrap();
    }
}
