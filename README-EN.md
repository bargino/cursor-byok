<div align="center">

# Cursor BYOK

An open-source local model gateway for Cursor, with configurable model APIs, account plugins and usage tracking.

[中文说明](./README.md) · [Download](#download) · [Quick start](#quick-start) · [Account plugins](#account-plugins) · [FAQ](#faq) · [Report an issue](https://github.com/bargino/cursor-byok/issues)

[![Release](https://img.shields.io/github/v/release/bargino/cursor-byok?style=flat-square)](https://github.com/bargino/cursor-byok/releases/latest)
[![CI](https://github.com/bargino/cursor-byok/actions/workflows/ci.yml/badge.svg)](https://github.com/bargino/cursor-byok/actions/workflows/ci.yml)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#download)
[![License](https://img.shields.io/github/license/bargino/cursor-byok?style=flat-square)](./LICENSE)

</div>

**Maintained repository: [`bargino/cursor-byok`](https://github.com/bargino/cursor-byok).** This is a community-maintained fork of [`leookun/cursor-byok`](https://github.com/leookun/cursor-byok). The versions, downloads and new account plugins below refer to this fork. Upstream contributions and license information are preserved in the repository.

Connect OpenAI- and Anthropic-compatible APIs to Cursor, or use account plugins to discover models from services you already use. Manage the connections locally, keep multiple accounts, and inspect model calls and usage in one desktop app.

**New in 1.0.5.** Configure and test an Images API, then ask Cursor Agent to list your image models, generate an image by model name, and save it in your workspace. This release also includes the WorkBuddy, Qoder, TeleAgent and Kiro account plugins. [Release notes](support/releases/v1.0.5.md)

## Features

- **Choose your model channel.** Configure endpoint, API key, model ID and request parameters with OpenAI Responses, Chat Completions or Anthropic Messages APIs.
- **Keep multiple accounts.** Save separate identities, rotate ready accounts and check provider credits. An interrupted request switches accounts only before any output starts.
- **Use Agent workflows.** Protocol adaptation supports tool calling, Skills, MCP and multi-turn conversations; behavior depends on the selected model and Cursor version.
- **See what is happening.** Inspect model calls, token usage, cache statistics, connection tests and estimated usage value.
- **Run locally on your desktop.** Windows, macOS Intel/Apple Silicon and Linux builds are available. Model requests go to the provider you select.

![Cursor BYOK dashboard showing model calls and token usage](./images/en-home-1.png)

*Interface preview with example data. The displayed usage, cache rate and estimated value are not performance benchmarks or savings claims.*

## Download

[Download v1.0.5](https://github.com/bargino/cursor-byok/releases/tag/v1.0.5) for image generation and the account plugins. The release assets are public downloads.

| Platform | Installer | Portable version or app archive |
| --- | --- | --- |
| Windows x64 | [EXE](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/Cursor.BYOK_1.0.5_x64-setup.exe) · [MSI](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/Cursor.BYOK_1.0.5_x64_en-US.msi) | [ZIP](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/cursor-byok-1.0.5-windows-amd64.zip) |
| macOS Apple Silicon | [ARM64 DMG](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/Cursor.BYOK_1.0.5_aarch64.dmg) | [ARM64 .app.tar.gz](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/Cursor.BYOK_1.0.5_aarch64.app.tar.gz) |
| macOS Intel | [x64 DMG](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/Cursor.BYOK_1.0.5_x64.dmg) | [x64 .app.tar.gz](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/Cursor.BYOK_1.0.5_x64.app.tar.gz) |
| Linux x64 | [DEB](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/Cursor.BYOK_1.0.5_amd64.deb) · [RPM](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/Cursor.BYOK-1.0.5-1.x86_64.rpm) | [AppImage](https://github.com/bargino/cursor-byok/releases/download/v1.0.5/Cursor.BYOK_1.0.5_amd64.AppImage) |

Use `SHA256SUMS.txt` from the release page to verify a download. The macOS packages use ad hoc signing and have no Apple notarization. To build locally, follow the [source build guide](support/fork-maintenance.md#build-from-source).

## Quick start

Before switching from upstream, quit Cursor and Cursor BYOK and back up `~/.cursor-byok-v3/`. This fork uses its own update feed and signing key, so switching requires a manual installation.

1. Install the package for your system. Open **Cursor Configuration** and follow the local CA setup instructions.
2. Add a model connection:
   - **API key:** open **Model Settings**, select the provider/protocol, enter endpoint, API key and model ID, then save and test.
   - **Account plugin:** open **Plugins**, initialize the plugin runtime, enable the provider and choose **Add account**. After authorization, enable the desired models in account management. Repeat to add more accounts.
3. Keep Cursor BYOK running. Quit Cursor completely, reopen it and start a **new conversation**.
4. Select your configured model in Cursor. **Auto uses Cursor's official models**, so select the custom model explicitly.

API keys and account credentials are stored locally. The connected provider determines model access, quotas and billing. Cursor BYOK is free and open source; provider usage may cost money. This is an independent community project, not affiliated with Cursor or the listed providers.

### Generate images in Cursor

Starting in 1.0.5, image generation is available in BYOK-managed Cursor Agent conversations. In the inference-only `RunInference` mode, Cursor supplies the tools.

In **Cursor Configuration → Add model**, choose the **Image generation** category. Enter the display name, upstream model ID, API key, and service URL for an OpenAI-compatible Images API. BYOK appends `/v1/images/generations` to a base URL or uses a full request URL as entered. The endpoint can return `b64_json` or a same-origin image URL.

To verify the configuration, open the image model’s test dialog, keep or edit the suggested prompt, and generate a test image. Each run requests one image from the configured provider and shows the preview and elapsed time. Your provider may charge for the request.

Open a workspace, select a BYOK chat model, and ask Agent “Which image models are available?” To generate an image, try “Use Studio to generate an app icon,” substituting your saved display name. Requests without a model name use the first image model in your configured order. After approval, the image is saved in your workspace.

## Account plugins

Version 1.0.5 includes the following account plugins. Each plugin has its own setup and import instructions.

| Plugin | Login / import | Balance and setup notes |
| --- | --- | --- |
| [WorkBuddy](server/plugins/build-in/workbuddy-auth/README.md) | China/Global official authorization; credential import/export | Credits and packages; manual check-in for China personal accounts |
| [Qoder](server/plugins/build-in/qoder-auth/README.md) | Separate China/Global authorization and pools; credential import/export | Plan, add-on and shared quota buckets |
| [TeleAgent](server/plugins/build-in/teleagent-auth/README.md) | Isolated official login or complete credential import | Points; browser login requires the official client installed and started once |
| [Kiro](server/plugins/build-in/kiro-auth/README.md) | US Builder ID device login; US/EU credential or API key import | Credits; EU Builder ID browser login and Social browser login are not provided |

Codex, Google Antigravity and Grok plugins also use the shared account store. Account identity and concurrent persistence tests cover the earlier issue where a later login could overwrite existing accounts.

**Validation:** automated protocol/account tests, anonymous endpoint checks and platform builds have passed. Real account authorization, paid model calls, token renewal and actual balances still need live validation. Check the [1.0.4 notes](support/releases/v1.0.4.md#validation-boundaries) before choosing a provider.

## FAQ

### Does Cursor BYOK run models locally?

Cursor BYOK is a desktop gateway running on your machine. It translates Cursor requests into requests to the configured model provider, then sends streaming output and tool calls back to Cursor. API keys, account credentials and settings are stored locally. Request content still goes to your chosen model service; running the gateway locally does not mean your code and prompts stay on your device.

### Which model APIs does Cursor BYOK support?

Chat models support the OpenAI Responses, OpenAI Chat Completions and Anthropic Messages APIs. Image models use the OpenAI Images API at `/v1/images/generations`. Select the protocol your provider supports, save the configuration, and run a test. [Image generation setup](#generate-images-in-cursor)

### Why does Cursor still use an official model after setup?

**Auto uses Cursor's official models.** Save and test the model configuration, keep Cursor BYOK running, quit Cursor completely and reopen it. Start a new conversation and select your configured model explicitly. See the [quick start](#quick-start) for the full setup sequence.

### Can I keep multiple accounts and check credit balances?

Account plugins can retain separate identities and form account pools. Available credit, plan and balance fields depend on each plugin and provider API; check [account plugins](#account-plugins) for login requirements and region restrictions. The 1.0.4 shared account storage fixes also cover Codex, Google Antigravity and Grok. Automated tests cover account identity and concurrent saves; real login, renewal and balance results still need live validation.

### Does a free gateway mean free model calls?

Cursor BYOK is free and open source. The provider determines model access, account quotas and usage charges; account pooling does not add or bypass provider quotas. Usage statistics and estimated values in the app are not provider invoices. Use the provider's records for billing.

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
