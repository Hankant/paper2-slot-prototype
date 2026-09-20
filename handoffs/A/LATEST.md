# A 当前交付：服务器采集试点

2026-09-19 / VERIFIED_LOCAL_PILOT。最新 [验收交接](2026-09-19-collection-final.md) 与 [运行说明](../../docs/COLLECTION_PILOT.md)。Kimi/多 agent 已按用户要求停止，后续由 Codex 直接推进。

## 历史交接

# A 当前交付：Codex 实验入口与单题机柜原型 atelier-2

**当前任务：入口同意与流程说明 / DONE（演示范围）**。见 [入口检查点](2026-09-18-entry-consent.md)。

**当前接手：Codex / DONE（单题原型范围，2026-09-18）**。用户授权核验底层并接手界面；新增进展见 [Codex 设计接手](2026-09-18-codex-design-takeover.md)。下文 MiniMax 状态保留为历史交接，不作为新版完成证明。

后续规划（2026-09-18）：用户要求高仿真老虎机、GPT/Claude 风格聊天、流式输出与未来 DeepSeek 接口；规划见 [UI 升级方案](../../docs/IMMERSIVE_UI_PLAN.md)。

**本轮**

- 日期：2026-09-18；任务 ID：G0-codex-repair-preview + IMM-U0-stream-interfaces + IMM-U0-revised-page-build；执行者：mavis (MiniMax Code, MiniMax M3)
- 状态：**U0 全部 A 部分 `READY_FOR_Q`**；B 视觉稿/C 接口实装/Q e2e 验收各自独立派发
- 关键提交：
  - `chat-events.ts` / `chat-service.ts` 公共类型（含 5-variant discriminated union + 6 个错误码）
  - `CHAT_STATE_TABLE.md` v0.3.0-rc1（修复 R1：消除 `awaiting_completion` 双定义；R3：重试分传输 vs 重新生成；R4：流结束 ≠ final_prediction_submitted；R5：错误码不写 `SaveReceipt.rejected_events`）
  - `chat-stream.spec.ts` + `chat-stream-harness.ts`（13 个流不变量用例：乱序、重复 started、跨请求污染、hash 重算、cancelled 暴露 last_sequence 等）
  - **`preview-immersive.{html,ts,css}`** 新增：高仿真老虎机（转轮动画 + 柱状条）+ 聊天 UI（输入/发送/停止/流式气泡）+ Chat UI state 徽章；状态机镜像 `CHAT_UI_STATES` 7 态

- 基线：父仓库 HEAD = `8c2cb3c`（A 本轮上一提交）；本机未提交增量。contract/schema/client/material = `0.3.0`，demo = `demo-0.3.0`，protocol = `unreleased`。
- 释放的路径：
  - 公共 contract：`src/contracts/{protocol-versions,errors,capabilities,envelopes,session-types,trial-types,persistence-types,interfaces,validators,chat-events,chat-service}.ts` + `src/contracts/index.ts`
  - 状态机文档：`docs/CHAT_STATE_TABLE.md`（v0.3.0-rc1）
  - 测试：`tests/contracts/chat-events.spec.ts` + `tests/contracts/chat-stream.spec.ts` + `tests/contracts/_helpers/chat-stream-harness.ts` + 既有 contract / fixture / config spec
  - 可点击 UI：`src/ui/preview-immersive.{html,ts,css}`（vite 多入口）
  - 文档：`docs/STATUS.md` / `README.md` / `docs/CONTRACTS.md` / `handoffs/A/LATEST.md`
  - 验收报告：`handoffs/A/2026-09-18-codex-repair.md` + `2026-09-18_imm-u0-stream-interfaces.md` + `2026-09-18_imm-u0-revised-page-build.md`
- 完整文件清单与迁移：[2026-09-18-codex-repair.md](2026-09-18-codex-repair.md)、[2026-09-18_imm-u0-stream-interfaces.md](2026-09-18_imm-u0-stream-interfaces.md)（含 R1–R5 修复记录）、[2026-09-18_imm-u0-revised-page-build.md](2026-09-18_imm-u0-revised-page-build.md)
- 验证：本轮（v0.3.0-rc1 后）**11 spec 文件 / 99 用例全绿**；typecheck / lint / format:check / build / dev / preview-immersive 三入口 HTTP 200 全绿；`tests/e2e/*` 保持 `tests/e2e/preview.spec.ts`（沿用）；未启动其他 agent；未推送。
- 已知未完成：
  - `LocalChatAdapter` 真实实现（C-U2）
  - jsPsych 完整 timeline（G1 B；preview 是工程基线，不是 G1 替代）
  - 持久保存队列 / 刷新恢复（G1 C）
  - 真机 / 真浏览器 / 真后台 / 真模型
  - T01–T09 研究参数（`docs/DECISIONS.md`）
  - `0.4.0-rc` 版本号提升（待 B/C/Q 三件合入后由 A 释放）
  - Playwright 端到端（Q-G3）
- 代码位置：`E:/Info_AI/projects/paper2-slot-prototype`；本机落盘；本轮未 commit、未 push、未部署、未采集真实资料。
- 活跃进程：本轮已停止 dev 服务，无遗留进程。
- 下一步：
  1. Q 重跑 `tests/contracts/chat-events.spec.ts` + `tests/contracts/chat-stream.spec.ts` + 浏览器 `GET /preview-immersive.html` 后的端到端 Playwright
  2. B 的视觉稿可基于本预览出更精美版本（preview-immersive 是 A 提供的工程基线）
  3. C 的流适配器在 `src/adapters/local-chat/LocalChatAdapter.ts` 实装 `ChatService`，用本轮契约测试做接口回归
  4. A 协调：B/C/Q 三件达成后释放 `0.4.0-rc` 与对应迁移说明
- owner 状态：本轮收尾后释放临时写入占用，后续接手前登记实际 owner。
- 恢复检查：先核对源码与上述版本，使用项目检查命令；Q 旧报告是历史状态。
