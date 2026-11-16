# 分享 Cursor BYOK / Share Cursor BYOK

项目地址：[bargino/cursor-byok](https://github.com/bargino/cursor-byok)

一句话介绍：**把自己的模型 API 和账号接入 Cursor，在桌面管理多账号池、积分和调用用量。**

English: **An open-source desktop gateway for using your own model APIs and account pools in Cursor.**

## 可用素材

| 素材 | 用途 | 下载 |
| --- | --- | --- |
| 中文功能图 | 中文社区、文章封面、群分享 | [PNG](../../assets/banners/cursor-byok/geometric-zh-1280x640.png) · [可编辑 HTML](../../assets/banners/cursor-byok/geometric-zh-1280x640.html) |
| 英文主图 | GitHub 社交预览、英文介绍 | [PNG](../../assets/banners/cursor-byok/minimalist-en-1280x640.png) · [可编辑 HTML](../../assets/banners/cursor-byok/minimalist-en-1280x640.html) |
| 界面预览图 | 展示调用记录与用量界面 | [PNG](../../assets/banners/cursor-byok/product-en-1280x640.png) · [可编辑 HTML](../../assets/banners/cursor-byok/product-en-1280x640.html) |

三张图均为 **1280 × 640 PNG、低于 1 MB**，符合 [GitHub 社交预览推荐尺寸](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)。图标使用仓库现有应用图标；界面图来自原项目截图，数值为示例数据。HTML 使用本机系统字体和仓库内资源，没有外部字体、追踪脚本或第三方图片请求。

设置仓库链接的预览图：打开仓库 **Settings → Social preview → Edit → Upload an image**，选择英文主图。README 中的横幅和仓库社交预览是两个独立设置。

文案：[中文社区介绍](community-zh.md) · [中文 / 英文短文案](short-posts.md)。请以自己的真实使用体验补充内容，并按发布平台的规则调整。

## 事实与对应证据

| 可以介绍的内容 | 证据 / 边界 |
| --- | --- |
| 自定义 OpenAI / Anthropic 兼容 API、模型管理、连接测试 | [README](../../README-CN.md#模型配置) |
| WorkBuddy、Qoder 国内/国际、TeleAgent、Kiro 账号插件 | [1.0.4 说明](../releases/v1.0.4.md)；新功能在 1.0.4 安装包构建中，当前已发布 Release 为 1.0.3 |
| 多账号保存、可用账号轮转、积分查询接口 | 插件文档与账号存储回归测试；真实授权、续期、扣费和余额仍待实号验证 |
| Windows、macOS Intel/Apple Silicon、Linux 构建 | [下载表](../../README-CN.md#下载安装)；1.0.4 Actions 下载需要 GitHub 登录，预计 2026-12-16 过期 |
| 社区维护 fork | [原项目](https://github.com/leookun/cursor-byok)已归档，保留原作者、贡献历史和许可证；不把原作说成本 fork 独立原创 |

截图中的缓存率、Token 用量和美元估算值只用于展示界面。没有实测依据的“节省百分比”“无限额度”“全模型可用”“所有账号已验证”等表述不属于本项目宣传依据。

## 发布渠道与具体切入点

以下为 **2026-11-17 核对过的规则和候选渠道**，不是已经发布的记录。发布前再核对最新规则和自己的账号状态。

| 渠道 | 内容切入点 | 发布条件 |
| --- | --- | --- |
| [V2EX 分享创造](https://www.v2ex.com/go/create) | 社区 fork 维护、模型接入与多账号问题修复 | 节点欢迎作品展示；用自己的账号介绍实际维护内容，可参考中文文案 |
| 掘金 / 知乎技术文章 / 个人博客 | 一篇有安装步骤、版本差异和截图的完整实践记录 | 使用本人账号和真实使用体验，先核对具体平台与专栏规则，再发布 |
| X / 个人社交账号 | 一张图 + 解决的问题 + 仓库链接 | 使用本人账号；短文案见单独文件 |
| [r/cursor](https://www.reddit.com/r/cursor/) | Cursor 兼容问题、可复现技术经验 | [版规](https://www.reddit.com/r/cursor/about/rules.json)要求限制自我推广比例、提供上下文、避免重复帖，并禁止低投入 AI 内容；需本人有实质输入，不直接自动发模板 |
| [Show HN](https://news.ycombinator.com/showhn.html) | 能亲自试用的完整项目和技术经验 | [HN 规则](https://news.ycombinator.com/newsguidelines.html)禁止生成或 AI 编辑的文字和自动发帖，也不允许索求投票；由本人撰写，仅参考上面的事实表 |

GitHub 默认仓库搜索不显示 fork；[官方说明](https://docs.github.com/en/search-github/searching-on-github/searching-in-forks)介绍了 `fork:true` 查询。因此，介绍时附上准确仓库链接，比只写项目名更容易找到这个维护分支。

## 一次发布后的跟进

先在一个与项目相关的社区发布完整介绍，回复安装和使用问题，再根据真实反馈更新 README。其他渠道应使用对应受众需要的内容。可以邀请感兴趣的人关注或 Star 仓库，但不要索取 HN 投票、购买 Star 或重复铺设无关广告。

记录每个真实发布链接、日期和反馈，再对照 GitHub 的 Star、下载与访问变化。当前文件只提供素材和发布建议；发布后再添加可核实链接。
