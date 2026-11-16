# Kiro 账号插件

直接接入 Kiro 原生模型接口，AWS EventStream 二进制响应在插件中校验 CRC 并解析，
文本、思考、工具调用和用量通过 Cursor BYOK 的统一事件协议交给 Cursor。

## 使用

1. 在“插件 → Kiro”启用插件。
2. `us-east-1` 账号池支持“使用 AWS Builder ID 登录”，在官方 AWS 页面完成设备授权。
3. `us-east-1`、`eu-central-1` 均支持导入有效的完整 OAuth 凭据或 `ksk_` API Key。
   Social 登录的现有凭据也可以导入；本插件没有提供 Google/GitHub Social 浏览器授权入口。
4. 多次添加或批量导入即可组成账号池，登录/导入后从上游查询模型目录。
5. 账号列表“刷新”查询 Credits；支持小数、有效试用额度和有效奖励额度，排除过期奖励。

**区域限制**：2026-11-16 匿名实测 AWS Builder ID 美国区能生成授权链接；欧洲区对
`https://view.awsapps.com/start` 返回 `400 invalid_request`。因此欧洲区仅提供凭据/API Key
导入，不展示已知无法完成的 Builder ID 浏览器登录入口。认证区域 `auth_region` 可以与
模型区域 `region` 分开指定，必须与真实凭据一致。

API Key 导入示例：

```json
{ "region": "us-east-1", "api_key": "ksk_your_actual_key" }
```

IAM/Builder ID 凭据示例：

```json
{
  "region": "eu-central-1",
  "auth_region": "eu-central-1",
  "auth_method": "idc",
  "access_token": "application-access-token",
  "refresh_token": "refresh-token",
  "expires_at": "2030-01-01T00:00:00Z",
  "client_id": "registered-client-id",
  "client_secret": "registered-client-secret",
  "client_secret_expires_at": "2030-02-01T00:00:00Z"
}
```

所有字段必须使用实际值。Social 凭据使用 `auth_method: "social"` 并提供真实 `profile_arn`。
身份 ID Token 不能代替模型接口需要的 Access Token。API Key 不伪造到期时间。
导入接受单个对象、数组或 `{ "accounts": [] }`。

账号按区域和 API Key、Profile ARN 或授权 Client ID 的摘要区分，不按昵称或短期 Access Token
合并账号。重新创建授权 Client 的登录会作为独立授权条目保存。宿主统一执行账号轮转、
资源锁、失败切换和凭据持久化。

## 实现与来源

- `api.ts`：凭据/区域校验、刷新、分页模型目录。
- `oauth.ts`：AWS OIDC Client 注册与设备授权。
- `eventstream.ts`：二进制分帧、CRC、工具参数、用量和上游错误。
- `provider.ts`：原生多轮消息和模型调用。
- `main.ts`：账号池、凭据导入和 Credits 展示。

协议参考：[codearts2api-panel / KIRO.md](https://github.com/aiprofesserzhaofeng8-jpg/codearts2api-panel/blob/7a99d03e8324fde1d0d08bb44e8880eee7f75abf/docs/KIRO.md)
及同一提交的 `backend/internal/kiro/`。许可证与上游声明保存在本目录。
Logo 原文件来自 [Kiro 官网](https://kiro.dev/icon.svg?fe599162bb293ea0)，来源和 SHA-256 在
`assets/source.json`。

## 验证边界

`kiro_test.ts` 验证 OIDC、区域路由、Access Token、CRC、分片、工具调用、历史一致性、
余额精度和过期奖励处理。已匿名验证美国区授权链接生成；尚未用真实账号完成授权、
调用付费模型、续期或查询实际 Credits。

```powershell
deno test --config server/plugins/build-in/kiro-auth/deno.json server/plugins/build-in/kiro-auth
```
