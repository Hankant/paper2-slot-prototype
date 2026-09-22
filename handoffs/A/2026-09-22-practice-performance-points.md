# 2026-09-22 试玩、来源表现与积分奖励

状态：VERIFIED_LOCAL_PILOT。执行：Codex direct-only，未调用 Kimi 或其他 agent。

## 变更

- 协议升级至 0.5.0，新增 `practice_completed` 事件。
- 知情同意之后、前测之前加入三轮可操作试玩。
- 机器卡显示“近期开奖占比”；独立侧栏显示人类平均命中率和后台分配的 AI 命中率。
- 后台条件保存 `condition_id`、人类平均命中率、AI 命中率、AI 档位、每题积分和每积分现金兑换率。
- 试玩逐轮选择、赢家、正确性、反应时和积分写入 SQLite 事件流；JSON/CSV 导出包含条件、试玩积分、主任务积分、总积分与奖励计算字段。
- 主任务积分由后台 `pointsPerCorrect` 控制，不再在反馈中写死 10。
- 参与前文字不再主动披露建议为固定脚本，也不声称已实时调用外部模型；后测完成后呈现研究结束说明。

## 验证

- `npm run lint`：通过。
- `npm run test:run`：19 个文件、145 项通过。
- `npm run test:e2e`：6 项通过，覆盖 1280/390/360 视口和试玩流程。
- `npm run test:collection`：6 项通过，覆盖 SQLite、刷新恢复、重试和校园裸 HTTP。
- `npx playwright test --config playwright.collect.config.ts`：5 项服务器采集验收通过。
- `npm run build:all`：客户端与服务端构建通过。
- `git diff --check -- projects/paper2-slot-prototype`：通过。
- 视觉检查：`artifacts/qa/atelier/practice-1280.png` 与 `practice-390.png`，桌面和手机无关键裁切。
- 校园入口 `http://10.4.165.144:5200/collect.html` 与 `/api/health` 返回 200。
- 旧 0.4.0 会话使用只读兼容路径导出；当前数据库 JSON/CSV 导出成功，并完成 `VACUUM INTO` + `PRAGMA integrity_check` 备份。

## 当前参数与边界

- 本机默认：人类平均命中率 55%，AI 命中率 60%，档位 `plus_5pp`，预测正确 10 分。
- `rewardPerPointCny` 当前为 `null`。真实奖励公式已经接通，但具体兑换率属于尚未确认的报酬参数，不能向参与者承诺金额。
- 研究程序仍使用受控建议材料，尚未接入外部 LLM。参与期间不提前披露该实现；任务结束后提供说明。
