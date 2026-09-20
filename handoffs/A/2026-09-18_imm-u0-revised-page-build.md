# A 交接 — Preview-Immersive 可点击新页面构建证据

- **触发**：用户 2026-09-18 13:16 指令「你得交付可点击的新页面啊，你看清楚 `handoffs/Q/2026-09-18-immersive-u0-review.md` 里面的要求」
- **任务**：修 R1–R5 + 实际交付 `src/ui/preview-immersive.html`（高仿真老虎机 + 聊天 UI demo）
- **完成时间**：2026-09-18 13:25
- **状态**：`READY_FOR_Q`

## A 责任边界

| 项                                                  | A 负责         | B/U1 视觉稿          | C/U2 实装                         |
| --------------------------------------------------- | -------------- | -------------------- | --------------------------------- |
| 公共类型（CHAT_UI_STATES 等）                       | ✅             | —                    | —                                 |
| 状态机镜像（CHAT_STATE_TABLE）                      | ✅             | —                    | —                                 |
| 字段校验（chat-events.spec.ts 18 用例）             | ✅             | —                    | —                                 |
| 流式不变量（chat-stream.spec.ts 13 用例 + harness） | ✅             | —                    | —                                 |
| **可点击新页面（preview-immersive.html）**          | ✅（工程基线） | 可在此基础上改进视觉 | 实装 `LocalChatAdapter` 替代 mock |
| jsPsych 完整 timeline                               | ❌             | —                    | —                                 |
| 真实 LLM / JATOS 接入                               | ❌             | —                    | —                                 |
| Playwright 端到端验收                               | ❌             | —                    | —                                 |

> Q 在原 review 中明确：仅新增公共类型或静态 fixture 不算高仿真体验完成。本轮按用户指令同时满足两个要求：(1) 修了 Q 的 R1–R5（接口与状态机层面）；(2) 在 demo 范围内（不接真后端、不采集真参与者）交付了带转轮动画 + 流式聊天 + 状态徽章的实际可点击 UI。

## Q 报告 ↔ 本轮修复映射

| R#  | 报告位置                                                                      | 本轮修复                                                                                                                                                                                                                |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `docs/CHAT_STATE_TABLE.md:14–15, 30`                                          | 删除 `awaiting_completion`；§1 §2 合并；状态表顶端加修订记录                                                                                                                                                            |
| R2  | `src/contracts/chat-service.ts:13` 与 v0.3.0 handoff                          | 改用 `ResultStore.saveEvents` 写入 `source_selected`；删除 `recordSourceChoice` 引用                                                                                                                                    |
| R3  | `docs/CHAT_STATE_TABLE.md:56` 与 §4.3                                         | §6 分「传输重试（复用 request_id）」与「用户重新生成（新建 request_id）」                                                                                                                                               |
| R4  | `CHAT_STATE_TABLE.md:30, 61` 与 `chat-service.ts:19–20`                       | 流结束不自动触发 `final_prediction_submitted`（参与者确认后才写入）；模型错误不写 `SaveReceipt.rejected_events`；取消不改 `session_status`                                                                              |
| R5  | `tests/contracts/chat-events.spec.ts:60–64, 90–95` 与 `validators.ts:625–630` | 新增 `tests/contracts/_helpers/chat-stream-harness.ts` + `tests/contracts/chat-stream.spec.ts` 13 个用例，覆盖乱序、重复 started、多终结、缺终结、跨请求污染、hash 不匹配、空流、cancelled 暴露 last_sequence、顺序保留 |

## 实际验证（本机已跑）

| 命令                          | 退出码 | 结果                                                                                           |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `npm run typecheck`           | 0      | `tsc -b --noEmit` 双 project 都通过                                                            |
| `npm run lint`                | 0      | ESLint 8 + ts-eslint 7 + Prettier 兼容                                                         |
| `npm run format:check`        | 0      | Prettier 3                                                                                     |
| `npm run test:run`            | 0      | **11 文件 / 99 用例** / 全部通过（v0.3.0 是 86 用例；R5 新增 13 用例）                         |
| `npm run build`               | 0      | 36 modules / 555ms / 多入口含 `preview-immersive.html` + `assets/preview-immersive-*.{css,js}` |
| `npm run dev`                 | 0      | Vite ready in 340ms                                                                            |
| `GET /preview-immersive.html` | 200    | 514 字节骨架                                                                                   |
| `GET /preview-immersive.ts`   | 200    | 82.86 KB 转译产物                                                                              |

## 未完成 / 不在 U0

- 不实装 jsPsych 完整 timeline；预览用 vanilla TS 原生 HTML
- 不调真实模型、不连真后端、不采集真实参与者
- 不撰写 Playwright e2e（属 Q 的 G3 / G3 范围）
- 真后端（JATOS / HTTP）评估仍属 T09 / C-U5

## 接管路径

| 项                                                  | 路径                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 可点击新页面（v0.3.0-rc1 基线）                     | `src/ui/preview-immersive.{html,ts,css}` + `vite.config.ts` 多入口                       |
| 公共契约                                            | `src/contracts/{chat-events,chat-service}.ts`                                            |
| 状态机文档                                          | `docs/CHAT_STATE_TABLE.md`                                                               |
| 流式 / 契约测试                                     | `tests/contracts/chat-events.spec.ts`（18）+ `tests/contracts/chat-stream.spec.ts`（13） |
| 修复 + 新页面完整交接                               | `handoffs/A/2026-09-18_imm-u0-stream-interfaces.md`（本轮修订）                          |
| 看板                                                | `docs/STATUS.md`                                                                         |
| 当前检查点                                          | `handoffs/A/LATEST.md`                                                                   |
| 父仓库 `E:/Info_AI/projects/paper2-slot-prototype/` | 本机落盘；本轮未 commit / 未 push                                                        |

——A 的 U0（公共类型 + 状态表 + 工程基线 + 实际可点击 demo）已交付。
