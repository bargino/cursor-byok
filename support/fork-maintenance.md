# Fork maintenance / 社区维护说明

This is the source fork at [bargino/cursor-byok](https://github.com/bargino/cursor-byok), based on upstream commit `31e9f5cbc98a7d28cffcb5efbb9323cd3e143354`. The original project is [leookun/cursor-byok](https://github.com/leookun/cursor-byok). Its MIT license and existing contributor history are retained.

首次源码发布日期为 2026-11-16，首个打包版本为 [v1.0.2](https://github.com/bargino/cursor-byok/releases/tag/v1.0.2)。原上游已经归档；本 fork 的源码、下载、问题反馈与后续贡献请使用本仓库入口。

## Source changes

- Accept binary or hex BidiAppend payloads and reject ambiguous payloads.
- Add RunInferenceSSE/BidiAppend routing, model invocation streaming, tool round trips, reasoning-state replay, cancellation, and heartbeats.
- Keep BYOK turn-classification reports local and pin the relevant Statsig bootstrap gates.
- Generate deterministic identities for user messages that omit their IDs, including subagent retries and checkpoint continuation.
- Recognize additional gateway context-overflow responses so the existing compaction path can retry them.
- Add protocol fixtures, regression tests, and a runtime protocol extraction helper.

子代理修复的历史证据与实机验证边界见 [subagent-protocol.md](cursor-capture/subagent-protocol.md)。其中较早的测试记录不代表本次所有新增能力均已通过相同实机验收。

## Build from source

Prerequisites: a current stable Rust toolchain, Node.js 22 or later, npm, and the platform prerequisites for Tauri 2. Linux system libraries are listed in [CI](../.github/workflows/ci.yml). Windows needs the MSVC C++ build tools and WebView2 runtime; macOS needs Xcode command-line tools.

```sh
git clone https://github.com/bargino/cursor-byok.git
cd cursor-byok/apps/desktop
npm ci
npm run check
npm run tauri:build -- --debug --no-bundle
```

To run only the local server, from the repository root:

```sh
cargo run -p cursor-server --locked
```

## Publication status

Version `1.0.2` uses this fork's independent updater signing key and update endpoints at `bargino/cursor-byok`. Packages cover Windows x64 (NSIS, MSI, portable ZIP), macOS Intel and Apple Silicon (DMG and application archives), and Linux x64 (AppImage, DEB, RPM, and a binary archive). The release includes updater manifests, signatures, and SHA-256 checksums.

从原上游切换需要手动安装本 fork。备份数据后完全退出 Cursor 和 Cursor BYOK，再安装对应平台的包。原上游应用不会自动切换更新源，旧版本也不信任本 fork 的新签名。详见[发布说明](releases/v1.0.2.md)。

## Validation

Local validation on Windows for the 2026-11-16 source publication:

| Check | Result |
| --- | --- |
| `cargo test -p cursor-server --locked` | 279 tests passed; no failures. Includes binary transport, RunInference, subagent identity, prefix stability, checkpoint recovery, and compaction. |
| `cargo clippy -p cursor-server --all-targets --locked -- -D warnings` | Passed. |
| `cargo fmt --all -- --check` | Passed for the workspace. |
| `npm run check` in `apps/desktop` | Type checks and production frontend build passed. Existing bundle-size and mixed-import warnings remain. |
| `node --check support/cursor-protocol-extractor/scripts/dump-runtime-protos.cjs` | Passed. |
| Staged diff and credential-pattern scan | Passed for the selected publication files; no credential patterns found. |

The initial source snapshot was checked out with LF line endings so embedded prompt fixtures retain their canonical bytes. Version `1.0.2` also updates frontend dependencies and the updater configuration. Cross-platform CI and tagged build results are available in [Actions](https://github.com/bargino/cursor-byok/actions). Building and signing packages does not establish live compatibility with every Cursor/provider combination.

CI runs on pushes to `main`, pull requests, and manual runs from the Actions page. The desktop release workflow remains triggered only by version tags.

## Known limitations

- Automated protocol tests use synthetic requests and fake providers. They do not establish compatibility with every Cursor version, provider, or tool.
- The RunInference path does not forward Cursor provider-defined tools; only function tools are sent to the configured provider. Non-image file attachments are represented by explanatory text.
- The initial source publication's frontend dependency audit reported 10 affected packages. The `v1.0.2` dependency update pins DOMPurify `3.4.18` and updates compatible dependency versions; the lockfile audit against `https://registry.npmjs.org` reports zero vulnerabilities. This is a dependency audit result, not a claim that the entire application is free of security issues.

Report reproducible problems in [this fork's Issues](https://github.com/bargino/cursor-byok/issues), with Cursor version, operating system, API protocol, error, and sanitized reproduction steps.
