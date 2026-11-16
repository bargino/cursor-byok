//! Pre-installs bundled built-in plugins into the user's installed directory.
use std::path::Path;

use crate::Result;

type PluginFiles = &'static [(&'static str, &'static [u8])];

/// 随二进制打包的内置插件文件;发布构建没有源码目录,靠这里预装。
const CODEX_AUTH: PluginFiles = &[
    (
        "plugin.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/codex-auth/plugin.json"
        )),
    ),
    (
        "main.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/codex-auth/main.ts"
        )),
    ),
    (
        "provider.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/codex-auth/provider.ts"
        )),
    ),
    (
        "models.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/codex-auth/models.ts"
        )),
    ),
    (
        "oauth.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/codex-auth/oauth.ts"
        )),
    ),
    (
        "resources.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/codex-auth/resources.ts"
        )),
    ),
    (
        "assets/codex.svg",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/codex-auth/assets/codex.svg"
        )),
    ),
];

const GROK_AUTH: PluginFiles = &[
    (
        "plugin.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/grok-auth/plugin.json"
        )),
    ),
    (
        "main.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/grok-auth/main.ts"
        )),
    ),
    (
        "provider.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/grok-auth/provider.ts"
        )),
    ),
    (
        "models.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/grok-auth/models.ts"
        )),
    ),
    (
        "oauth.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/grok-auth/oauth.ts"
        )),
    ),
    (
        "resources.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/grok-auth/resources.ts"
        )),
    ),
    (
        "assets/grok.svg",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/grok-auth/assets/grok.svg"
        )),
    ),
];

const ANTIGRAVITY_AUTH: PluginFiles = &[
    (
        "plugin.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/antigravity-auth/plugin.json"
        )),
    ),
    (
        "main.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/antigravity-auth/main.ts"
        )),
    ),
    (
        "provider.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/antigravity-auth/provider.ts"
        )),
    ),
    (
        "models.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/antigravity-auth/models.ts"
        )),
    ),
    (
        "oauth.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/antigravity-auth/oauth.ts"
        )),
    ),
    (
        "google_oauth.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/antigravity-auth/google_oauth.ts"
        )),
    ),
    (
        "resources.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/antigravity-auth/resources.ts"
        )),
    ),
    (
        "assets/antigravity.svg",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/antigravity-auth/assets/antigravity.svg"
        )),
    ),
];

const WORKBUDDY_AUTH: PluginFiles = &[
    (
        "plugin.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/workbuddy-auth/plugin.json"
        )),
    ),
    (
        "main.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/workbuddy-auth/main.ts"
        )),
    ),
    (
        "api.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/workbuddy-auth/api.ts"
        )),
    ),
    (
        "oauth.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/workbuddy-auth/oauth.ts"
        )),
    ),
    (
        "resources.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/workbuddy-auth/resources.ts"
        )),
    ),
    (
        "models.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/workbuddy-auth/models.ts"
        )),
    ),
    (
        "provider.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/workbuddy-auth/provider.ts"
        )),
    ),
    (
        "assets/workbuddy.svg",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/workbuddy-auth/assets/workbuddy.svg"
        )),
    ),
    (
        "LICENSE",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/workbuddy-auth/LICENSE"
        )),
    ),
];

const QODER_AUTH: PluginFiles = &[
    (
        "LICENSE",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/LICENSE"
        )),
    ),
    (
        "LICENSE.qoder",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/LICENSE.qoder"
        )),
    ),
    (
        "NOTICE",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/NOTICE"
        )),
    ),
    (
        "api.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/api.ts"
        )),
    ),
    (
        "assets/qoder.svg",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/assets/qoder.svg"
        )),
    ),
    (
        "assets/source.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/assets/source.json"
        )),
    ),
    (
        "main.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/main.ts"
        )),
    ),
    (
        "oauth.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/oauth.ts"
        )),
    ),
    (
        "plugin.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/plugin.json"
        )),
    ),
    (
        "provider.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/provider.ts"
        )),
    ),
    (
        "sign.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/qoder-auth/sign.ts"
        )),
    ),
];

const KIRO_AUTH: PluginFiles = &[
    (
        "LICENSE",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/LICENSE"
        )),
    ),
    (
        "LICENSE.kiro",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/LICENSE.kiro"
        )),
    ),
    (
        "NOTICE",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/NOTICE"
        )),
    ),
    (
        "api.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/api.ts"
        )),
    ),
    (
        "assets/kiro.svg",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/assets/kiro.svg"
        )),
    ),
    (
        "assets/source.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/assets/source.json"
        )),
    ),
    (
        "eventstream.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/eventstream.ts"
        )),
    ),
    (
        "main.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/main.ts"
        )),
    ),
    (
        "oauth.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/oauth.ts"
        )),
    ),
    (
        "plugin.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/plugin.json"
        )),
    ),
    (
        "provider.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/kiro-auth/provider.ts"
        )),
    ),
];

const TELEAGENT_AUTH: PluginFiles = &[
    (
        "LICENSE",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/LICENSE"
        )),
    ),
    (
        "LICENSE.teleagent",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/LICENSE.teleagent"
        )),
    ),
    (
        "NOTICE",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/NOTICE"
        )),
    ),
    (
        "api.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/api.ts"
        )),
    ),
    (
        "assets/source.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/assets/source.json"
        )),
    ),
    (
        "assets/teleagent.ico",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/assets/teleagent.ico"
        )),
    ),
    (
        "main.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/main.ts"
        )),
    ),
    (
        "oauth.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/oauth.ts"
        )),
    ),
    (
        "plugin.json",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/plugin.json"
        )),
    ),
    (
        "provider.ts",
        include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/plugins/build-in/teleagent-auth/provider.ts"
        )),
    ),
];

const PLUGINS: &[(&str, PluginFiles)] = &[
    ("codex-auth", CODEX_AUTH),
    ("grok-auth", GROK_AUTH),
    ("antigravity-auth", ANTIGRAVITY_AUTH),
    ("workbuddy-auth", WORKBUDDY_AUTH),
    ("qoder-auth", QODER_AUTH),
    ("kiro-auth", KIRO_AUTH),
    ("teleagent-auth", TELEAGENT_AUTH),
];

/// 把内置插件预装到 installed 目录。manifest 的 version 是缓存键:
/// 版本一致时零写盘;版本变化时整目录同步并清理旧版本残留文件。
pub(super) fn install(installed: &Path) -> Result<()> {
    for (name, files) in PLUGINS {
        let directory = installed.join(name);
        if disk_version(&directory) == Some(embedded_version(files)?) {
            continue;
        }
        write_plugin(&directory, files)?;
    }
    Ok(())
}

fn embedded_version(files: &[(&str, &[u8])]) -> Result<String> {
    let manifest = files
        .iter()
        .find(|(name, _)| *name == "plugin.json")
        .map(|(_, content)| *content)
        .expect("built-in plugin bundles plugin.json");
    let value: serde_json::Value = serde_json::from_slice(manifest)?;
    value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| crate::Error::Config("built-in plugin manifest requires version".into()))
}

fn disk_version(directory: &Path) -> Option<String> {
    let manifest = std::fs::read_to_string(directory.join("plugin.json")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&manifest).ok()?;
    Some(value.get("version")?.as_str()?.to_owned())
}

fn write_plugin(directory: &Path, files: &[(&str, &[u8])]) -> Result<()> {
    for (relative, content) in files {
        let path = directory.join(relative);
        let parent = path.parent().expect("plugin file path has a parent");
        std::fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700))?;
        }
        if std::fs::read(&path).ok().as_deref() != Some(*content) {
            std::fs::write(&path, content)?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }
    }
    prune_unknown_files(directory, directory, files)?;
    Ok(())
}

/// 删除插件目录中不在嵌入清单里的文件与空目录(旧版本残留)。
fn prune_unknown_files(root: &Path, directory: &Path, files: &[(&str, &[u8])]) -> Result<()> {
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            prune_unknown_files(root, &path, files)?;
            if std::fs::read_dir(&path)?.next().is_none() {
                std::fs::remove_dir(&path)?;
            }
            continue;
        }
        let known = files
            .iter()
            .any(|(relative, _)| root.join(relative) == path);
        if !known {
            std::fs::remove_file(&path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn embedded_main() -> &'static str {
        let content = CODEX_AUTH
            .iter()
            .find(|(name, _)| *name == "main.ts")
            .unwrap()
            .1;
        std::str::from_utf8(content).unwrap()
    }

    #[test]
    fn install_is_version_gated_and_syncs_on_version_change() {
        let root = tempfile::tempdir().unwrap();
        let plugin = root.path().join("codex-auth");

        install(root.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(plugin.join("main.ts")).unwrap(),
            embedded_main()
        );
        assert!(root
            .path()
            .join("antigravity-auth/assets/antigravity.svg")
            .is_file());

        assert!(root.path().join("workbuddy-auth/api.ts").is_file());
        assert!(root.path().join("workbuddy-auth/LICENSE").is_file());

        // 版本一致:本地改动与额外文件保持原样,不发生任何写盘。
        std::fs::write(plugin.join("main.ts"), "edited").unwrap();
        std::fs::write(plugin.join("stale.ts"), "extra").unwrap();
        install(root.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(plugin.join("main.ts")).unwrap(),
            "edited"
        );
        assert!(plugin.join("stale.ts").exists());

        // 版本变化:整目录同步回嵌入内容并清理残留。
        let manifest = std::fs::read_to_string(plugin.join("plugin.json")).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        value["version"] = serde_json::Value::String("0.0.1".into());
        std::fs::write(plugin.join("plugin.json"), value.to_string()).unwrap();
        install(root.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(plugin.join("main.ts")).unwrap(),
            embedded_main()
        );
        assert!(!plugin.join("stale.ts").exists());
    }
}
