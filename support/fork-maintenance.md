# Fork maintenance / 社区维护说明

This is the source fork at [bargino/cursor-byok](https://github.com/bargino/cursor-byok), based on upstream commit `31e9f5cbc98a7d28cffcb5efbb9323cd3e143354`. The original project is [leookun/cursor-byok](https://github.com/leookun/cursor-byok). Its MIT license and existing contributor history are retained.

本次源码发布日期为 2026-11-16。原上游已经归档；本 fork 的源码、问题反馈与后续贡献请使用本仓库入口。

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

This publication contains source code only. No new application version, release tag, signed installer, or independent update feed is published as part of it. The application manifests still use upstream version `1.0.1`, updater endpoints, and public signing key. Upstream downloads and automatic updates do not include this fork's changes.

正式安装包发布前，需要设置本仓库的更新入口与独立签名，并验证实际安装和升级。请勿将上游安装包视为本 fork 的构建产物。

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

The source snapshot was checked out with LF line endings so embedded prompt fixtures retain their canonical bytes. The frontend package manifests and lockfile are unchanged from upstream. This publication did not repeat live Cursor/provider acceptance tests or build a signed installer. Cross-platform CI results are available in [Actions](https://github.com/bargino/cursor-byok/actions).

## Known limitations

- Automated protocol tests use synthetic requests and fake providers. They do not establish compatibility with every Cursor version, provider, or tool.
- The RunInference path does not forward Cursor provider-defined tools; only function tools are sent to the configured provider. Non-image file attachments are represented by explanatory text.
- The unchanged upstream frontend dependency set has npm audit findings. The 2026-11-16 audit against `https://registry.npmjs.org` reported 10 affected packages: 3 critical, 6 high, and 1 low. Packages include `concurrently`, `shell-quote`, `dompurify`, `axios`, `follow-redirects`, `joi`, `monaco-editor`, `nanoid`, `source-map-js`, and `vite`. Dependency remediation remains open; this publication does not claim a clean security audit.

Report reproducible problems in [this fork's Issues](https://github.com/bargino/cursor-byok/issues), with Cursor version, operating system, API protocol, error, and sanitized reproduction steps.
