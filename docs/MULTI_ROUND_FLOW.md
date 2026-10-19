# 多轮任务与模块编排（0.6.0）

更新：2026-09-23。默认是工程演示配置：3 轮试玩 → 前测 → 8 轮正式任务 → 后测。不是已确认的研究轮数。

## 配置入口

采集入口现在优先使用 [实验者控制台](ADMIN_CONSOLE.md) 发布并存入 SQLite 的配置。下面的源码/环境变量只用于演示与首次初始化，不能覆盖已有的已发布配置。

`src/domain/experiment-plan.ts`：`createExperimentPlan(practiceRounds = 3, formalRounds = 8)` 控制默认轮数；`modules` 数组控制顺序。

把前测移到试玩前，只修改排列：

```ts
modules: [questionnaire('pre'), practice, formal, questionnaire('post')]
```

每个问卷模块的 `block_ids` 决定其中包含哪些区块及其顺序。可以把前测拆为两个模块，分别放在试玩前后；`module_id` 与问卷区块 ID 都必须唯一。题目内容仍在 `src/domain/questionnaire-instrument-demo.ts`，题目修改需更新问卷版本。`position` 是问卷题组的 pre/post 标签，实际呈现位置由 modules 决定。

试玩、正式任务模块均使用 `kind: 'trials'`，区别由 `block_kind` 标识（test/formal）。可增加多个任务区块；`block_id` 唯一，`block_index` 在任务区块间从 0 连续递增。每区块轮数为 1–500。知情同意和说明是固定入口；结束与数据确认自动发生在全部配置模块完成后。

采集部署可设置 `PRACTICE_ROUNDS`、`FORMAL_ROUNDS`，或者在本机私有设置 `private/collection/local-settings.json` 增加 `practiceRounds`、`formalRounds`。未设置时采用上述配置文件的默认值。修改源码需 `npm run build:all` 后重启；只修改私有轮数配置也需要重启。

每个新会话将完整流程保存到 `session.experiment_plan`。后来改变服务器默认轮数、顺序或表现条件，不会改变进行中会话。客户端遇到不同问卷版本会停下提示，而不会偷偷换题。

## 模块边界

- `src/contracts/experiment-plan.ts`：流程契约、参数校验和试次 ID。
- `src/experiment/run-orchestrator.ts`：从已确认事件推导进度；不依赖刷新就丢失的页面计数器。
- `src/experiment/immersive-run.ts`：单轮判断与作答状态；会话记录以 trial_id + event_type 区分。
- `src/ui/experiment-flow.ts`：预览与采集共用的模块渲染器。
- `src/ui/preview-immersive.ts`：试玩、正式任务复用同一机柜、拉杆、结果卡和助手对话组件；每轮退出时释放对话及监听器。
- `server/app.ts`：SQLite 持久化、逐轮访问权限、重放校验、服务端计分及导出。
- 旧 `practice-overlay.ts` 仅供旧单轮兼容路径；新流程不调用它。

## 数据记录与恢复

每轮记录独立预测、信心、来源选择、实际建议暴露（AI 分支）、最终预测及结果呈现，所有事件都有稳定 `trial_id` 与全会话连续 `sequence_no`。试玩的 phase=practice，正式任务的 phase=main。`block_intro_presented` 与 `block_completed` 记录区块、配置轮数及服务端复核的结果汇总。

问卷按 `block_id` 单独记录。切换轮次不会清空同意、问卷或前面各轮的记录；刷新会恢复当前轮已锁定的答案。丢回执时沿用原 event_id 重试。只有所有任务区块及配置问卷完成后，才能提交 `session_completion_requested` 和取得完成回执。

SQLite 新增 `trial_access`（每轮建议/反馈访问标记和反馈快照）及 `sessions.private_seed`（服务端私有随机种子）。参与者公共会话、试次与导出均不包含该种子或未来答案。重启时用原始种子与原会话配置重放，结果保持一致。

- JSON：`events` 完整原始事件；`feedbacks` 多轮结果；`trial_results` 将区块、轮次、来源、信心、两次预测、条件和结果对齐。标量 `feedback` 仅作为最后一轮兼容字段，分析勿使用它代替 feedbacks。
- 管理 CSV：一轮一行（尚未进入任务的会话保留空行），新增 trial_id、block_id、block_kind、trial_index_in_block、scores_excluded_from_formal、plan_version。`points_awarded` 是本轮分；`practice_points`、`total_points` 是会话累计，重复在各行，不能跨行再求和。
- 试玩不显示积分或金额，不计入正式奖励；正式分来自所有未排除区块之和。现金比例未设时保持 null，不虚构金额，也不执行支付。

## AI 表现与原型边界

后台固定分配 AI 展示档位。每个区块按 `round(轮数 × AI 命中率)` 安排建议正确次数，再用服务端私有种子打乱；实际正确数可能因有限轮数取整而与展示比例不同，例如 3 轮、60% 对应 2 次。导出保留展示比例及各轮结果，可单独计算实现比例。不能把展示值直接当实测值，也不能把该工程排程当正式随机化方案。

人类平均命中率仍是研究者提供的参考值；默认 55% 尚不是样本估计。参与者实际命中由逐轮记录计算，不能混为一列。真实 LLM 尚未接入。

0.5.0 会话保留原始数据并可管理导出，不强行迁移到多轮；浏览器会提示保留旧记录并另开新版体验。升级前应做 SQLite 一致性备份。新版可刷新恢复已确认步骤；问卷未提交的输入可在同一标签页刷新后恢复，详见控制台说明。手机尺寸与非安全 HTTP 浏览器测试不等于校园真机连通测试。

## 验证命令

```text
npm run test:run
npm run lint
npm run build:all
npm run test:e2e
npm run test:collection
npx playwright test --config playwright.collect.config.ts
```

新增回归检查：多轮不会覆盖记录；问卷可置于试玩前后；完成请求不能提前；服务重启和修改默认配置后仍恢复原始会话；按轮导出、计分及非 HTTPS 运行。
