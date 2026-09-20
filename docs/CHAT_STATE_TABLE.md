# Chat 流事件 ↔ UI 状态机状态表

> 适用版本：`contract_version = 0.3.0`（U0 增量，无 breaking）
> 计划冻结于：`0.4.0-rc`（当 B 的视觉稿与 C 的 LocalChatAdapter 都合入且通过端到端试测之后）
> 引言：本状态表是 A 在 `src/contracts/chat-events.ts` 与 `src/contracts/chat-service.ts` 中冻结的公共契约的状态机镜像，与 `docs/IMMERSIVE_UI_PLAN.md §4.2 §4.3` 配套。
> 维护：A 维护状态表与状态机；B 按状态表设计视觉稿与渲染；C 实现 `LocalChatAdapter` / `RealChatAdapter` 后用本表作为契约测试输入；Q 用同一状态表编写端到端验收。
> 修订记录：**v0.3.0-rc1**（2026-09-18），Q 复核 R1/R2/R3/R4/R5 后由 A 重写。下文 §1 §2 合并为一份权威转移表；§3 错误分类与方案一致；§4 取消协议独立；§5 不再把模型错误码塞进 `SaveReceipt.rejected_events`；§6 区分传输重试与用户重新生成。

## 1. 状态集合（`CHAT_UI_STATES`，v0.3.0-rc1）

> 注：v0.3.0 之前的草案中曾列出 `awaiting_completion` 作为独立态。现已取消——`completed` 收到即视为完成校验、渲染写入；任何「在 `completed` 之前的画面」都属于 `streaming` 的子态（"正在绘制最后一些分片"），并不单列。

| 状态             | 简称 | 含义                                                              | 进入条件                                                                                  | 退出                                                                                                                                                     |
| ---------------- | ---- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`           | I    | 没有正在进行的聊天；UI 显示「默认占位」                           | 试验进入「聊天前置 UI」前；任何终结态之后                                                 | 用户输入提交 → `awaiting_start`                                                                                                                          |
| `awaiting_start` | AS   | 请求已发送，等待首个 `started` 流事件                             | client 调 `ChatService.streamReply` 后                                                    | 收到 `started` → `streaming`；`failed` → `failed`；客户端/服务端取消 → `cancelled`                                                                       |
| `streaming`      | S    | 流正逐步产出 `text_delta`；UI 把累积文本置于「AI 消息气泡」       | 收到 `started`（包括 0 个分片的空流）                                                     | 收到终结事件 → 对应 `completed` / `cancelled` / `failed`                                                                                                 |
| `completed`      | C    | 正常结束；UI 锁定为只读；触发参与者确认入口（独立于 ChatService） | 收到 `completed` 且客户端完成 hash 校验                                                   | 用户点「确认」生成 `final_prediction_submitted` 并写到 `ResultStore.saveEvents`（按 §5 与 R4，由 B/U3 集成）；用户发起新提问 → `awaiting_start`          |
| `cancelled`      | X    | 用户/会话/abort 中止                                              | 收到 `cancelled`，或 abort 抢跑得到 `failed(code=CHAT_TIMEOUT)`，或参与者释放「停止」按钮 | 用户点「再发一次（同一请求恢复）」→ `awaiting_start` 且**复用同一 `request_id`**；用户点「重新生成」→ 新 `request_id` 进入 `awaiting_start`；放弃 → 终态 |
| `failed`         | F    | 上游错误；UI 显示错误块                                           | 收到 `failed`                                                                             | 若 `retryable=true` 点「重试」→ `retry_pending`；若 `retryable=false` 或超过上限 → 终态                                                                  |
| `retry_pending`  | R    | 重试已触发，等待新一轮 `started`                                  | 在 `cancelled`/`failed` 上选「重试」                                                      | 收到新一轮 `started` → `streaming`；新一轮 `failed` → `failed`（递归）                                                                                   |

> 关键不变量：
>
> - `streaming` 是**唯一**的"已收 started 但未收到终结事件"的状态；不另设中间态。
> - `completed`/`cancelled`/`failed` 是终态之一；不可直接回到 `streaming`（必须先经 `awaiting_start`）。
> - 在 `idle` 时收到任意事件 → 丢弃并记日志；不进入任何状态。

## 2. 流事件 → 状态机转移（合并 §1；单一权威表）

| 流事件                            | 当前状态                     | 新状态                                      | 副作用                                                                                                                                                                    |
| --------------------------------- | ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `started`                         | `awaiting_start`             | `streaming`                                 | 写入 `message_meta`；UI 显现「AI 正在输入」占位；`total_text_deltas=0`；本地累积串 = `""`                                                                                 |
| `text_delta`                      | `streaming`                  | `streaming`                                 | 按 `sequence` 顺序追加 `text`；按 R5 重算 `sha256(concat_delta.text)` 作为本地预览 hash；UI 追加气泡                                                                      |
| `text_delta`                      | 其他态                       | **丢弃**                                    | 不进入状态机；记日志                                                                                                                                                      |
| `completed`                       | `streaming`                  | `completed`                                 | 校验 `content_hash` 与本地累积的 sha256；若不一致则视为 `failed(code=CHAT_PROVIDER_DOWN)`；UI 锁定；触发参与者「确认」入口（**不**自动触发 `final_prediction_submitted`） |
| `cancelled`                       | `awaiting_start`/`streaming` | `cancelled`                                 | `last_sequence` 之内的 `text_delta` 标为"已渲染，保留"；UI 切回可输入                                                                                                     |
| `failed`                          | `awaiting_start`/`streaming` | `failed`                                    | 按 `code` 与 `retryable` 决定是否给「重试」入口                                                                                                                           |
| 任何事件                          | `idle`                       | **丢弃**                                    | 不进入状态机；记"ghosting"日志（**不**写入 `SaveReceipt`）                                                                                                                |
| 无终结事件 hang                   | `streaming` 超过协议规定窗口 | `failed(code=CHAT_TIMEOUT, retryable=true)` | 客户端按 §4 协议主动或被动超时                                                                                                                                            |
| 在 `completed` 之后再收到任意事件 | `completed`                  | **丢弃**                                    | 重复发送不通过；记日志                                                                                                                                                    |

## 3. 错误分类（`CHAT_STREAM_ERROR_CODES`）

| 错误码                | 含义                                        | 默认 `retryable` | UI 提示（B 终稿）                            | C 责任                                                                                       |
| --------------------- | ------------------------------------------- | ---------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CHAT_TIMEOUT`        | 上游在协议规定窗口内未响应（含 abort 抢跑） | `true`           | 「AI 没及时回应，是否重试？」                | 30 秒硬超时                                                                                  |
| `CHAT_RATE_LIMITED`   | 上游 token / 秒限制                         | `true`           | 「触发限流，10 秒后可重试」                  | 解读后端 429                                                                                 |
| `CHAT_PROVIDER_DOWN`  | 上游服务整体不可用                          | `true`           | 「AI 服务暂不可用」                          | health 探测                                                                                  |
| `CHAT_OUTPUT_BLOCKED` | 上游拒绝输出（moderation / safety）         | `false`          | 「本次回答未通过审查」（**不**提供重试入口） | 拒答审计                                                                                     |
| `CHAT_INVALID_INPUT`  | 输入校验失败（`chatRequestSchema` 失败）    | `false`          | 「你的输入格式有问题」（**不**提供重试入口） | 不上传；A 的 schema 应在 client 侧先拦                                                       |
| `CHAT_UNKNOWN`        | 兜底错误                                    | `true`           | 「AI 响应出现异常」                          | 落盘 `code=CHAT_UNKNOWN` 并附 `details`，**不**写入 `SaveReceipt.rejected_events`（R4 修订） |

> 关键修订（R4）：**所有错误都**只通过 ChatStreamEvent 自身表达——**不**写 `SaveReceipt.rejected_events`、**不**把 `session_status` 改成 `cancelled`。`SaveReceipt.rejected_events` 只在 `ResultStore.saveEvents` 拒绝写入参与者提交的 `final_prediction_submitted` / `source_selected` 等事件时使用，与聊天是**两条独立通路**。

## 4. 取消 / 恢复（`AbortSignal` 协议）

1. 用户点 UI 的「停止」按钮 → client 调 `AbortSignal.abort()` → 上游 `ChatService.streamReply` 通过实现语言原生机制终止迭代器。
2. 实现必须返回下列中的一种（**禁止沉默丢弃**）：
   - **首选**：终端 `cancelled` 事件，`last_sequence` = 已 yield 的最大 `text_delta.sequence`。
   - **兼容**：终端 `failed(code='CHAT_TIMEOUT', retryable=true)`，当取消与超时竞速时实现在超时路径上。
3. 在终端事件未到达前 `AbortSignal.abort()` 触发，UI 切到 `cancelled`；后续最终到达的终结事件被丢弃。
4. 客户端必须先在本地 save `cancelled.last_sequence`，再发起恢复。详见 §6 区分"传输重试"与"用户重新生成"。

## 5. 终态与持久层边界

> 关键修订（R4）：聊天服务**不**知道"参与者是否最终确定预测"。`completed` 之后：
>
> - 客户端保留显示，按方案 §4.3 / B 的视觉稿让参与者点「确认」，生成 `final_prediction_submitted` 事件；
> - 该事件由 `ResultStore.saveEvents` 写入；失败的事件进入 `SaveReceipt.rejected_events`，与聊天无关。
> - 写入成功后，参与者的 `final_prediction_submitted` 触发 `TrialService.getFeedback(...)`。
>   取消一次聊天回答**不**改 `session_status` 到 `cancelled`——当前契约中没有这个值（参见 `PERSISTENCE_SCOPES` / `SESSION_STATUSES` 的当前定义）。如果要扩展 `SESSION_STATUSES`，必须由 A 走增量接口变更，并在 0.4.0-rc 中释放。

## 6. 恢复与重新生成（**重写**：区分传输重试与用户重新生成）

| 触发                                               | request_id                                        | 行为                                                                                                                           |
| -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 传输层重试（断网后 SDK 自动重连、底层 fetch 重试） | **复用**同一 `request_id`                         | 在同一次逻辑请求内重试；客户端把累积前缀清零并通过 `last_sequence` 标记需要续传的位置；服务端可继续追加 `text_delta`，或者终结 |
| 用户在 `cancelled` 上点「再发一次」                | **复用**同一 `request_id`（仍是同一次逻辑请求）   | 等价于"传输重试"；实现可基于 §4 同步 API 给出 `last_sequence` 后补全                                                           |
| 用户在 `cancelled` / `completed` 上点「重新生成」  | **新建** `request_id`                             | **不**复用；清空累积；进入新的 `awaiting_start`                                                                                |
| 同一 `request_id` 出现 `started > 1` 次            | 视为 `failed(code=CHAT_UNKNOWN, retryable=false)` | 这是协议违规；记录但不重试                                                                                                     |

> 修订（R3）：上表打破旧版 CHAT_STATE_TABLE.md §6「强制新 request_id」一刀切。传输/恢复路径可以复用同一 `request_id` 继续同一个逻辑请求；只在新一次"用户主动想要不同回答"时才换 `request_id`。模型侧需要在 `request_id` 维度去重以避免重复生成（这是 C/U2 / C/U5 的责任）。

## 7. 错误码补充：请求复用校验

- 若客户端在传输重试时不小心发出新 `request_id`，服务端应当按 `INVALID_INPUT` 报告。新错误码（占位）可加入 0.4.0-rc 讨论列表。
- 若 `content_hash` 与客户端拼接文本 sha256 不一致，视为 `CHAT_PROVIDER_DOWN, retryable=false`（不可恢复）。

## 8. 版本与迁移边界

- `0.3.0` 加入 chat 接口但承诺不破坏；本表的 §1 §2 §6 是其权威转移规则。
- `0.4.0-rc` 计划在以下三条全部达成后再释放：(1) B 的视觉稿按 §1 §2；(2) C 的 `LocalChatAdapter` 通过 R5 加强版的契约测试；(3) Q 在端到端环境跑通。
- 任何在 `0.3.0` 与 `0.4.0-rc` 之间引入新错误码、新增终结状态、变更取消语义，必须提交 A 的接口变更请求。

——以上 A 的责任止于此。B 的视觉稿、C 的 adapter、Q 的 e2e 都按本表工作。

## 当前实现补充（2026-09-18）

本文件是早期 U0 状态设计。当前单题 UI 使用 ImmersiveRun 的阶段门控及 ChatPanel 的 active/interrupted/completed 控制，不宣称逐项实现全部预留状态。当前行为、保存先后和呈现记录以 ATELIER_IMPLEMENTATION.md 为准；正式 jsPsych 集成仍待完成。形状 schema 不验证跨事件顺序，实际页面使用 experiment/chat-stream-reader.ts。
