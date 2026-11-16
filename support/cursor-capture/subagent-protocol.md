# Cursor 子 agent 请求兼容性

## 已确认的证据

本次检查的本机 Cursor 版本为 **3.24.12**。BYOK 的本机日志多次记录：

```text
failed to prepare Cursor Run
protocol error: Cursor user message action has no message_id
```

错误来自 `server/src/cursor/compile/run.rs` 的业务校验。请求已经通过
protobuf 解码，尚未进入模型调用。重装应用不会消除这条校验。
这些失败请求没有保存完整的请求追踪载荷，因此无法从日志断定客户端
省略了字段，还是显式发送了空字符串，也无法断定哪个 Cursor 版本首次触发。

检查本机 `workbench.desktop.main.js` 的 `makeMessageType()` 定义后，
确认与本次问题有关的字段编号仍与仓库协议一致：

| 消息 | 字段 | 编号 | 用途 |
| --- | --- | --- | --- |
| `AgentRunRequest` | `action` | 2 | 启动动作 |
| `AgentRunRequest` | `conversation_id` | 5 | 子会话身份 |
| `AgentRunRequest` | `subagent_type_name` | 11 | 选择子 agent 提示与工具集 |
| `AgentRunRequest` | `conversation_group_id` | 16 | 根会话关联 |
| `AgentRunRequest` | `run_id` | 25 | 客户端运行标识 |
| `UserMessageAction` | `user_message` | 1 | 当前输入 |
| `UserMessageAction` | `prepend_user_messages` | 4 | 前置输入上下文 |
| `UserMessage` | `text` | 1 | 输入文本 |
| `UserMessage` | `message_id` | 2 | 客户端消息标识 |
| `UserMessage` | `mode` | 4 | Agent 模式 |
| `UserMessage` | `subagent_system_reminder` | 11 | 子 agent 提醒 |
| `SubagentArgs` | `parent_conversation_id` | 9 | 父会话 |
| `SubagentArgs` | `root_parent_conversation_id` | 16 | 根会话 |
| `SubagentSuccess` | `agent_id` / `final_message` | 1 / 2 | 返回子 agent 身份与结果 |

`message_id` 是 proto3 普通字符串，缺失时解码为 `""`，协议定义没有
`required` 约束。客户端的普通用户输入构造函数 `D1h` 使用
`messageId: n ?? i`；这个表达式也不会替换显式空字符串。
上述证据没有显示字段 2 被改名或移位。BYOK 对空 ID 的拒绝足以解释当前错误，
无需据此要求用户降级 Cursor，也不能据此给出一个经过实测的兼容版本列表。

## 执行路径与边界

```text
父 agent 模型输出 Task
  → server/src/cursor/tools/codec/request.rs       生成 SubagentArgs
  → Cursor 客户端                                创建或恢复子会话
  → BidiAppend 中的 AgentClientMessage.RunRequest protobuf 请求
  → server/src/api/cursor/bidi.rs                 解码、选择本地模型
  → server/src/cursor/conversation/runtime.rs     创建子会话运行
  → server/src/cursor/compile/run.rs              规范化 ID、构建 PreparedRun
  → server/src/run/                              持久化消息并调用模型
  → server/src/cursor/checkpoint/                 发布根消息和当前 turn 的 blobs
  → Cursor 客户端                                返回 SubagentResult
  → server/src/cursor/tools/tool_call_result/     父 agent 接收结果并继续
```

子 agent 使用独立的 `conversation_id`，`conversation_group_id` 只关联根会话。
`subagent_type_name` 存在时，编译器选用 `Mode::Subagent`，即使用户消息的
`mode` 为默认值 0，也会使用子 agent 提示和工具集。

## 本次修复

在 `AgentRunRequest` 的 `UserMessageAction` 编译入口，对空 `message_id`
生成 `byok-user:<SHA-256>`。摘要输入为：

1. 子会话 `conversation_id`；
2. 请求中已有历史的 `root_prompt_messages_json` 和 `turns` 的 blob ID 序列；
3. 原始 `UserMessage` 的 protobuf 内容。

这样，同一会话、同一历史、同一输入的重试拥有相同 ID，连接标识或
客户端 `run_id` 的变化不影响身份；不同子会话不会共用生成的 ID；相同
提示在下一轮拥有不同 ID。只取历史的有序引用，不编码会话中的无序 maps。
`UserMessage` 可达的目录树 map 使用生成器的 `BTreeMap` 设置，确保重解码后
相同目录元数据仍产生相同身份。

规范化后的 `UserMessage` 同时进入 runtime 编译与 checkpoint 发布。
既有的 `user_event_id` 继续区分运行时内容和请求上下文变化，并复用已存储
消息的时间戳。已有历史不被改写，已有客户端 ID 保持原样；缺少整个
`UserMessage` 的请求仍被拒绝。本次不改变工具协议编号或数据库结构。

## 验证与实机复测

`server/tests/subagent_protocol.rs` 使用合成的 protobuf 请求和 fake provider，
覆盖父 Task 派发、空 ID 子 agent 启动、结果回传、跨连接重试、重复提示新一轮、
在新数据库中导入 checkpoint、兄弟子 agent 隔离以及非法请求拒绝。
`run.rs` 的单元测试覆盖目录元数据重解码后的 ID 稳定性。

```sh
cargo test -p cursor-server --locked
cargo clippy -p cursor-server --lib --locked -- -D warnings
cargo fmt --all -- --check
```

本次验证结果：保留全部修改的 Linux 标准换行副本中，服务端 **261 项测试**
全部通过（含新增 6 项回归），Clippy 与格式检查通过。Windows 检出的提示模板
使用 CRLF，在 WSL 中直接执行原有模板换行断言会失败；标准换行副本恢复该断言，
无需修改提示模板或放宽测试。

2026-10-10 已完成 Windows 实机验证：用 `npm run tauri -- build --debug
--no-bundle` 构建并启动修复版，沿用本机模型与证书配置。健康检查返回 204，
Cursor 接管状态为 `enabled`，在独立临时工作区使用 Cursor **3.24.12** 与
`acode-3.0-flash`（Anthropic 接口）执行了以下测试：

| 场景 | 实际工具结果 | 验证结果 |
| --- | --- | --- |
| 父 agent 并行创建两个 `explore` 子 agent | 分别 Read `alpha.txt`、`beta.txt` | 两个子会话均完成，父 agent 正确汇总两个标记 |
| Task `resume` 并行复用两个子会话 | A 返回 `ALPHA_MARKER=alpha-7319`；B 返回 `BETA_MARKER=beta-8426` | 会话 ID 沿用，Read 与 Task 结果均正确 |
| 单独 Task `resume` 再次复用 A | 返回 `alpha.txt` 与 `ALPHA_MARKER=alpha-7319` | 子 agent 与父 agent 均正常完成 |

三轮共 **17 次模型调用全部 completed**，共三个会话（一个父会话、两个子会话）。
两个子会话中共存储五条不同的 `runtime:cursor:user:byok-user:*` 消息，
对应两次首次启动和三次继续请求。这确认真实请求在解码后缺少有效 ID，
实际走过本次规范化路径；仍不能区分原始 wire 字段被省略还是显式为空。
本次测试没有再触发 `Cursor user message action has no message_id`。

实测还发现一次父模型汇总错误：并行 `resume` 完成后，它把 A、B 的标记写反。
直接检查 BYOK 保存的 Task 参数、各子会话的 Read 结果和父会话中对应
`call_id` 的 Task 结果，关联均正确；Anthropic 序列化也保留相同的
`tool_use_id`。单独继续 A 后，正确标记再次返回。这些证据支持协议链路已通过，
但不能保证供应商内部转换或模型汇总始终准确；本次未保存原始供应商请求，
不能据此完全排除供应商内部的处理问题，也不应把父模型自己的错误归因当作抓包证据。

实测范围限于上述 Cursor 版本、供应商与只读任务，不构成全部模型或工具的
兼容性保证。后续复现应检查具体调用的参数、`call_id` 与结果，而非只看最终汇总。
