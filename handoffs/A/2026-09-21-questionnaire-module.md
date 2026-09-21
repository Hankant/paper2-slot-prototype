# 2026-09-21 前测/后测问卷模块交接

状态：**VERIFIED DEMO IMPLEMENTATION**。正式研究题项、T04 比较对象、T07 个人信息及量表验证仍为 TBD。

## 交付结果

- contract/client 升至 `0.4.0`，新增 `questionnaire_block_submitted` 会话事件及 Zod 校验。
- 问卷记录使用 `event_type:block_id` 复合键；多个前后测区块不会互相覆盖。
- 前测在主任务前逐区块保存；后测在 `feedback_presented` 后保存，全部收到回执后才请求完成会话。
- 同一配置同时接入 `preview-immersive.html` 与 `collect.html`。
- 题目、选项、区块顺序和问卷版本集中在 `src/domain/questionnaire-instrument-demo.ts`。后续文案修改不需要改 UI、控制器或存储代码。
- 当前演示包含披露前能力判断、理解检验、感知正确率、performance trust、依赖意愿、最低可接受正确率、过程题、体验题、AI 使用经验和怀疑探测。

## 主要文件

- `src/domain/questionnaire-instrument-demo.ts`：唯一题目配置入口。
- `src/domain/questionnaire.ts`：题型与启动时配置校验。
- `src/ui/questionnaire-overlay.ts` / `questionnaire.css`：桌面与手机全屏呈现。
- `src/experiment/immersive-run.ts`：复合键保存、恢复识别、后测完成门控。
- `src/adapters/local-demo/one-trial-preview.ts`：允许 consent 后前测、feedback 后后测的事件顺序。
- `src/bootstrap-immersive.ts` / `bootstrap-collection.ts`：两入口接线。
- `tests/helpers/questionnaire.ts`：浏览器测试统一填写器。

## 验证证据

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `npm run test:run`：19 个测试文件、143 项通过。
- `npm run test:e2e`：6 项通过，覆盖桌面/手机沉浸式流程和旧预览兼容。
- `npm exec -- playwright test --config playwright.collect.config.ts`：5 项 SQLite 收集测试通过。
- `npm run test:collection` 的 loopback 4 项通过；校园裸 HTTP 两项首次因测试未填写新增前测而超时，更新脚本后单独重跑 `--project=campus-http`，2 项通过。
- `npm run build:all`：客户端与服务器构建通过。
- `git diff --check`：通过，仅显示父仓库既有 LF/CRLF 提示。
- 在 `http://127.0.0.1:5197/preview-immersive.html` 目视检查前测：题干、未作答状态、滑块、必答标记、按钮和页面滚动均正常。

## 已知边界

- 当前是 `SELF_AI` 单轮演示；不能据此声称 Human–AI Asymmetric Trust 已被测量。
- 中文题项是预测试草案，不是已验证量表。
- 理解检验会阻止错误答案继续，但当前只保存最终通过答案；若正式研究需要首次答案和尝试次数，应启用逐次 `comprehension_answered` 事件并升级载荷。
- 随机题序以实际 `item_order` 保存；当前没有固定随机种子。
- 正式 jsPsych 多轮 timeline 仍未实施。
- 本轮未提交、未推送、未部署，也未采集真实参与者数据。
