# Cursor BYOK GEO：公开文档与验证

本次工作的目标是让项目拥有可抓取、可核对、可引用的公开说明，并把阅读者引到适合的安装版本。内容面向真实用户，围绕模型接入、账号池和积分查询展开。

文档站：[English](https://bargino.github.io/cursor-byok/) · [简体中文](https://bargino.github.io/cursor-byok/zh/)

## 公开内容

| 页面 | 用户需要解决的问题 | 英文 / 中文 |
| --- | --- | --- |
| 项目介绍 | Cursor BYOK 是什么，如何连接已有模型服务 | [English](https://bargino.github.io/cursor-byok/) · [中文](https://bargino.github.io/cursor-byok/zh/) |
| 安装指南 | 下载哪个版本，如何配置 API / 账号，为什么需要重启 Cursor | [English](https://bargino.github.io/cursor-byok/guide/) · [中文](https://bargino.github.io/cursor-byok/zh/guide/) |
| 账号插件 | WorkBuddy、Qoder、TeleAgent、Kiro 的区域、登录条件、账号池和积分 | [English](https://bargino.github.io/cursor-byok/accounts/) · [中文](https://bargino.github.io/cursor-byok/zh/accounts/) |
| 常见问题 | 12 个真实使用问题，每个答案有可分享锚点 | [English](https://bargino.github.io/cursor-byok/faq/) · [中文](https://bargino.github.io/cursor-byok/zh/faq/) |

每页正文直接出现在 HTML 响应里，不依赖客户端 JavaScript 渲染。页面具有独立标题和摘要、自指 canonical、互相对应的 hreflang，以及与可见内容一致的 SoftwareApplication / SoftwareSourceCode / WebPage 等 JSON-LD。

站点保留原项目与维护分支的身份区别、安装包版本差异、官方服务计费条件和实号验证范围。没有虚构评分、使用人数、性能结果或第三方推荐。

## 文件与维护责任

```text
site/
├── project.json  # 版本、平台下载链接、项目身份和资料核对日期
├── content.mjs   # 中英文可见内容，含每种语言的 12 个 FAQ
├── build.mjs     # 生成静态 HTML、元数据、Sitemap 和项目资料文件
├── publish.mjs   # 预览或发布静态成品到 gh-pages，隔离 Git 暂存区
├── styles.css    # 响应式样式与键盘焦点状态
├── check.py      # 内链、元数据、结构化数据与在线抓取检查
└── dist/         # 被 Git 忽略的部署产物
.github/workflows/site.yml  # GitHub Actions 可用时执行构建与验证
support/geo/
├── README.md          # 实施说明、验证方法和维护边界
└── query-checks.csv   # 需要实际复查的搜索问题与判断标准
```

发布新版本时，更新 `project.json` 的已发布版本、构建版本、下载链接和有效期，并核对 `content.mjs` 中的版本说明。生成器会检查构建版本是否与桌面应用版本一致。核对过正文后再更新 `reviewedAt`，不通过每次构建刷新日期制造内容更新。

站点使用 GitHub Pages 的分支发布：`gh-pages` 根目录包含静态成品，`.nojekyll` 关闭 Jekyll 处理。构建不安装额外 npm 包。

本次 GitHub Actions 的仓库开关返回 `enabled: true`，但工作流触发返回 HTTP 422 `Actions has been disabled for this repository.`。该状态未在本次任务中解除；[GitHub 官方说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)要求联系 Support 审核。现有站点通过标准静态分支发布上线，未依赖该工作流执行。

## 技术验证

在仓库根目录运行：

```sh
node site/build.mjs
python site/check.py
python site/check.py --live
```

更新并提交源码到 main 后，先查看成品差异，再发布：

```sh
node site/publish.mjs
node site/publish.mjs --push
python site/check.py --live
```

发布脚本重新构建和检查，只提交生成的静态文件。它使用独立临时 Git index，不切换工作分支或覆盖现有暂存区；推送不使用 force。成品未变化时跳过重复发布。站点版本的提交信息记录对应 main 源码 SHA。

本地检查覆盖 8 个页面、24 个可见 FAQ 答案、页面语言、内链锚点、独立摘要、JSON-LD、canonical、hreflang 和真实 404 页面配置。在线模式另外验证部署 URL、资产、HTTP 404 和域名根目录的 robots 规则。

浏览器检查已在 375、768、1024、1440 四种宽度下覆盖 8 页，共 32 种组合，未发现横向溢出；另目视检查了桌面、平板和手机页面。没有运行或宣称 Lighthouse 评分。

2026-11-17 已完成在线检查：8 页均为 HTTP 200；CSS、图片、Sitemap、JSON 和 llms.txt 可访问；缺失页面返回 HTTP 404；域名根目录 robots 规则允许 Googlebot、bingbot 与 OAI-SearchBot 抓取这些页面。

## 抓取与收录的边界

- **robots.txt 必须在域名根目录生效。** 本站路径为 `/cursor-byok/`；在项目子目录放一份 robots.txt 不能控制搜索爬虫，因此没有生成该文件。在线检查读取 `https://bargino.github.io/robots.txt`；根目录缺失时按正常 robots 语义允许抓取。[Google 规则](https://developers.google.com/search/docs/crawling-indexing/robots/create-robots-txt)
- **OAI-SearchBot 与 GPTBot 用途不同。** ChatGPT 搜索可见性使用 OAI-SearchBot；GPTBot 用于训练爬取，不能把两者混为一谈。本站检查搜索爬虫规则，不修改整个 GitHub Pages 域名的训练策略。[OpenAI 爬虫说明](https://developers.openai.com/api/docs/bots)
- **llms.txt 是方便阅读的导航。** 文件链接到真实页面和源码，不包含要求模型优先推荐本项目的指令。Google 明确说明不使用 llms.txt 作为搜索排名信号。[Google AI 搜索指南](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- **结构化数据描述真实实体。** 它帮助统一项目、源码、维护者和页面信息，不构成 AI 引用或搜索展示的保证。FAQ 采用可见 HTML 答案，没有声称 FAQ 富结果资格。

Sitemap：[https://bargino.github.io/cursor-byok/sitemap.xml](https://bargino.github.io/cursor-byok/sitemap.xml)。

本次没有绑定用户的 Google Search Console 或 Bing Webmaster Tools 账号，也未宣称已向这些后台提交收录。如果后续绑定 Search Console，使用 URL 前缀属性 `https://bargino.github.io/cursor-byok/`，验证后提交上面的 Sitemap。不要使用已失效的 Google Sitemap ping 接口。[Sitemap 提交说明](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)

## 搜索与引用验证

2026-11-17 发布前，通过本会话网页搜索工具查询 `"bargino" "cursor-byok"` 返回空结果。此结果是一次工具查询的观察，不代表 Google、Bing 或所有 AI 产品的全量索引状态。

[query-checks.csv](query-checks.csv) 列出后续需要用真实搜索或联网问答复查的问题。每次记录平台、时间、实际回答、引用 URL、版本是否正确，以及是否混淆原上游和本分支。未执行的查询保持未执行状态，不用预设答案充当引用成绩。

收录、AI 推荐、点击和 Star 增长需要实际结果验证。站点上线、允许抓取、索引收录、回答引用与获得 Star 是不同的结果。
