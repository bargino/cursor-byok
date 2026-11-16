//! Owns bounded TeleAgent login jobs and their isolated browser subprocesses.
use crate::{Error, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use parking_lot::Mutex;
use std::{collections::HashMap, path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{oneshot, OwnedSemaphorePermit, Semaphore},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub(super) struct NativeLogins(Arc<Inner>);
struct Inner {
    executable: PathBuf,
    jobs: Mutex<HashMap<String, Job>>,
    slots: Arc<Semaphore>,
}
type LoginResult = Arc<Mutex<Option<std::result::Result<serde_json::Value, String>>>>;
struct Job {
    expires: i64,
    cancellation: CancellationToken,
    result: LoginResult,
    directory: PathBuf,
    _permit: OwnedSemaphorePermit,
}
impl Drop for Inner {
    fn drop(&mut self) {
        for job in self.jobs.get_mut().values() {
            let _ = std::fs::write(job.directory.join("cancel"), b"");
            job.cancellation.cancel();
        }
    }
}
impl NativeLogins {
    pub fn new(executable: PathBuf) -> Self {
        Self(Arc::new(Inner {
            executable,
            jobs: Mutex::new(HashMap::new()),
            slots: Arc::new(Semaphore::new(4)),
        }))
    }
    pub async fn begin(&self) -> Result<serde_json::Value> {
        let id = uuid::Uuid::new_v4().to_string();
        let expires = super::state::now_ms() + 600_000;
        {
            let mut jobs = self.0.jobs.lock();
            jobs.retain(|_, j| {
                if j.expires <= super::state::now_ms() {
                    j.cancellation.cancel();
                    false
                } else {
                    true
                }
            });
        }
        let permit = self
            .0
            .slots
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Config("too many active native login windows".into()))?;
        let root = crate::config::managed_data_dir()?.join("plugins/runtime/native/teleagent");
        std::fs::create_dir_all(&root)?;
        let helper = root.join("teleagent.mjs");
        super::definition::write_if_changed(&helper, include_str!("native/teleagent.mjs"))?;
        for (name, content) in [
            ("LICENSE", include_str!("native/LICENSE")),
            (
                "LICENSE.teleagent",
                include_str!("native/LICENSE.teleagent"),
            ),
            ("NOTICE", include_str!("native/NOTICE")),
        ] {
            super::definition::write_if_changed(&root.join(name), content)?;
        }
        let directory = root.join(&id);
        std::fs::create_dir_all(&directory)?;
        let entropy = [
            uuid::Uuid::new_v4().as_bytes().as_slice(),
            uuid::Uuid::new_v4().as_bytes().as_slice(),
        ]
        .concat();
        let task = serde_json::json!({"version":1,"provider":"teleagent","challenge":URL_SAFE_NO_PAD.encode(entropy),"expires_at":expires/1000,"url":"https://www.teleai.com.cn/teleai-api/upms/public/auth/authorize?client_id=Z2veLLEHhZfq3hb5hWIwqJuPajIuasYi&redirect_uri=https%3A%2F%2Fagent.teleai.com.cn%2FsuperCowork%2Fsapi%2Fcowork%2Fauth"});
        let mut command = tokio::process::Command::new(&self.0.executable);
        super::detach_console(&mut command);
        command
            .args([
                "run",
                "--no-config",
                "--no-npm",
                "--allow-read",
                "--allow-write",
                "--allow-env",
                "--allow-run",
                "--allow-net=127.0.0.1",
            ])
            .arg(&helper)
            .env("CURSOR_BYOK_LOGIN_DIR", &directory)
            .env("CURSOR_BYOK_PARENT_PID", std::process::id().to_string())
            .env("TMPDIR", &directory)
            .env("TMP", &directory)
            .env("TEMP", &directory)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(false);
        let mut child = command.spawn()?;
        let mut input = child.stdin.take().expect("piped native login stdin");
        input
            .write_all(serde_json::to_string(&task)?.as_bytes())
            .await?;
        drop(input);
        let output = child.stdout.take().expect("piped native login stdout");
        let cancellation = CancellationToken::new();
        let cancel = cancellation.clone();
        let result = Arc::new(Mutex::new(None));
        let result_slot = result.clone();
        let (ready_tx, ready_rx) = oneshot::channel();
        let cleanup = directory.clone();
        self.0.jobs.lock().insert(
            id.clone(),
            Job {
                expires,
                cancellation,
                result,
                directory,
                _permit: permit,
            },
        );
        tokio::spawn(async move {
            let mut lines = BufReader::new(output).lines();
            let mut ready = Some(ready_tx);
            let finish = async {
                loop {
                    let line = lines
                        .next_line()
                        .await
                        .map_err(|_| "native login output failed".to_owned())?
                        .ok_or_else(|| "native login window closed".to_owned())?;
                    if line.len() > 256 * 1024 {
                        return Err("native login result too large".to_owned());
                    }
                    if line == "CURSOR_BYOK_READY" {
                        if let Some(tx) = ready.take() {
                            let _ = tx.send(Ok(()));
                        }
                    } else if let Some(raw) = line.strip_prefix("CURSOR_BYOK_RESULT:") {
                        return serde_json::from_str(raw)
                            .map_err(|_| "invalid native login result".to_owned());
                    } else if let Some(message) = line.strip_prefix("CURSOR_BYOK_ERROR:") {
                        return Err(message.to_owned());
                    }
                }
            };
            let outcome = tokio::select! {result=finish=>result,_=cancel.cancelled()=>{let _=std::fs::write(cleanup.join("cancel"),b"");Err("native login cancelled".into())},_=tokio::time::sleep(Duration::from_secs(610))=>Err("native login expired".into())};
            if let Some(tx) = ready {
                let _ = tx.send(Err(outcome
                    .as_ref()
                    .err()
                    .cloned()
                    .unwrap_or_else(|| "login did not initialize".into())));
            }
            *result_slot.lock() = Some(outcome);
            // Give the helper time to close its own isolated browser and remove its private profile.
            if tokio::time::timeout(Duration::from_secs(6), child.wait())
                .await
                .is_err()
            {
                let _ = child.kill().await;
            }
            let _ = std::fs::remove_file(cleanup.join("cancel"));
            let _ = std::fs::remove_dir(&cleanup); // Nonrecursive; a surviving browser profile is never deleted under a live browser.
        });
        match tokio::time::timeout(Duration::from_secs(30), ready_rx).await {
            Ok(Ok(Ok(()))) => Ok(serde_json::json!({"id":id,"expiresAtMs":expires})),
            Ok(Ok(Err(message))) => {
                self.cancel(&id);
                Err(Error::Config(message))
            }
            _ => {
                self.cancel(&id);
                Err(Error::Config(
                    "TeleAgent login did not initialize within 30 seconds".into(),
                ))
            }
        }
    }
    pub fn poll(&self, id: &str) -> Result<serde_json::Value> {
        let jobs = self.0.jobs.lock();
        let job = jobs
            .get(id)
            .ok_or_else(|| Error::Config("native login session no longer exists".into()))?;
        if job.expires <= super::state::now_ms() {
            return Err(Error::Config("native login expired".into()));
        }
        let result = job.result.lock().clone();
        match result {
            None => Ok(serde_json::json!({"status":"pending"})),
            Some(Ok(credentials)) => {
                Ok(serde_json::json!({"status":"completed","credentials":credentials}))
            }
            Some(Err(message)) => Ok(serde_json::json!({"status":"failed","message":message})),
        }
    }
    pub fn cancel(&self, id: &str) {
        if let Some(job) = self.0.jobs.lock().remove(id) {
            let _ = std::fs::write(job.directory.join("cancel"), b"");
            job.cancellation.cancel();
            let _ = job.directory;
        }
    }
    pub fn cancel_all(&self) {
        for (_, job) in self.0.jobs.lock().drain() {
            let _ = std::fs::write(job.directory.join("cancel"), b"");
            job.cancellation.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_login_cancellation_is_owned_by_the_exact_session() {
        let manager = NativeLogins::new(PathBuf::new());
        let root = tempfile::tempdir().unwrap();
        let first = CancellationToken::new();
        let second = CancellationToken::new();
        for (id, cancellation) in [("one", first.clone()), ("two", second.clone())] {
            manager.0.jobs.lock().insert(
                id.into(),
                Job {
                    expires: super::super::state::now_ms() + 600000,
                    cancellation,
                    result: Arc::new(Mutex::new(None)),
                    directory: {
                        let directory = root.path().join(id);
                        std::fs::create_dir(&directory).unwrap();
                        directory
                    },
                    _permit: manager.0.slots.clone().try_acquire_owned().unwrap(),
                },
            );
        }
        manager.cancel("one");
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
        assert!(manager.poll("one").is_err());
        assert_eq!(manager.poll("two").unwrap()["status"], "pending");
        manager.cancel_all();
        assert!(second.is_cancelled());
        assert!(manager.poll("two").is_err());
    }
}
