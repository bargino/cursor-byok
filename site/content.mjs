export const content = {
  en: {
    language: "en",
    languageName: "English",
    alternateName: "中文",
    nav: ["Overview", "Quick start", "Account plugins", "FAQ"],
    github: "View on GitHub",
    download: "Download & set up",
    source: "Source documentation",
    skip: "Skip to content",
    reviewed: "Content reviewed",
    fork: "A community-maintained fork of leookun/cursor-byok. Original authorship, contributor history and licenses are preserved.",
    independent:
      "Independent community project. Not affiliated with Cursor or the listed providers. Model access, quotas and charges are set by each provider.",
    feedback:
      "Found a problem? Include your OS, Cursor and Cursor BYOK versions, and redacted reproduction steps in Issues.",
    star: "Useful in your workflow? Star the repository to follow development.",
    pages: {
      home: {
        title: "Cursor BYOK — Your model APIs and account pools in Cursor",
        description:
          "Connect your model APIs and account plugins to Cursor with an open-source desktop gateway. Setup, WorkBuddy, Qoder, TeleAgent, Kiro and account pool documentation.",
        eyebrow: "OPEN-SOURCE DESKTOP MODEL GATEWAY",
        heading: "Your models. Your accounts. In Cursor.",
        intro:
          "Connect your own OpenAI- or Anthropic-compatible APIs to Cursor. Manage model connections, multiple accounts and usage from one desktop app on Windows, macOS or Linux.",
        diagram: [
          "Cursor Agent",
          "Cursor BYOK · on your machine",
          "Your API or account provider",
        ],
        diagramNote:
          "Model requests go to your chosen provider. Settings and credentials are stored locally.",
        featuresTitle: "Choose how your models connect",
        features: [
          [
            "Your model APIs",
            "Set endpoint, API key, model ID and request protocol. Configure Responses, Chat Completions or Anthropic Messages according to your provider.",
          ],
          [
            "Your account pools",
            "Save multiple provider identities, rotate ready accounts and query credits. Account plugins are included in the 1.0.4 installer build.",
          ],
          [
            "Your call history",
            "Inspect model calls, token usage, cache statistics and connection tests in the desktop interface.",
          ],
        ],
        providersTitle: "Account connections, with clear requirements",
        providersIntro:
          "The 1.0.4 build adds WorkBuddy, Qoder China/Global, TeleAgent and Kiro. Each provider has its own authorization, region and quota rules.",
        providersLink: "Read the account setup matrix",
        screenshotTitle: "See the connections you use",
        screenshotCaption:
          "Interface preview with example data. Displayed cache rates, usage and dollar estimates are not benchmarks or measured savings.",
        scopeTitle: "What has been verified?",
        scope:
          "Automated protocol/account tests, anonymous authorization endpoint checks and platform builds have passed. Real account authorization, paid model calls, token renewal and actual credit balances still require live validation.",
        scopeLink: "Read the validation notes",
        nextTitle: "Start with a model connection",
        next: "Choose your installer, connect an API or account plugin, then select the configured model in a new Cursor conversation.",
      },
      guide: {
        title: "Cursor BYOK installation and custom model setup",
        description:
          "Install Cursor BYOK on Windows, macOS or Linux, configure a model API or account plugin, restart Cursor and select your model. Includes 1.0.4 build downloads.",
        heading: "From your model service to Cursor.",
        intro:
          "Install the desktop gateway, add a model connection, then start a new Cursor conversation. Use the 1.0.4 build for the four new account plugins.",
        downloadTitle: "Choose the package for your system",
        build: "Account-plugin installer build",
        release: "Published GitHub Release",
        artifactNote:
          "The 1.0.4 links below are GitHub Actions artifacts. Sign in to GitHub, download the outer ZIP and extract the installer. Each artifact includes version/commit information and SHA-256 checksums.",
        expiry: "These artifacts are scheduled to expire on",
        releaseNote:
          "The published 1.0.3 Release predates the four new account plugins. It is available without a GitHub sign-in. The 1.0.4 build is not an updater release. macOS packages are not Apple-notarized.",
        releaseLink: "Download published release",
        stepsTitle: "Install, connect, then restart Cursor",
        steps: [
          [
            "Back up and install",
            "When switching from upstream, quit Cursor and Cursor BYOK and back up ~/.cursor-byok-v3/. Install this fork manually: its updater feed and signing key differ from upstream.",
          ],
          [
            "Set up the Cursor connection",
            "Open Cursor Configuration in the desktop app and follow its local CA setup instructions. Keep Cursor BYOK running while using the configured connection.",
          ],
          [
            "Connect an API",
            "Open Model Settings. Choose the provider and protocol, enter the service endpoint, API key and model ID, save, then run the connection test. Choose only parameters and protocols your provider actually supports.",
          ],
          [
            "Or add an account plugin",
            "In the 1.0.4 build, open Plugins and initialize the plugin runtime. Enable the provider and choose Add account. After authorization, enable the desired models in account management. Repeat to save additional accounts.",
          ],
          [
            "Restart Cursor and choose the model",
            "Quit Cursor completely, reopen it and start a new conversation. Select the configured model manually. Auto uses Cursor official models and does not route to your custom model.",
          ],
        ],
        protocolsTitle: "Choose the API your service supports",
        protocols: [
          ["OpenAI Responses", "For services exposing the Responses API."],
          [
            "OpenAI Chat Completions",
            "For services exposing the Chat Completions API.",
          ],
          [
            "Anthropic Messages",
            "For services exposing the Anthropic Messages API.",
          ],
        ],
        protocolsNote:
          "A service’s model name does not guarantee protocol compatibility. Test the connection before using it in Cursor; caching and billing follow the provider’s returned usage.",
        troubleshootingTitle: "If the model does not appear",
        troubleshooting:
          "Check that the model is enabled, the connection test passes, Cursor BYOK is running, and you opened a new conversation after a complete Cursor restart. For account-specific requirements, use the account setup page.",
      },
      accounts: {
        title: "WorkBuddy, Qoder, TeleAgent and Kiro accounts in Cursor",
        description:
          "Cursor BYOK account plugin setup: WorkBuddy China/Global, Qoder regions, TeleAgent client requirement, Kiro Builder ID or imports, account pools and credit queries.",
        heading: "One place for your provider accounts.",
        intro:
          "The 1.0.4 installer build adds four provider plugins. Add accounts in Plugins, synchronize the available model catalog, then enable the models you want to use in Cursor.",
        requirement: "Login and requirements",
        balance: "Credits and quota",
        providers: {
          workbuddy: [
            "China and Global official authorization, with separate regional pools. Credential import/export is supported, including compatible workbuddy2api-panel account JSON. Models synchronize after successful authorization.",
            "Refresh queries credits; package details include expiry. China personal accounts support manual check-in. Actual model access and billing depend on the account.",
          ],
          qoder: [
            "Choose Qoder China or Global, add an account and complete official authorization. Regions have separate pools. Credential imports accept a single object, an array or an accounts wrapper.",
            "Refresh queries plan, add-on and shared quota buckets. Missing values are not converted to zero, and unlimited quota is not replaced with a made-up numeric balance.",
          ],
          teleagent: [
            "TeleAgent is the China Telecom service. Browser authorization requires the official TeleAgent client installed and started once. The plugin opens an isolated official login window and uses the original device/install metadata. Complete credentials can also be imported.",
            "Refresh queries points. Imported official-client sessions are not automatically refreshed, to avoid rotating shared credentials; reauthorize or re-import when they expire. Sessions created by the isolated login window can use the official renewal interface.",
          ],
          kiro: [
            "US us-east-1 supports AWS Builder ID device authorization. US and EU eu-central-1 support complete OAuth credentials or a ksk_ API key. EU Builder ID browser login and Google/GitHub Social browser login are not provided.",
            "Refresh queries Credits, including valid trial/bonus quota and fractional values, excluding expired bonuses. The model catalog and permissions come from the authorized provider account.",
          ],
        },
        poolTitle: "How multiple accounts are kept separate",
        pool: [
          "Accounts are identified using provider identity and region/profile fields, not a display nickname or short-lived access token.",
          "The shared store locks account-list read/merge/write so a stale concurrent login or refresh cannot replace a newer account list.",
          "The host rotates ready accounts. An account failure can retry another ready account only before any response output starts.",
          "Once output starts, an error ends that response. Text and tool calls from different accounts are not spliced together.",
        ],
        existingTitle: "Codex, Google Antigravity and Grok",
        existing:
          "The existing plugins use the shared account store too. Identity and persistence regression tests cover multiple saved accounts and the earlier case where only the last login was retained. Their provider-specific quotas and authorization rules remain separate.",
        validationTitle: "Live-account validation is still pending",
        validation:
          "Protocol tests and simulated provider responses cover account identity, renewal, streaming, quota parsing and concurrency. Anonymous endpoint checks and installer builds also passed. These checks do not establish that every real account can authorize, make a paid model call, renew or return an accurate live balance.",
      },
      faq: {
        title: "Cursor BYOK FAQ: APIs, account pools, credits and setup",
        description:
          "Answers about Cursor BYOK: what it does, supported account plugins, multiple-account fixes, provider credits, Auto model selection, billing and validation limits.",
        heading: "Answers before you connect.",
        intro:
          "Practical answers about custom models, account plugins and the limits of the current build. Each section has a direct link for sharing.",
        items: [
          [
            "what-is-cursor-byok",
            "What is Cursor BYOK?",
            "Cursor BYOK is an open-source local model gateway for Cursor. It adapts Cursor requests to model APIs or account plugins you configure and provides a desktop interface for connection settings, model calls and usage.",
          ],
          [
            "official-byok",
            "Is this Cursor’s built-in BYOK setting?",
            "No. This is an independent community application running on your machine. It configures a local Cursor connection and manages its own model channels. It is not an official Cursor product or a provider endorsement.",
          ],
          [
            "supported-apis",
            "Which model APIs can I configure?",
            "OpenAI Responses, OpenAI Chat Completions and Anthropic Messages compatible services. Supply the endpoint, credentials and model ID accepted by your provider. Model access and tool support depend on that provider and the selected model.",
          ],
          [
            "workbuddy-qoder",
            "Can I use WorkBuddy or Qoder accounts in Cursor?",
            "The 1.0.4 installer build includes WorkBuddy and Qoder China/Global plugins with authorization, model discovery, account pools and credit queries. These flows have automated tests; real-account authorization, model billing and balances still need live validation.",
          ],
          [
            "multiple-accounts",
            "Does adding another account overwrite the previous one?",
            "The 1.0.4 account store saves distinct identities and serializes account-list updates. Regression tests cover concurrent login/refresh and multiple Codex, Google Antigravity and Grok identities. Reauthorizing the same identity updates that account; distinct identities remain separate.",
          ],
          [
            "credit-balances",
            "How do I query credits?",
            "Open the provider’s account management and choose Refresh. WorkBuddy exposes credits/packages, Qoder exposes quota buckets, TeleAgent exposes points and Kiro exposes Credits. Values and expiry come from the provider; this site does not display a live account balance.",
          ],
          [
            "teleagent-login",
            "What does TeleAgent login require?",
            "Install and start the official TeleAgent client once so original device and installation metadata are available. The plugin uses an isolated official login window; complete credential imports are also supported.",
          ],
          [
            "kiro-regions",
            "Which Kiro login methods are available?",
            "AWS Builder ID device authorization is offered for us-east-1. Complete OAuth credentials or API keys can be imported for US/EU regions. EU Builder ID browser login and Google/GitHub Social browser authorization are not included.",
          ],
          [
            "model-not-visible",
            "Why does Cursor not show or use my model?",
            "Enable the model, test the connection and keep Cursor BYOK running. Completely quit and restart Cursor, then create a new conversation. Select the configured model manually: Auto uses Cursor official models.",
          ],
          [
            "free-models",
            "Does open source mean the models are free?",
            "The gateway is free and open source. It does not grant provider subscriptions or model credits. Provider access, quotas and charges still apply; model requests and conversation content go to the provider you select.",
          ],
          [
            "versions",
            "Which download includes the new plugins?",
            "Use the 1.0.4 Actions installer build for WorkBuddy, Qoder, TeleAgent and Kiro. The published 1.0.3 Release predates those plugins. Actions downloads require a GitHub sign-in and have an expiry date shown in the installation guide.",
          ],
          [
            "upstream-and-support",
            "Who maintains this fork and where do I report issues?",
            "bargino maintains this community fork of leookun/cursor-byok. Original authorship and contribution history are retained. Report fork-specific issues in bargino/cursor-byok with versions, redacted errors and reproduction steps.",
          ],
        ],
      },
    },
  },
  zh: {
    language: "zh-Hans",
    languageName: "简体中文",
    alternateName: "English",
    nav: ["项目介绍", "安装指南", "账号插件", "常见问题"],
    github: "GitHub 源码",
    download: "下载安装",
    source: "查看源码文档",
    skip: "跳到正文",
    reviewed: "内容核对日期",
    fork: "由社区继续维护的 leookun/cursor-byok 分支，保留原作者署名、贡献历史与许可证。",
    independent:
      "独立社区项目，与 Cursor 或所列服务商无隶属或背书关系。模型权限、额度和费用由对应服务商决定。",
    feedback:
      "遇到问题，请在 Issues 附上系统、Cursor / Cursor BYOK 版本、脱敏错误和复现步骤。",
    star: "如果项目对你有帮助，欢迎 Star 仓库，关注后续更新。",
    pages: {
      home: {
        title: "Cursor BYOK：把自己的模型 API 和多账号池接入 Cursor",
        description:
          "Cursor BYOK 是开源桌面模型网关，连接自定义模型 API 与账号插件。查看安装步骤、WorkBuddy、Qoder 国内国际、TeleAgent、Kiro、多账号池和积分查询说明。",
        eyebrow: "开源桌面模型网关 · 社区持续维护",
        heading: "自己的模型和账号，都在 Cursor 里用。",
        intro:
          "把自己配置的 OpenAI / Anthropic 兼容 API 接入 Cursor，在一个桌面应用里管理模型连接、多个账号和调用用量。支持 Windows、macOS 和 Linux。",
        diagram: [
          "Cursor Agent",
          "Cursor BYOK · 本机网关",
          "你的 API 或账号服务商",
        ],
        diagramNote: "模型请求发往你选择的服务商，配置和凭据保存在本机。",
        featuresTitle: "按你的模型来源，选择接入方式",
        features: [
          [
            "自己的模型 API",
            "填写服务地址、API Key 和模型 ID。根据服务商实际接口选择 Responses、Chat Completions 或 Anthropic Messages 协议。",
          ],
          [
            "自己的账号池",
            "保存多个服务商账号，轮转可用账号并查询积分。新增账号插件包含在 1.0.4 安装包构建中。",
          ],
          [
            "看得见的调用记录",
            "在桌面界面查看模型调用、Token 用量、缓存统计和连接测试，定位接入问题。",
          ],
        ],
        providersTitle: "账号接入，各自的条件说清楚",
        providersIntro:
          "1.0.4 构建新增 WorkBuddy、Qoder 国内/国际、TeleAgent 和 Kiro。不同服务分别遵循自己的授权方式、区域和额度规则。",
        providersLink: "查看账号登录与积分说明",
        screenshotTitle: "模型调用和用量，集中查看",
        screenshotCaption:
          "界面预览使用示例数据，图中的缓存率、用量和美元估算值不代表性能测试或实际节省金额。",
        scopeTitle: "目前验证到了哪一步？",
        scope:
          "已通过协议与账号自动化测试、匿名授权端点检查和各平台构建。真实账号授权、付费模型调用、令牌续期和实际积分余额仍待实号验证。",
        scopeLink: "查看验证记录",
        nextTitle: "从一个模型连接开始",
        next: "选择系统对应的安装包，添加 API 或账号插件，再在 Cursor 新对话里手动选择配置的模型。",
      },
      guide: {
        title: "Cursor BYOK 安装指南：在 Cursor 配置自定义模型和账号",
        description:
          "在 Windows、macOS 和 Linux 安装 Cursor BYOK，配置模型 API 或账号插件，重启 Cursor 并选择自定义模型。含 1.0.4 构建下载和常见排查步骤。",
        heading: "从你的模型服务，接到 Cursor。",
        intro:
          "安装本机网关、添加模型连接，再新建 Cursor 对话。使用四个新增账号插件，请选择 1.0.4 构建。",
        downloadTitle: "选择适合系统的安装包",
        build: "账号插件安装包构建",
        release: "已发布 GitHub Release",
        artifactNote:
          "以下 1.0.4 链接是 GitHub Actions 构建产物。先登录 GitHub，下载外层 ZIP 并解压，再选择安装包。产物包含版本/提交信息与 SHA-256 校验文件。",
        expiry: "这些构建产物预计过期日期为",
        releaseNote:
          "已发布的 1.0.3 Release 不含四个新增账号插件，可无需登录 GitHub 下载。1.0.4 构建尚未进入自动更新源；macOS 包尚未经过 Apple 公证。",
        releaseLink: "下载已发布版本",
        stepsTitle: "安装、添加连接，然后重启 Cursor",
        steps: [
          [
            "备份并安装",
            "从原上游切换前，完全退出 Cursor 和 Cursor BYOK，备份 ~/.cursor-byok-v3/。本分支的更新源和签名与上游不同，首次需要手动安装。",
          ],
          [
            "初始化 Cursor 连接",
            "打开桌面应用的「Cursor 配置」，按界面提示完成本地 CA 设置。使用配置的模型时，保持 Cursor BYOK 运行。",
          ],
          [
            "添加模型 API",
            "进入「模型设置」，选择服务商与协议，填写服务地址、API Key 和模型 ID，保存后运行测试。只填写服务商实际支持的协议和参数。",
          ],
          [
            "或添加账号插件",
            "在 1.0.4 构建的「插件」页先初始化运行时，启用对应插件并添加账号。授权后在账号管理中启用需要的模型；重复添加可保存多个账号。",
          ],
          [
            "重启 Cursor 并选择模型",
            "完全退出并重新打开 Cursor，新建一个对话，手动选择配置的模型。Auto 使用 Cursor 官方模型，不会自动使用自定义模型通道。",
          ],
        ],
        protocolsTitle: "按服务商接口选择协议",
        protocols: [
          ["OpenAI Responses", "适合提供 Responses API 的服务。"],
          ["OpenAI Chat Completions", "适合提供 Chat Completions API 的服务。"],
          ["Anthropic Messages", "适合提供 Anthropic Messages API 的服务。"],
        ],
        protocolsNote:
          "模型名称本身不能保证协议兼容。先运行连接测试，再在 Cursor 使用；缓存行为和计费以服务商返回的用量为准。",
        troubleshootingTitle: "如果模型没有出现",
        troubleshooting:
          "检查模型是否启用、连接测试是否通过、Cursor BYOK 是否运行，以及是否完整重启 Cursor 后新建了对话。不同账号的登录前置条件见账号插件说明。",
      },
      accounts: {
        title: "Cursor 接入 WorkBuddy、Qoder、TeleAgent 和 Kiro 账号说明",
        description:
          "Cursor BYOK 账号插件说明：WorkBuddy 国内国际、Qoder 区域账号、TeleAgent 客户端条件、Kiro Builder ID 或凭据导入，以及多账号池和积分查询。",
        heading: "多个服务的账号，在一处管理。",
        intro:
          "1.0.4 安装包构建新增四个账号插件。在「插件」中添加账号、同步上游模型目录，再启用想在 Cursor 中使用的模型。",
        requirement: "登录方式与前置条件",
        balance: "积分与额度",
        providers: {
          workbuddy: [
            "支持国内与国际官方授权，分区域保存账号池。支持凭据导入导出，可导入兼容的 workbuddy2api-panel 账号 JSON。授权成功后同步模型目录。",
            "在账号管理点击「刷新」查询积分，套餐明细包含到期时间；国内个人账号支持手动签到。实际模型权限与费用以账号为准。",
          ],
          qoder: [
            "选择 Qoder 国内或国际账号，添加账号并完成官方授权。两区账号池分开管理。导入接受单个对象、数组或 accounts 包装对象。",
            "「刷新」查询套餐、附加与共享积分。上游缺失的数值不会当成零，无限共享额度也不会转成虚构的数字余额。",
          ],
          teleagent: [
            "TeleAgent 为中国电信服务。浏览器授权前需安装并启动过官方 TeleAgent 客户端，以读取原始设备和安装元数据。插件使用独立官方登录窗口，也支持完整凭据导入。",
            "「刷新」查询积分。导入的官方客户端会话不会自动刷新，避免旋转共享凭据；到期后需重新授权或导入。独立登录窗口创建的会话可使用官方续期接口。",
          ],
          kiro: [
            "美区 us-east-1 支持 AWS Builder ID 设备授权；美区和欧区 eu-central-1 支持导入完整 OAuth 凭据或 ksk_ API Key。暂不提供欧区 Builder ID、Google / GitHub Social 浏览器登录。",
            "「刷新」查询 Credits，包含有效试用/奖励额度和小数，排除过期奖励。模型目录及权限来自授权账号对应的上游服务。",
          ],
        },
        poolTitle: "多个账号如何分别保存和使用",
        pool: [
          "按服务商真实身份、区域或 Profile 等字段区分账号，不按昵称或短期 Access Token 合并。",
          "统一账号存储锁定列表的读取、合并与写入，避免并发登录或刷新用旧快照覆盖新账号列表。",
          "宿主轮转可用账号。账号失败后，只能在响应尚未开始输出时尝试另一个可用账号。",
          "开始输出后出现错误会结束该响应，不把不同账号的文本和工具调用拼接起来。",
        ],
        existingTitle: "现有 Codex、Google Antigravity 和 Grok",
        existing:
          "现有插件也使用统一账号存储。身份和持久化回归测试覆盖了多账号保存，以及此前「只保留最后登录账号」的问题。各服务的授权和额度规则仍分别适用。",
        validationTitle: "真实账号验证仍待完成",
        validation:
          "协议测试与模拟上游响应覆盖账号身份、续期、流式输出、额度解析和并发；匿名端点检查与安装包构建也已通过。这些检查不等于所有实号都已完成授权、付费模型调用、续期或真实余额核对。",
      },
      faq: {
        title: "Cursor BYOK 常见问题：模型 API、多账号池、积分和配置",
        description:
          "解答 Cursor BYOK 是什么、与官方 BYOK 的关系、支持哪些账号插件、多个账号是否覆盖、如何查询积分，以及 Auto 选模、计费和验证范围。",
        heading: "接入之前，先把问题说清楚。",
        intro:
          "模型 API、账号插件和当前构建的实用说明。每个问题都有独立链接，便于分享与定位。",
        items: [
          [
            "what-is-cursor-byok",
            "Cursor BYOK 是什么？",
            "Cursor BYOK 是运行在本机的开源 Cursor 模型网关，将 Cursor 请求适配到你配置的模型 API 或账号插件，并提供桌面界面管理连接、模型调用和用量。",
          ],
          [
            "official-byok",
            "它和 Cursor 自带的 BYOK 设置一样吗？",
            "不一样。这是独立社区应用，在本机配置 Cursor 连接并管理自己的模型通道，并非 Cursor 官方产品，也不代表任何服务商背书。",
          ],
          [
            "supported-apis",
            "支持哪些模型 API？",
            "支持 OpenAI Responses、OpenAI Chat Completions 与 Anthropic Messages 兼容服务。填写服务商接受的地址、凭据和模型 ID；模型权限与工具能力以服务商和所选模型为准。",
          ],
          [
            "workbuddy-qoder",
            "可以在 Cursor 里使用 WorkBuddy 或 Qoder 账号吗？",
            "1.0.4 安装包构建包含 WorkBuddy、Qoder 国内/国际插件，实现授权、模型发现、账号池与积分查询。这些流程有自动化测试，真实账号授权、模型扣费和余额仍待实号验证。",
          ],
          [
            "multiple-accounts",
            "登录第二个账号会覆盖第一个吗？",
            "1.0.4 账号存储按不同身份保存，并串行处理账号列表更新。回归测试覆盖并发登录/刷新，以及多个 Codex、Google Antigravity、Grok 身份。对同一身份重新授权会更新该账号，不同身份分别保存。",
          ],
          [
            "credit-balances",
            "怎样查询积分余额？",
            "打开对应服务商的账号管理并点击「刷新」。WorkBuddy 查询积分和套餐，Qoder 查询额度分组，TeleAgent 查询积分，Kiro 查询 Credits。数值与到期时间来自上游，本站不展示任何账号实时余额。",
          ],
          [
            "teleagent-login",
            "TeleAgent 登录前需要做什么？",
            "先安装并启动一次官方 TeleAgent 客户端，确保原始设备和安装信息可用。插件使用独立官方登录窗口，也支持导入完整凭据。",
          ],
          [
            "kiro-regions",
            "Kiro 支持哪些区域和登录方式？",
            "美区 us-east-1 提供 AWS Builder ID 设备授权，美/欧区支持完整 OAuth 凭据或 API Key 导入。暂不包含欧区 Builder ID 与 Google/GitHub Social 浏览器授权。",
          ],
          [
            "model-not-visible",
            "为什么 Cursor 没出现或没使用我配置的模型？",
            "先启用模型并运行连接测试，保持 Cursor BYOK 运行。完全退出并重新打开 Cursor，再新建对话，手动选择配置的模型。Auto 使用 Cursor 官方模型。",
          ],
          [
            "free-models",
            "项目免费开源，模型也都免费吗？",
            "网关本身免费开源，不会提供服务商订阅或模型积分。仍需遵循服务商的模型权限、额度和计费规则；模型请求与对话内容发往你选择的服务商。",
          ],
          [
            "versions",
            "哪个下载版本包含新增账号插件？",
            "WorkBuddy、Qoder、TeleAgent 和 Kiro 需要 1.0.4 Actions 安装包构建。已发布的 1.0.3 Release 不包含这些新增插件。Actions 下载需要登录 GitHub，并有安装指南标明的过期时间。",
          ],
          [
            "upstream-and-support",
            "谁在维护，问题应该提交到哪里？",
            "bargino 维护这个基于 leookun/cursor-byok 的社区分支，保留原作者署名与贡献历史。本分支问题请在 bargino/cursor-byok 提交，附版本、脱敏错误和复现步骤。",
          ],
        ],
      },
    },
  },
};
