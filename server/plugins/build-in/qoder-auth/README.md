# Qoder 账号插件

通过 Cursor BYOK 的插件运行时直接访问 Qoder，不需要启动额外的转换服务。

## 使用

1. 在“插件 → Qoder”启用插件，选择“Qoder 国内账号”或“Qoder 国际账号”。
2. 点击添加账号，打开官方授权页面并完成登录。每增加一个账号重复一次。
3. 登录完成后同步上游模型目录，在账号管理中启用需要的模型，然后在 Cursor 选择。
4. 账号列表的“刷新”查询套餐积分、附加积分和共享积分。接口未返回的余额不会显示成零；
   无限共享额度也不会显示成虚构的数字余额。
5. “更多 → 导入/导出”操作当前区域的账号池。导入接受单个对象、数组或 `{ "accounts": [] }`。

国内、国际账号池隔离。账号按区域、官方 UID 和组织 ID 区分，重名不会覆盖其他账号。
令牌到期前使用对应的 device/job refresh 接口续期；`expires_in` 按上游毫秒单位处理。
账号池轮转、失败切换、资源锁和持久化由宿主统一管理，已经输出内容的调用不会拼接另一个账号的响应。

导入示例（所有凭据和到期时间必须来自实际授权，不能使用示例占位值）：

```json
{
  "scope": "cn",
  "uid": "official-user-id",
  "access_token": "access-token",
  "refresh_token": "refresh-token",
  "expires_at": "2030-01-01T00:00:00Z",
  "machine_id": "original-machine-id"
}
```

## 实现与来源

- `api.ts`：账号校验、用户资料、区域端点与令牌刷新。
- `oauth.ts`：官方 PKCE 设备授权；校验码只保存在宿主会话中。
- `sign.ts`：COSY 请求签名和上游报文编码。
- `provider.ts`：上游模型目录、原生聊天请求与 SSE 适配。
- `main.ts`：资源声明、凭据导入和积分展示。

协议参考：[codearts2api-panel / QODER.md](https://github.com/aiprofesserzhaofeng8-jpg/codearts2api-panel/blob/7a99d03e8324fde1d0d08bb44e8880eee7f75abf/docs/QODER.md)
及同一提交的 `backend/internal/qoder/`。许可证与上游声明保存在本目录。

Logo 原文件来自 [Qoder 官网](https://qoder.com/favIcon.svg)，下载日期和 SHA-256 在
`assets/source.json`，没有重绘。

## 验证边界

`qoder_test.ts` 使用模拟 HTTP/SSE 验证国内/国际登录、UID 校验、签名、刷新、模型过滤、
工具调用与积分。2026-11-16 已检查两区授权页和待授权轮询端点可达；尚未使用真实账号
完成授权、计费模型调用或查询实际积分。

```powershell
deno test --config server/plugins/build-in/qoder-auth/deno.json server/plugins/build-in/qoder-auth
```
