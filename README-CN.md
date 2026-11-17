<div align="center">

# Cursor BYOK

运行在本机的开源 Cursor 模型网关，支持自定义模型 API、账号池、积分查询与用量统计。

[English](./README.md) · [下载安装](#下载安装) · [快速开始](#快速开始) · [账号插件](#账号插件) · [提交问题](https://github.com/bargino/cursor-byok/issues)

[![Release](https://img.shields.io/github/v/release/bargino/cursor-byok?style=flat-square)](https://github.com/bargino/cursor-byok/releases/latest)
[![CI](https://github.com/bargino/cursor-byok/actions/workflows/ci.yml/badge.svg)](https://github.com/bargino/cursor-byok/actions/workflows/ci.yml)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](#下载安装)
[![License](https://img.shields.io/github/license/bargino/cursor-byok?style=flat-square)](./LICENSE)

</div>

在 Cursor 中使用自己配置的 OpenAI / Anthropic 兼容服务，或通过账号插件接入已有服务的模型。在一个桌面应用里管理模型连接、多个账号和调用记录。

**1.0.4 构建新增：**WorkBuddy、Qoder 国内/国际、TeleAgent（中国电信）和 Kiro 账号插件，支持账号池与积分查询；同时修复并发登录、刷新时覆盖其他账号的问题。登录条件和验证范围见 [1.0.4 说明](support/releases/v1.0.4.md)。

## 主要功能

- **自己的模型通道**：配置 API 地址、密钥、模型 ID 和参数，支持 OpenAI Responses、Chat Completions 与 Anthropic Messages 兼容接口。
- **多个账号一起管理**：按真实身份保存账号，轮转可用账号，查询服务商积分。失败切换只在响应开始输出前进行。
- **继续使用 Agent**：协议适配支持工具调用、Skills、MCP 和多轮对话，具体能力取决于模型和 Cursor 版本。
- **调用与用量可见**：查看请求记录、Token 用量、缓存统计、连接测试与估算价值。
- **桌面跨平台**：提供 Windows、macOS Intel / Apple Silicon 和 Linux 构建；本机网关将模型请求发往你选择的服务商。

![Cursor BYOK 控制面板，展示模型调用和 Token 用量](./images/en-home-1.png)

*界面预览使用示例数据；图中的用量、缓存命中率和估算价值不代表性能测试或实际节省金额。*

## 下载安装

**需要新增账号插件，请下载下面的 1.0.4 安装包构建。** 当前已发布的 GitHub Release 为 [v1.0.3](https://github.com/bargino/cursor-byok/releases/tag/v1.0.3)，不含这四个新增插件。

| 系统 | 1.0.4 账号插件构建 | 包含文件 |
| --- | --- | --- |
| Windows x64 | [下载构建 ZIP](https://github.com/bargino/cursor-byok/actions/runs/43882978067/artifacts/14234715652) | 安装 EXE、MSI、便携 ZIP |
| macOS Apple Silicon | [下载构建 ZIP](https://github.com/bargino/cursor-byok/actions/runs/43887113282/artifacts/14237991128) | ARM64 DMG、应用归档 |
| macOS Intel | [下载构建 ZIP](https://github.com/bargino/cursor-byok/actions/runs/43882978067/artifacts/14234398951) | x64 DMG、应用归档 |
| Linux x64 | [下载构建 ZIP](https://github.com/bargino/cursor-byok/actions/runs/43882978067/artifacts/14233629111) | AppImage、DEB、RPM、二进制归档 |

以上为 GitHub Actions 构建产物：需要先**登录 GitHub**，下载外层 ZIP 并解压，再选择系统对应的安装包。四个构建产物预计于 **2026 年 12 月 16 日**过期，包含版本/提交信息及 SHA-256 校验文件；它们尚未发布为 1.0.4 Release，也未进入自动更新源。

需要无需登录 GitHub 的正式发布包，可下载 [v1.0.3](https://github.com/bargino/cursor-byok/releases/tag/v1.0.3)。也可以按[源码构建说明](support/fork-maintenance.md#build-from-source)构建当前版本。macOS 包尚未经过 Apple 公证。

## 快速开始

从原上游切换前，请完全退出 Cursor 和 Cursor BYOK，并备份 `~/.cursor-byok-v3/` 数据目录。本 fork 使用独立更新源和签名，首次切换需要手动安装。

1. 安装适合系统的版本，打开 **Cursor 配置**，按提示初始化本地 CA。
2. 选择模型接入方式：
   - **API Key**：在 **模型设置** 中选择服务商和协议，填写服务地址、API Key 与模型 ID，保存并运行 **测试**。
   - **账号插件（1.0.4）**：打开 **插件**，先初始化插件运行时，启用对应插件并 **添加账号**。完成授权后，在账号管理中启用需要的模型；重复添加可组成账号池。
3. 保持 Cursor BYOK 运行，**完全退出并重新启动 Cursor，新开一个对话**。
4. 在 Cursor 中手动选择配置的模型。**Auto 使用 Cursor 官方模型**，不会自动使用自定义通道。

API Key 和账号凭据保存在本机；模型请求仍发送到对应服务商。模型权限、额度和费用以服务商为准。Cursor BYOK 免费开源，模型服务可能收费。本项目为独立社区项目，与 Cursor 或所列服务商无隶属或背书关系。

## 账号插件

以下新增插件包含在 **1.0.4 构建**中，点击名称查看详细登录和导入说明：

| 插件 | 登录 / 导入方式 | 积分与条件 |
| --- | --- | --- |
| [WorkBuddy](server/plugins/build-in/workbuddy-auth/README.md) | 国内 / 国际官方授权、凭据导入导出 | 积分、套餐；国内个人账号支持手动签到 |
| [Qoder](server/plugins/build-in/qoder-auth/README.md) | 国内 / 国际分别授权和建池、凭据导入导出 | 套餐、附加和共享积分 |
| [TeleAgent](server/plugins/build-in/teleagent-auth/README.md) | 独立官方登录窗口、完整凭据导入 | 积分；浏览器登录需先安装并启动过官方客户端 |
| [Kiro](server/plugins/build-in/kiro-auth/README.md) | 美区 Builder ID 设备授权；美 / 欧区凭据或 API Key 导入 | Credits；暂不提供欧区 Builder ID 或 Social 浏览器登录 |

现有 Codex、Google Antigravity 和 Grok 插件也使用统一账号存储。账号身份和并发持久化测试覆盖了“后登录的账号覆盖先前账号”的问题。

**验证范围：**已通过协议/账号自动化测试、匿名端点检查和各平台构建；真实账号授权、付费模型调用、续期与实际余额仍待实号验证。详情见 [1.0.4 验证记录](support/releases/v1.0.4.md#validation-boundaries)。

## 模型配置

每个模型配置都是独立的上游通道，可以单独设置服务商、协议、凭据和生成参数。

![模型设置页面](./images/en-model-1.png)

### 类型与协议选择

| 模型系列 | 模型类型 | 请求协议 |
| --- | --- | --- |
| Claude 系列 | **Anthropic** | Messages API |
| GPT / OpenAI 系列 | **OpenAI** | **Responses API** |
| 其他模型 | **OpenAI** | **Chat Completions API** |

请按服务商实际支持的接口选择协议；缓存行为和计费以该服务返回的用量为准。

### 常用字段

- **模型类型**：选择 OpenAI 或 Anthropic，决定上游接口格式。
- **请求协议**：OpenAI 类型需要继续选择 Responses API 或 Chat Completions API。
- **服务器地址**：可以填写服务商基础地址，让应用按协议追加标准端点，也可以填写完整请求 URL 并原样使用。
- **API Key**：填写上游服务要求的访问密钥。密钥保存在本机，用于发送模型请求。
- **模型名称**：填写服务商接口接受的模型标识，也可以使用 **获取模型** 读取服务商返回的模型列表。
- **显示名称**：Cursor 模型列表中显示的名称，不会改变发送给上游的模型标识。
- **备注**：显示在 Cursor 的模型说明中。

还可以根据模型能力设置上下文窗口 Token、最大输出 Token、推理或思考强度、自定义 Headers，以及 OpenAI 或 Anthropic 的额外参数。自定义 Headers 和额外参数必须是 JSON 对象，只应填写服务商明确支持的字段。

保存配置后运行 **测试**，确认地址、协议、API Key、模型标识和流式响应都正常，再在 Cursor 中使用该模型。

## TAB 补全服务

Cursor 的 Tab 补全由独立的 TAB 服务处理，不经过模型通道。你可以在 **系统设置 → TAB 设置** 中选择以下模式：

- **使用公益服务（默认）**：使用原项目配置的公共服务，无需额外配置，可用性由该服务决定。
- **直连**：直接连接当前 Cursor 账号对应的官方 TAB 服务，适合账号拥有官方额度的情况。
- **自定义**：自行部署 [`cursor-tab-server`](https://github.com/leookun/cursor-byok/tree/archive/v0.0.49/cursor-tab-server)，然后填写 TAB 服务地址。

修改 TAB 设置后，建议重启 Cursor 并新开一个对话，确保新的连接方式生效。

## 与官方账号并存

新版设计支持 cursor-byok 与 Cursor 官方服务并存：

- 直接在 Cursor 中登录自己的账号。如果之前使用旧版生成的 fake 账户，请先退出该账户，再登录自己的账号。
- 账号拥有官方额度时，官方模型和本地模型可以随时切换混用。
- **Auto 只使用官方模型**，不会自动使用你配置的本地模型。账号没有官方额度时，请手动选择自己配置的模型。
- 插件、代码库索引等 Cursor 功能可以继续使用。

## 数据流转

```text
Cursor：Agent 请求、工具结果与对话上下文
    │
    ▼
Cursor BYOK 本地服务
    ├── API 通道 → OpenAI / Anthropic 兼容服务
    └── 账号插件 → 服务商模型接口 + 账号池
    │
    ├── 本机保存：配置、凭据与对话状态
    └── 流式模型输出与工具调用 → Cursor
```

API Key、模型配置和应用设置保存在本机。模型请求仍会发送到你选择的上游服务商，请根据对应服务商的隐私政策和计费规则使用。

## 项目结构

```text
cursor-byok/
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   │   ├── features/ # 首页、模型、调用记录与设置
│   │   │   ├── shell/    # 窗口框架、页面布局与广告外壳
│   │   │   ├── shared/   # UI、虚拟列表、状态、API 与平台能力
│   │   │   ├── i18n/     # 本地化运行时与语言目录
│   │   │   └── styles/   # 全局主题与排版令牌
│   │   └── src-tauri/    # Tauri 桌面生命周期
├── server/
│   ├── src/
│   │   ├── api/       # Cursor 与管理接口的 HTTP / 流式边界
│   │   ├── cursor/    # Cursor 适配中的共享领域逻辑
│   │   ├── run/       # 通用 Agent Runtime 与内部 Port
│   │   ├── provider/  # 模型供应商适配
│   │   ├── model/     # 聚合领域模型
│   │   ├── store/     # SQLite Repository
│   │   ├── control/   # 管理面 API
│   │   ├── plugin/    # 插件运行时、账号存储与账号池
│   │   ├── local_app/ # 本地应用状态与生命周期
│   │   └── search/    # Web 与 Semble 搜索接入
│   ├── plugins/      # 内置账号插件与共享 SDK
│   ├── prompt/       # 运行时提示词资源
│   └── migrations/   # SQLite 数据库结构
├── crates/
│   └── semble-core/   # 本地代码索引与搜索核心库
├── protocols/
│   └── cursor/        # Cursor 协议定义的唯一来源
├── support/                     # 仓库辅助设施
│   ├── cursor-protocol-extractor/ # Cursor 协议提取与 Go 代码生成工具
│   ├── cursor-capture/            # Cursor 协议抓取和调试工具
│   └── benchmarks/                # 代码搜索和索引基准测试
├── images/            # README 展示图片
├── Cargo.toml         # Rust 工作区配置
└── Makefile           # 常用开发、检查和构建命令
```

## 本地开发

### 环境要求

- Rust 工具链和 Cargo
- Node.js 与 npm
- Tauri 2 的系统构建依赖
- Docker（仅在构建 Docker 镜像时需要）

### 安装依赖

```bash
npm --prefix apps/desktop install
```

### 启动开发环境

启动桌面前端：

```bash
make dev-web
```

启动桌面应用：

```bash
make dev-desktop
```

### 检查与构建

运行完整检查：

```bash
make check
```

分别构建各部分：

```bash
make build-web       # 构建桌面前端
make build-server    # 构建 Rust 本地服务
make build-desktop   # 构建 Tauri 桌面安装包
make build-docker    # 构建 Docker 镜像
```

## 路线图

本 fork 优先处理 Cursor 协议兼容、子代理执行与回归验证。当前范围及验证边界记录在[维护说明](support/fork-maintenance.md)中。

原[上游发布路线图](https://github.com/leookun/cursor-byok/discussions/32)保留作历史参考。

## 社区与反馈

欢迎提交可复现的问题、安装反馈和 Pull Request。

- [本 fork 的 GitHub Issues](https://github.com/bargino/cursor-byok/issues)：问题、功能建议与账号插件反馈。
- [维护与构建说明](support/fork-maintenance.md)：兼容范围、回归记录和源码构建。
- [原上游使用指南](https://docs.leokun.cn/zh/docs)：历史安装文档，本 fork 新功能以仓库说明为准。

提交问题时，请附上操作系统、Cursor / Cursor BYOK 版本、模型类型、请求协议、脱敏错误信息和复现步骤。

本项目由 [bargino](https://github.com/bargino) 维护，基于已于 2026 年 10 月 20 日归档的 [leookun/cursor-byok](https://github.com/leookun/cursor-byok)，保留原贡献历史与署名。原[上游路线图](https://github.com/leookun/cursor-byok/discussions/32)、[归档 Issues](https://github.com/leookun/cursor-byok/issues)、[Telegram](https://t.me/cursor_byok) 和 QQ 群（`1095916242`、`1094411438`、`1095918002`、`1094419321`）属于原上游社区；本 fork 的问题请提交到自己的 Issues。

## 参与贡献

欢迎提交 Issue 和 Pull Request。代码改动前请阅读项目开发说明，并运行与改动相应的检查；完整验证使用 `make check`。

## 许可证

核心项目采用 [MIT License](./LICENSE)。各账号插件保留对应第三方许可证与署名，详见插件目录中的 `LICENSE*` 文件。
