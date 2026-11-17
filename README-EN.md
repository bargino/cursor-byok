<div align="center">

# Cursor BYOK

An open-source local model gateway for Cursor, with configurable model APIs, account plugins and usage tracking.

[中文说明](./README.md) · [Download](#download) · [Quick start](#quick-start) · [Account plugins](#account-plugins) · [Report an issue](https://github.com/bargino/cursor-byok/issues)

[![Release](https://img.shields.io/github/v/release/bargino/cursor-byok?style=flat-square)](https://github.com/bargino/cursor-byok/releases/latest)
[![CI](https://github.com/bargino/cursor-byok/actions/workflows/ci.yml/badge.svg)](https://github.com/bargino/cursor-byok/actions/workflows/ci.yml)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#download)
[![License](https://img.shields.io/github/license/bargino/cursor-byok?style=flat-square)](./LICENSE)

</div>

Connect OpenAI- and Anthropic-compatible APIs to Cursor, or use account plugins to discover models from services you already use. Manage the connections locally, keep multiple accounts, and inspect model calls and usage in one desktop app.

**New in the 1.0.4 build:** WorkBuddy, Qoder China/Global, TeleAgent and Kiro plugins, with account pooling and credit queries. The shared account store also fixes concurrent login/refresh overwriting other accounts. See [requirements and validation scope](support/releases/v1.0.4.md).

## Features

- **Choose your model channel.** Configure endpoint, API key, model ID and request parameters with OpenAI Responses, Chat Completions or Anthropic Messages APIs.
- **Keep multiple accounts.** Save separate identities, rotate ready accounts and check provider credits. An interrupted request switches accounts only before any output starts.
- **Use Agent workflows.** Protocol adaptation supports tool calling, Skills, MCP and multi-turn conversations; behavior depends on the selected model and Cursor version.
- **See what is happening.** Inspect model calls, token usage, cache statistics, connection tests and estimated usage value.
- **Run locally on your desktop.** Windows, macOS Intel/Apple Silicon and Linux builds are available. Model requests go to the provider you select.

![Cursor BYOK dashboard showing model calls and token usage](./images/en-home-1.png)

*Interface preview with example data. The displayed usage, cache rate and estimated value are not performance benchmarks or savings claims.*

## Download

**Want the new account plugins? Use the 1.0.4 installer build below.** The latest published GitHub Release is currently [v1.0.3](https://github.com/bargino/cursor-byok/releases/tag/v1.0.3), which predates those plugins.

| Platform | 1.0.4 account-plugin build | Included packages |
| --- | --- | --- |
| Windows x64 | [Download artifact ZIP](https://github.com/bargino/cursor-byok/actions/runs/43882978067/artifacts/14234715652) | Setup EXE, MSI, portable ZIP |
| macOS Apple Silicon | [Download artifact ZIP](https://github.com/bargino/cursor-byok/actions/runs/43887113282/artifacts/14237991128) | ARM64 DMG, application archive |
| macOS Intel | [Download artifact ZIP](https://github.com/bargino/cursor-byok/actions/runs/43882978067/artifacts/14234398951) | x64 DMG, application archive |
| Linux x64 | [Download artifact ZIP](https://github.com/bargino/cursor-byok/actions/runs/43882978067/artifacts/14233629111) | AppImage, DEB, RPM, binary archive |

These are GitHub Actions artifacts: **sign in to GitHub**, download the outer ZIP and extract the installer for your system. These four artifacts are scheduled to expire on **December 16, 2026**. They include a version/commit manifest and SHA-256 checksums. They are installer builds, not a published 1.0.4 Release or updater release.

Prefer a published release without a GitHub sign-in? [Download v1.0.3](https://github.com/bargino/cursor-byok/releases/tag/v1.0.3). To build the current source, follow the [build guide](support/fork-maintenance.md#build-from-source). macOS packages are not Apple-notarized.

## Quick start

Before switching from upstream, quit Cursor and Cursor BYOK and back up `~/.cursor-byok-v3/`. This fork uses its own update feed and signing key, so switching requires a manual installation.

1. Install the package for your system. Open **Cursor Configuration** and follow the local CA setup instructions.
2. Add a model connection:
   - **API key:** open **Model Settings**, select the provider/protocol, enter endpoint, API key and model ID, then save and test.
   - **Account plugin (1.0.4):** open **Plugins**, initialize the plugin runtime, enable the provider and choose **Add account**. After authorization, enable the desired models in account management. Repeat to add more accounts.
3. Keep Cursor BYOK running. Quit Cursor completely, reopen it and start a **new conversation**.
4. Select your configured model in Cursor. **Auto uses Cursor's official models**, so select the custom model explicitly.

API keys and account credentials are stored locally. The connected provider determines model access, quotas and billing. Cursor BYOK is free and open source; provider usage may cost money. This is an independent community project, not affiliated with Cursor or the listed providers.

## Account plugins

The following additions are in the **1.0.4 build**. Each plugin has its own setup and import instructions:

| Plugin | Login / import | Balance and setup notes |
| --- | --- | --- |
| [WorkBuddy](server/plugins/build-in/workbuddy-auth/README.md) | China/Global official authorization; credential import/export | Credits and packages; manual check-in for China personal accounts |
| [Qoder](server/plugins/build-in/qoder-auth/README.md) | Separate China/Global authorization and pools; credential import/export | Plan, add-on and shared quota buckets |
| [TeleAgent](server/plugins/build-in/teleagent-auth/README.md) | Isolated official login or complete credential import | Points; browser login requires the official client installed and started once |
| [Kiro](server/plugins/build-in/kiro-auth/README.md) | US Builder ID device login; US/EU credential or API key import | Credits; EU Builder ID browser login and Social browser login are not provided |

Codex, Google Antigravity and Grok plugins also use the shared account store. Account identity and concurrent persistence tests cover the earlier issue where a later login could overwrite existing accounts.

**Validation:** automated protocol/account tests, anonymous endpoint checks and platform builds have passed. Real account authorization, paid model calls, token renewal and actual balances still need live validation. Check the [1.0.4 notes](support/releases/v1.0.4.md#validation-boundaries) before choosing a provider.

## Model management

Set the context window, maximum output tokens, reasoning effort, headers and extra request parameters per model. Add, duplicate, edit, reorder or batch-test model configurations.

![Cursor BYOK model settings](./images/en-model-1.png)

## How it works

```text
Cursor: Agent requests, tool results and conversation context
    │
    ▼
Cursor BYOK on your machine
    ├── API connection → OpenAI / Anthropic-compatible service
    └── Account plugin → provider model API + account pool
    │
    ├── Local settings, credentials and conversation state
    └── Streaming model output and tool calls → Cursor
```

The gateway handles Cursor protocol adaptation, provider requests, tool-call coordination and conversation state. Compatibility can change when Cursor or a provider updates; report the versions and a redacted reproduction in [Issues](https://github.com/bargino/cursor-byok/issues).

## Support and contributing

Reproducible bug reports, setup feedback and pull requests are welcome.

- [Report a bug / request a feature](https://github.com/bargino/cursor-byok/issues)
- [Maintenance, builds and regression scope](support/fork-maintenance.md)
- [Upstream user guide](https://docs.leokun.cn) — historical guide; fork-specific features are documented here.

This community fork is maintained by [bargino](https://github.com/bargino), based on [leookun/cursor-byok](https://github.com/leookun/cursor-byok), archived on October 20, 2026. Original contributor history and attribution are preserved. The original [roadmap](https://github.com/leookun/cursor-byok/discussions/32), [archived Issues](https://github.com/leookun/cursor-byok/issues), [Telegram](https://t.me/cursor_byok) and QQ groups (`1095916242`, `1094411438`, `1095918002`, `1094419321`) belong to the upstream community; use this fork's Issues for its support.

## License

Core project: [MIT](./LICENSE). Account plugin directories retain their respective third-party licenses and attribution; see their `LICENSE*` files.
