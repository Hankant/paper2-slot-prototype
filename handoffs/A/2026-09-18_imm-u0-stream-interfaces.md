# A 交接 — IMM-U0：流接口候选与状态表（**v0.3.0-rc1 修订**）

- **角色 / 实际 agent 标识**：A / mavis (MiniMax Code on win32)
- **触发**：`docs/IMMERSIVE_UI_PLAN.md §6 U0` 「A 协调」可交付物（公共类型 + 流接口 candidate 与迁移说明）
- **完成时间**：
  - **v0.3.0 提交**：2026-09-18 凌晨（首批 CHAT_STREAM_EVENT_TYPES + 状态表 + 18 个字段校验）
  - **v0.3.0-rc1 修订**：2026-09-18 13:25（按 Q 报告 `handoffs/Q/2026-09-18-immersive-u0-review.md` R1–R5 修复，并交付可点击的新页面）
- **状态**：`READY_FOR_Q`
- **范围边界**：
  - v0.3.0：公共类型 / 运行时校验 / 状态表 / 迁移说明
  - v0.3.0-rc1：R1–R5 接口规则修订 + 流式消费者/验证器（13 测）+ 实际可点击的 `src/ui/preview-immersive.html`（高仿真老虎机 + 聊天 UI demo）
- **本轮新增 / 修改文件**：

### v0.3.0 首批（凌晨）

```
src/contracts/chat-events.ts                       # ChatStreamEvent 5 类联合 + CHAT_STREAM_ERROR_CODES + ChatMessageMeta
src/contracts/chat-service.ts                      # ChatRequest + ChatService 接口 + CHAT_SERVICE_COMPATIBILITY_NOTE
tests/fixtures/chat-fixtures.ts                    # SUCCESS / REJECTED / FULL_CHAT_STREAM / 5 个事件型固定样例
tests/contracts/chat-events.spec.ts                # 18 个字段校验
docs/CHAT_STATE_TABLE.md                           # 状态机 ↔ 流事件转移表 + 错误分类
docs/CONTRACTS.md / docs/STATUS.md / README.md / handoffs/A/LATEST.md 同步
```

### v0.3.0-rc1 修订（本轮）

```
docs/CHAT_STATE_TABLE.md                           # 完全重写：§1 §2 合并为权威转移表；§6 区分传输重试 / 用户重新生成；§3 §5 明确模型错误不写 SaveReceipt；v0.3.0-rc1 修订记录
src/contracts/chat-service.ts                      # 迁移说明改用 ResultStore.saveEvents；与 TrialService 当前签名一致
tests/contracts/_helpers/chat-stream-harness.ts    # 新文件：可执行流消费 / 验证器（含 sha256 重算与跨请求检测）
tests/contracts/chat-stream.spec.ts                # 新文件：13 个 R5 流不变量测试
src/ui/preview-immersive.ts                        # 新文件：状态机 + 聊天 mock + DOM 渲染 + AbortController
src/ui/preview-immersive.html                      # 新文件：单文件渲染骨架（与 vite 多入口配对）
src/ui/preview-immersive.css                       # 新文件：转轮式老虎机 + 柱状条 + 聊天气泡 + 状态徽章
vite.config.ts                                     # rollupOptions.input 增加 preview-immersive 入口
handoffs/A/2026-09-18_imm-u0-stream-interfaces.md   # 本文件（覆盖 v0.3.0 内容，含完整迁移说明与 R1-R5 修复记录）
handoffs/A/2026-09-18_imm-u0-revised-page-build.md  # 新增：可点击新页面构建证据
handoffs/A/LATEST.md                               # 检查点覆盖 v0.3.0 → v0.3.0-rc1 完整状态
docs/STATUS.md / README.md / docs/CONTRACTS.md      # 增量同步
```

## R1–R5 修复记录

### R1 — 完成状态转换双定义

- `CHAT_STATE_TABLE.md` §1 第 1 张表规定 `streaming → completed` 之间插入 `awaiting_completion`，但 §2 又规定「一次性进入 `completed`」。
- **修复**：取消 `awaiting_completion` 状态；§1 §2 合并为「`streaming` 是唯一已收 started 未收到终结事件的状态」；「`completed` 收到即视为完成校验与渲染」。
- 影响文档：`docs/CHAT_STATE_TABLE.md`（v0.3.0-rc1 修订记录已写入）

### R2 — 迁移说明引用已删除的写入接口

- Q 报告：`chat-service.ts:13` 与 `2026-09-18_imm-u0-stream-interfaces.md` 迁移说明引用 `TrialService.recordSourceChoice(...)`，但 `TrialService` 中该方法已删。
- **修复**：迁移说明改用 `ResultStore.saveEvents(session, [sourceSelectedEnvelope])`；调用顺序固定为
  1. `TrialService.loadTrial(...)` → `PublicTrial`
  2. `TrialService.loadAdvice(...)` → `RevealedAdviceBlock`（仅当 `advice_timing !== 'none'`）
  3. `ResultStore.saveEvents(session, [sourceSelectedEnvelope])` → `SaveReceipt`；只有这条写入成功后才允许 `ChatService.streamReply(...)`
  4. 流 `completed` 之后，**不**自动写 `final_prediction_submitted`；参与者点「确认」才触发，并由 `ResultStore.saveEvents` 写入
- 影响文档：`src/contracts/chat-service.ts`（顶部 doc comment）、`CHAT_STATE_TABLE.md §5`

### R3 — 重试规则改变同一次建议

- Q 报告：旧状态表强制「重试使用新 `request_id`」导致真实模型模式可能重新生成，方案要求恢复同一回答。
- **修复**：`CHAT_STATE_TABLE.md §6` 区分「传输重试」（**复用**同一 `request_id`，基于 `last_sequence` 续传）与「用户重新生成」（**新建** `request_id`）。同一 `request_id` 出现两次 `started` 视为 `CHAT_UNKNOWN, retryable=false`。

### R4 — 多个语义错关联

- Q 报告：
  - 「流结束触发 `final_prediction_submitted`」错
  - 「模型错误码写入 `SaveReceipt.rejected_events`」错（那是数据写入拒绝的字段，与模型错误无关）
  - 「取消一次回答 → `session_status='cancelled'`」错（当前契约中无此值）
- **修复**：
  - `CHAT_STATE_TABLE.md §5`：聊天结束只开「参与者确认」入口；`final_prediction_submitted` 仅由参与者触发，不由 `completed` 自动触发
  - 模型错误码**只**通过 ChatStreamEvent 自身表达，**绝不**写到 `SaveReceipt.rejected_events`
  - 取消**不**改 `session_status`；`SESSION_STATUSES` 仍只有 `opening/in_progress/awaiting_completion/completed/expired/errored` 5 个

### R5 — 测试未验流不变量

- Q 报告：逐条解析 fixture 字段，无法验证乱序、重复 started、缺失/重复终结、跨请求混入；hash 仅校验格式未重算。
- **修复**：
  - 新增 `tests/contracts/_helpers/chat-stream-harness.ts`：可执行流消费 / 验证器，解析每个事件走 `chatStreamEventSchema.safeParse`，累积 sha256 并比对 `content_hash`
  - 新增 `tests/contracts/chat-stream.spec.ts`：13 个用例覆盖：
    1. happy-path（hash 一致）
    2. 非单调 text_delta（0→1→0 退回）
    3. 重复 started
    4. text_delta 在 started 之前
    5. 多终结事件
    6. 缺终结事件
    7. 跨请求污染
    8. 内容 hash 不匹配（`CHAT_PROVIDER_DOWN`）
    9. 0 deltas empty flow
    10. cancelled terminal + last_sequence 暴露
    11. 不可解析事件（`CHAT_INVALID_INPUT` 路径）
    12. 事件顺序保留
    13. `delayedEvents` helper 0-delay 仍正常终止

## 可点击新页面交付（用户要求「得交付可点击的新页面啊」）

### 三页面入口

- `index.html` — 状态/合规页（G0 公共基础挂载）
- `preview.html` — 已有单题演示（旧版 3 卡片 + 文字块，本次未重写）
- **preview-immersive.html — 新增，高仿真老虎机 + 聊天 demo**

### preview-immersive 元素清单

| 元素                         | 位置                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SIMULATION 横幅              | 顶部，按 DEMO_BANNER_TEXT 与 demoCapabilitiesSatisfyProduction 标记                                                                |
| **Chat UI state 徽章**       | §1 状态机镜像：`idle/awaiting_start/streaming/completed/cancelled/failed/retry_pending`                                            |
| **机柜**：三台转轮           | `reel` 容器用 `@keyframes reel-spin` 循环旋转；`top/bottom cap` 高光                                                               |
| **柱状条**：历史命中率       | `reel-rate-fill` 显示历史 34% / 50% / 18%                                                                                          |
| **锁定独立预测**             | 每台机器下方按钮（`pick-btn`，状态用 `is-on` 反馈）                                                                                |
| **信心滑块**                 | 0–100，实时显示百分比（`confidence-value`）                                                                                        |
| **来源选择**                 | `human/ai/mixed` 三按钮；选 `ai/mixed` 自动 `revealAdvice`                                                                         |
| **揭示建议**                 | `advice-hidden` 状态显示「未揭示 (HiddenAdviceBlock) + 揭示建议」；揭示后 `advice-shown` 显示目标机器 + 位置                       |
| **聊天输入框 + 发送/停止**   | 输入文本 → sendChat → `streamReply` mock；停止按钮触发 `AbortController.abort()` 走 cancelled 路径                                 |
| **流式文字气泡**             | assistant 文本按 `text_delta.text` 增量追加；`streaming` 时尾巴加 `▍` 光标                                                         |
| **CHAT_UI_STATE 状态机驱动** | 收到 `started → 'streaming'`；`text_delta` 不切态但累积；`completed → 'completed'`；`cancelled → 'cancelled'`；`failed → 'failed'` |
| **事件原始数据**             | details 折叠面板，显示 `state.chat.events.map(...)`                                                                                |
| **最终预测按钮**             | 三选一，选中后调用 `computeFeedback` 计算 TrialFeedback                                                                            |
| **反馈列表**                 | 显示 `actual_winner_machine_id / independent_correct / final_correct / points_awarded / required_event_types`                      |
| **重置单题**                 | `resetTrial()` 重置 state 但保留 session                                                                                           |

### 数据流（按 §1/§2/§6）

1. **首次打开**：`uiState='idle'`；3 台机器独立预测未锁
2. **点击「锁定为独立预测」**：`state.independentPrediction = machine`
3. **调整信心滑块**：实时显示（不切 UI state）
4. **选择来源**（human/ai/mixed）：选 `ai/mixed` 自动 `revealAdvice`；advice 从 Hidden 变 RevealedAdviceBlock
5. **点击「揭示建议」**：手动路径，与上一步等价
6. **输入聊天文本** + **发送**：
   - 把 user_text 暂存；按 §1 `uiState='awaiting_start'`
   - mock ChatService 流式迭代器 yield `started → text_delta×N → completed`
   - 每 yield 一次调用 `render()` 局部更新；事件全部记入 `state.chat.events`
   - 流结束 `uiState='completed'`
7. **中间点「停止」**：`AbortController.abort()` → 流 yield `cancelled` 终结 + `last_sequence`
8. **点击「最终预测」**：`computeFeedback` → `state.feedback` 渲染
9. **点「重新体验」**：`resetTrial` 回到 `idle`

### 视觉与转轮动画

- `@keyframes reel-spin` 12 个标签以 1 行 cell / 3.6s 周期旋转，产生「卷轴」效果
- `top` 与 `bottom cap` 用渐变实现「焦点框」
- `reel-rate-fill` 用 `linear-gradient(90deg, #4ade80, #facc15)` 表示概率
- HUD 状态徽章用 `data-state` 属性在 CSS 中按状态切换颜色：`streaming=accent2, completed=ok, cancelled/failed=bad`

### 仿真完整性

- 所有数据走 `demoConfiguration` + `STUB_SESSION`（in-memory）；不向任何远端发送
- `sha256Hex` 用浏览器 `crypto.subtle.digest`；fallback 仅用于演示环境
- 横幅明确标 `SIMULATION ONLY`
- 真实模型 / 真后端 / 真参与者信息全部不连接

## 验证证据（本机已跑）

| 时间 (本地) | 命令                          | 结果                                                                                              |
| ----------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| 13:25       | `npm run typecheck`           | exit 0                                                                                            |
| 13:25       | `npm run test:run`            | exit 0 / **11 文件 / 99 用例 / 全绿**                                                             |
| 13:25       | `npm run build`               | exit 0 / 36 modules / 555ms / 含 `preview-immersive.html` + `assets/preview-immersive-*.{css,js}` |
| 13:25       | `npm run dev`                 | exit 0 / Vite ready in 340ms                                                                      |
| 13:25       | `GET /preview-immersive.html` | 200 / 514 字节                                                                                    |
| 13:25       | `GET /preview-immersive.ts`   | 200 / 82.86 KB 转译                                                                               |

## 未完成 / 明确不在 U0

- **B 的视觉稿**：B 仍可基于本预览出更精美版本的视觉稿；本预览作为 A 提供的工程基线。
- **C 的 LocalChatAdapter 实装**：C 在 `src/adapters/local-chat/LocalChatAdapter.ts` 落地真实 mock（参考 `preview-immersive.ts` 中的 `mockChatStream`）；不调外部 LLM。
- **真实后端 / JATOS / HTTP**：T09 仍是 PENDING；不在本轮。
- **Playwright 端到端**：Q 在 U4 写 e2e 覆盖完整 5 态 + `cancelled` + 错误码路径。
- **0.4.0-rc 释放**：B/C/Q 三件合入后由 A 统一释放。

## 接管路径

| 项                | 路径                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| 公共契约          | `src/contracts/{chat-events,chat-service}.ts` + `src/contracts/index.ts` barrel                          |
| 状态机文档        | `docs/CHAT_STATE_TABLE.md`（v0.3.0-rc1）                                                                 |
| 字段校验          | `tests/contracts/chat-events.spec.ts`                                                                    |
| 流式验证器 / 契约 | `tests/contracts/_helpers/chat-stream-harness.ts` + `tests/contracts/chat-stream.spec.ts`                |
| 可点击预览        | `src/ui/preview-immersive.{html,ts,css}`（vite 多入口）                                                  |
| 现有交接          | `handoffs/A/2026-09-18-codex-repair.md` + 本文件                                                         |
| 当前检查点        | `handoffs/A/LATEST.md`                                                                                   |
| 看板              | `docs/STATUS.md`                                                                                         |
| 代码取回          | `E:/Info_AI/projects/paper2-slot-prototype/`（本机落盘；本轮未 commit、未 push、未部署、未采集真实资料） |

——A 的责任止于此。
