# TeleAgent 账号插件

通过官方电信登录窗口获取新账号授权，再直接访问 TeleAgent 的模型和积分接口。
需要原始设备信息；不生成替代的设备 ID，也不读取官方客户端中已有账号的令牌。

## 使用

1. 安装并至少启动一次 TeleAgent 官方客户端，安装 Chrome 或 Edge。
   登录助手从官方客户端公开资源和 `app-auth/device-meta.json` 读取网关、版本和设备元数据。
2. 在“插件 → TeleAgent → 添加账号”打开独立登录窗口，在官方页面完成登录。
   该窗口使用新的临时浏览器资料，不复用正在使用的浏览器账号和 Cookie。
3. 每个账号重复一次添加，形成账号池。取消或关闭添加对话框会取消对应的登录任务。
4. 账号列表“刷新”查询积分余额；接口缺失余额时报告错误，不显示成零。
5. 可选择 `chat-pro`、`chat-flagship`、`chat-flash`、`chat-lite`、`chat-nano` 这五个上游产品档位，
   实际模型访问权限和扣费由 TeleAgent 账号决定。

没有可识别的官方客户端时，可以通过“更多 → 导入”导入完整凭据：

```json
{
  "token": "actual-account-jwt-with-optional-tenant-prefix",
  "api_key": "sk-actual-gateway-key",
  "device_id": "original-device-id",
  "install_id": "original-install-id",
  "app_version": "actual-client-version"
}
```

支持单个对象、数组、`{ "accounts": [] }` 或每个对象的 `auth` 字段。令牌必须包含真实的
账号 ID 和到期时间，并通过官方 `user_info` 身份核验。网关 Key 不发送到账号/积分接口。
导入的官方客户端会话不会自动刷新，以免旋转共享凭据；授权到期后重新登录或导入。
由独立登录窗口创建的会话可使用官方 token-refresh 接口续期。

同名账号不会合并。账号按官方账号 ID、设备 ID、安装 ID 区分，由宿主统一轮转、锁定和持久化。
已经开始输出的响应不会换账号拼接。

## 实现与来源

```text
server/
├── plugins/build-in/teleagent-auth/    # TeleAgent 账号、HMAC 签名、模型和积分
├── src/plugin/native_login.rs         # 宿主拥有的限时登录任务与取消控制
└── src/plugin/native/teleagent.mjs     # 公开客户端元数据与独立窗口的官方回调
```

登录助手只向父进程的私有管道返回本次登录结果，不启动配对服务器或写出凭据结果文件。
只有内置 TeleAgent 插件可以调用这个宿主能力。登录过期、取消或父进程退出后，助手关闭
本次窗口并清理临时资料；用户正在使用的浏览器不受影响。

协议参考：[codearts2api-panel / TELEAGENT.md](https://github.com/aiprofesserzhaofeng8-jpg/codearts2api-panel/blob/7a99d03e8324fde1d0d08bb44e8880eee7f75abf/docs/TELEAGENT.md)、
同一提交的 `backend/internal/teleagent/` 和 `scripts/teleagent-login.mjs`。
许可证与上游声明保存在本目录和宿主助手目录。
Logo 使用 [TeleAgent 官网原始 ICO](https://agent.teleai.com.cn/logo/new/favicon.ico)，没有重绘；
来源、下载日期与 SHA-256 在 `assets/source.json`。

## 验证边界

`teleagent_test.ts` 验证独立 HMAC 黄金值、设备字段、身份校验、会话刷新策略、完整 SSE
和积分。宿主助手测试覆盖 ASAR 有界读取、官方回调识别和取消；真实 Chrome 的隔离窗口
测试使用本地拦截的测试响应验证回调和无关页面处理。已检查官方登录页可达。
开发机未检测到 TeleAgent 官方客户端，尚未完成真实账号登录、续期、模型调用和积分查询。

```powershell
deno test --config server/plugins/build-in/teleagent-auth/deno.json server/plugins/build-in/teleagent-auth
deno test --allow-read --allow-write server/src/plugin/native/teleagent_test.ts
```

可选的真实浏览器测试（不会向官方服务器提交账号授权）：

```powershell
$env:CURSOR_BYOK_TEST_BROWSER = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
deno test --allow-read --allow-write --allow-env --allow-run --allow-net=127.0.0.1 server/src/plugin/native/teleagent_browser_test.ts
```
