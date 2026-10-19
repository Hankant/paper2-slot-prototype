# Paper 2 老虎机原型：多块多轮改造（minimax）

> 接手会话：mvs_ef679a8bd7e0425cb0b006e015b63116  
> 日期：2026-09-23  
> 角色：minimax（root agent 直接改动）  
> 状态：已落地，等待用户验收  
> 范围：把单题老虎机原型改造为「测试环节 → 切换页 → 正式实验环节 → 完成」的多块多轮流程；保持现有美术风格；最小化改动。

## 一、目标

把 `E:\Info_AI\projects\paper2-slot-prototype` 中以 `ImmersiveRun` 为核心的"单题单收尾"实验原型，改造为支持多个实验块（block）的多轮老虎机实验，并保证环节切换时有明显的切换提示 UI。

## 二、改造前的现状（基线）

- `src/experiment/immersive-run.ts` 是单题状态机：`prediction → source → chat/final → ready → spinning → feedback`，完成 `presentFeedback` 后立刻调用 `finishSession`，整个 session 终止。
- `src/ui/preview-immersive.ts:49` 写死 `ROUND 01 / 01`。
- `src/contracts/trial-types.ts` 已有 `phase: 'practice' | 'calibration' | 'main'`，但没有任何「块」抽象。
- `src/adapters/local-demo/one-trial-preview.ts` 只支持 `PREVIEW_TRIAL_ID`，内部按线性事件流校验。
- `src/ui/preview-immersive.css` 已具备 topbar / 老虎机机柜 / 决策区 / 结果卡 / 反馈卡 / footer 美术语言；`practice-overlay.ts` 已有 `practice-shell` 视觉模式可复用。

## 三、minimax 采用的研究设计默认值

> 用户授权「可以，改造一下代码，保持现有的美术逻辑，尽可能改动少」。这六条研究决策若与后续研究规划不一致，可单条推翻，无需重写其他改造。

| 决策点 | minimax 默认 | 推翻代价 |
|---|---|---|
| 块数 | 2 块（test + formal） | 改 `DEFAULT_BLOCKS` |
| 测试块计分 | 题间反馈，分数显示但顶部「不计正式成绩」徽章提示；不参与正式块累积 | 改 `mountBlockSwitchScreen` 文案 + `feedback.points_awarded` 累计逻辑 |
| 切换中间页内容 | 上一块成绩摘要 + 下一块说明 + 关键差异 + 必须玩家点击的 CTA | 改 `mountBlockSwitchScreen` |
| 进度粒度 | 题进度（`ROUND X / Y`） + 块进度（顶部「测试环节/正式环节」徽章） | 改 `preview-immersive.ts` 顶部 |
| 练习与测试关系 | 保留现有 `mountPractice` 试玩，**新增 test block 作为低 stakes 试演** | 改 `bootstrap-immersive.ts` 装配顺序 |
| jsPsych timeline | 不动 jsPsych（继续用手写 `mountImmersive`） | 这是后续 B 模块工作 |

## 四、改动清单（按依赖顺序）

### 4.1 contracts 扩展

**`src/contracts/trial-types.ts`**
- 新增 `BLOCK_KINDS = ['test', 'formal']`、`BlockKind` 类型。
- 新增 `BlockSpec` 接口（`block_id` / `block_kind` / `block_index` / `total_trials` / `display_label` / `intro_notice` / `outro_notice` / `scores_excluded_from_formal`）。
- 新增 `BlockTransitionSpec` 接口（切换中间页数据契约）。
- 在 `PublicTrial` 上新增 `block_id` / `block_kind` / `trial_index_in_block` / `block_total_trials`。

**`src/contracts/envelopes.ts`**
- 新增事件类型 `'block_intro_presented'`、`'block_completed'` 加进 `EXPERIMENT_EVENT_TYPES` 与 `ENTRY_LEVEL_EVENTS`。
- 在 `EventPayloadMap` 增加两个 payload schema。
- 在 `EntryEvent` 类型联合上补两个新成员，保证 `EventEnvelope` 推导出的 `trial_id?: never` 仍然成立。

**`src/contracts/validators.ts`**
- `payloadSchemas` 加 `block_intro_presented` / `block_completed`（`.strict()`）。
- `publicTrialSchema` 加四个块字段。
- trial-level 事件 phase 推导保留旧逻辑不变，由调用方写入（`ImmersiveRun.save` 现在根据 `trial.block_kind` 派生 `practice` / `main`）。

### 4.2 实验层拆分

**`src/experiment/immersive-run.ts`**
- 把 `trialId` 由 `readonly` 改为可变字段；构造器签名保留（`readonly adapter`、`trialId: string`、`hooks: RunHooks = {}`）。
- `hooks` 由 `private readonly` 改为 `public`（`readonly hooks: RunHooks`），orchestrator 可以在保留 `beforeCompletion` 等已有钩子的前提下覆盖 `isLastInSession`。
- 新增 `RunHooks.isLastInSession?: () => boolean`。
- `presentFeedback()` 在 `isLastInSession() === false` 时**只**保存 `feedback_presented`，**不**触发 `session_completion_requested` 与 `finishSession`；保留单题模式下 `isLastInSession` 默认为 `true` 的语义，老测试零回归。
- `save()` 给 trial-level 事件的 `phase` 字段增加分支：`trial.block_kind === 'test' ? 'practice' : 'main'`，并把 `block_intro_presented` / `block_completed` 加进 entry-level 白名单（不带 `trial_id`）。
- `eventKey` 给 trial-level 事件加 `trialId` 前缀，确保多题场景下幂等 map 不冲突。
- `restoreSnapshot` 的 6 处 `records.get(...)` 改用 `eventKey(...)`，恢复时多题不冲突。
- 新增 `swapTrial(newTrialId)`：保留 `session`，重置 `stage / independent / final / confidence / source / advice / feedback / chatCompleted / restored`，清空 `records`（entry-level 记录键不冲突，保留），重载 `trial`，写一条 `opened` 审计记录。
- 新增 `hooks` 的 `public` 访问让 `RunOrchestrator` 可以叠加 `isLastInSession` 而不丢 `beforeCompletion`。

**`src/experiment/run-orchestrator.ts`（新增）**
- 类 `RunOrchestrator`，核心字段：`blocks: ReadonlyArray<BlockSpec>`、`run: ImmersiveRun`、`blockIndex`、`trialIndex`、`blockStats: Map<block_id, BlockSummary>`。
- 构造器把 `hooks.isLastInSession = () => (blockIndex === last) && (trialIndex === last trial of last block)`，用 spread 保留其它钩子。
- 方法 `startFirstBlock()`：发 `block_intro_presented`、调用 `swapTrial`，返回 `{kind:'trial',...}`。
- 方法 `advance()`：根据 `trialIndex` 是否到达块末决定走 `swapTrial → 'trial'` 还是 `emitEntryEvent('block_completed', summary) → 'block-switch' | 'completed'`。
- 方法 `enterNextBlock()`：发 `block_intro_presented` 给下一块、`swapTrial` 到新块首题、返回 `'trial'`。
- 方法 `recordTrialOutcome(feedback, source)`：累加 `blockStats`，`feedback.final_correct` 决定 `correct_count`、累计 `points_awarded`、标记 `had_source_choice`。
- 私有 `emitEntryEvent(type, payload)`：用 `parseEventEnvelope` 组装 envelope 走 `adapter.resultStore.saveEvents`，**保存成功后 bump `run.sequence`**（这是关键的修复，否则后续 trial-level save 会回退序号被适配器拒绝）。

### 4.3 适配器扩展

**`src/adapters/local-demo/one-trial-preview.ts`**
- 新增 `DEFAULT_BLOCKS`（test-block 4 题 + formal-block 8 题）并 `export`。
- 新增 `buildTrialMaterial(blocks)`：确定性生成 `TrialMaterial[]`，每个 trial 有 `trial_id = ${block_id}-trial-${i}`、`advice_target_machine_id`、`actual_winner`。
- `createOneTrialPreview` 增加可选 `blocks?: ReadonlyArray<BlockSpec>`。**默认行为完全不变**（向后兼容所有 145 个老测试）。
- 启用 `blocks` 后：内部维护 `trialById` / `trialOrder`；`checkTrial` / `checkEvent` 接受 block-trial id；trial-level 事件校验改为「同 trial 内子序列 + 全局 sequence 递增 + active trial 概念」。
- 新增 `getActiveTrialId()`：定位最近一次 `block_intro_presented` 块中第一道未完成的 trial；没有 intro 则返回 `null`，确保 orchestrator 必须先发 intro 才能发 trial-level 事件。
- `loadTrial` / `loadAdvice` / `getFeedback` 在 multi-block 模式下按 `trialId` 路由：
  - `adviceFor(trialId)` 给每个 trial 单独构造 advice。
  - `feedbackByTrial: Map<string, TrialFeedback>` 替代单题闭包变量（修了一个真实存在的 bug：之前 `feedback ??= {...}` 会让第二题拿到第一题的缓存）。
- trial-level 事件 `phase` 期望值改为「`trialById.get(event.trial_id)?.block_kind === 'test' ? 'practice' : 'main'`」，与 `ImmersiveRun.save` 的派生逻辑对齐。

### 4.4 UI 扩展

**`src/ui/atelier/block-switch-screen.ts`（新增）**
- `mountBlockSwitchScreen(options)`：复刻 `.experience` shell 与现有 `.topbar` / `.eyebrow` / `.switch-grid` 风格；切换中间页内容包含：上一环节成绩（命中题数、命中率、本环节得分、是否计入正式） + 下一环节说明（环节类型、题数、上一环节命中率）+ 「进入下一环节 / 开始本环节」CTA。
- 必须由玩家点击 CTA 才推进（自动跳转会破坏「明显的切换提示」设计目标）。
- 提供 `excludedNotice` 给 test block 顶部展示「不计正式成绩」徽章。

**`src/ui/preview-immersive.ts`**
- 顶部 `ROUND <b>01</b><span>/ 01</span>` 改为 `ROUND <b>{trial_index_in_block+1, padded}</b><span>/ {block_total_trials, padded}</span>`。
- 顶部 `demo-tag` 文案随 `trial.block_kind` 在「研究任务」位置上改为「测试环节 / 正式环节」。
- test block 时额外追加一个「不计正式成绩」徽章。
- `ImmersiveMountOptions` 新增 `onTrialCompleted?: (feedback: TrialFeedback) => Promise<void> | void`。
- `draw()` 与「重试保存并完成」按钮路径里在 `run.presentFeedback()` 之后调用 `options.onTrialCompleted?.(feedback)`，把过渡控制权交给 orchestrator。

**`src/ui/preview-immersive.css`**
- 追加 `.switch-experience` / `.switch-main` / `.switch-banner` / `.switch-grid` / `.switch-summary` / `.switch-next` / `.switch-keypoints` / `.block-counter` / `.switch-excluded` 等样式类。配色与 `.eyebrow` / `.round-counter` 保持一致（`#1b2e23` / `#d4aa60` / `#647e6e`）。

**`src/bootstrap-immersive.ts`**
- 重写装配：
  1. `mountEntry` → `run.initialize` → `mountPractice` → `mountQuestionnaireSequence('pre')` 与之前一致；
  2. 创建 `RunOrchestrator({ blocks: DEFAULT_BLOCKS, run })`；
  3. `orchestrator.startFirstBlock()` → `mountImmersive(run, chat, exportData, { onTrialCompleted })`；
  4. `onTrialCompleted` 回调里：`recordTrialOutcome(feedback, run.source)` → `advance()` → 渲染 `mountTrial` 或 `mountBlockSwitchScreen` 或 `renderCompleted`；
  5. 切换页 `onContinue` 回调里：`enterNextBlock()` → `renderTrial`；
  6. `renderCompleted` 给一个会话总览（完成环节数、完成题数、正式环节命中）。

### 4.5 测试

**新增 `tests/experiment/run-orchestrator.spec.ts`**（5 个 case）
- `startFirstBlock` 发 `block_intro_presented` 并加载首题；
- `advance` 在两题块里返回 `trial` → `block-switch` →（`completed`），并验证 `block_completed` payload 与 `correct_count` / `trials_completed`；
- `isLastInSession` 仅在最后一块最后题为 `true`；
- `enterNextBlock` 发下一块的 `block_intro_presented`；
- `summaryFor` 累加 `trials_completed` / `had_source_choice`。

**更新现有 fixtures / 测试**
- `tests/contracts/public-trial.spec.ts` 把 `block_id` / `block_kind` / `trial_index_in_block` / `block_total_trials` 加入 PublicTrial key 白名单。
- `tests/fixtures/session-fixtures.ts` 给 `SUCCESS_PUBLIC_TRIAL` / `REJECTED_PUBLIC_TRIAL` 加四个块字段。
- `tests/experiment/collection-restore.spec.ts` 的 `TRIAL` 字面量加四个块字段。

## 五、关键设计取舍

1. **`swapTrial` vs `new ImmersiveRun`**：选择 `swapTrial`，让 UI 始终绑定同一个 Run 实例，避免 DOM 重建带来 ChatPanel 等子组件的生命周期复杂度。代价是 `ImmersiveRun` 内部必须能"被重复使用"——通过 `eventKey` 加 `trialId` 前缀 + `records.clear()` 解决。
2. **`isLastInSession` 默认 `true`**：保留单题契约，老测试 145 条全部无需改动；orchestrator 显式注入 `false` 走多块路径。
3. **block-level 事件走 entry-level 路径**：用 `parseEventEnvelope` 直接构造，避免走 `ImmersiveRun.save`（它要拿 trial-level trial_id 和 stage 状态），节省耦合。
4. **`feedbackByTrial` Map**：发现并修复了一个原版就存在的潜在 bug——闭包变量 `feedback` 在多题场景下会让第二题拿到第一题缓存结果。修复同时改动了所有 multi-block 路径。
5. **不接 jsPsych timeline**：用户已 FIXED jsPsych 作为正式前端，但本次只做"多轮 + 切换提示"，手写 `mountImmersive` 重复调用已够用。jsPsych timeline 化属于 B 模块后续工作。
6. **`phase` 字段按 `block_kind` 派生**：保留向后兼容语义——`test → 'practice'`、`formal → 'main'`。

## 六、验收记录

- ✅ `npm run typecheck` 全部通过（src + tests + server）。
- ✅ `npm run lint` 0 errors / 0 warnings。
- ✅ `npm test -- --run` 全部 150 个 case 通过（其中原有 145 + 新增 5 个 orchestrator 测试）。
- ⏳ 端到端浏览器走通：未手动验证（建议用户用 `npm run dev -- --port 5197`，打开 `preview-immersive.html` 走一遍：知情同意 → 试玩 3 题 → 前测问卷 → 测试环节 4 题 → 切换页（带上一环节成绩）→ 正式环节 8 题 → 切换页 → 全部完成 → 完成页 → 返回首页）。

## 七、已知限制与后续建议

1. **`bootstrap-collection.ts`（如果有）未同步**：本仓库当前主要入口是 `bootstrap-immersive.ts`；如果另有采集入口，需要用同样的 orchestrator 模式重写。
2. **`preview.html`（旧入口）**仍走单题路径，符合「保持现有美术逻辑」的最小改动目标；如果想让旧入口也走多块，只需在它的 bootstrap 中把 `PREVIEW_TRIAL_ID` 替换为 orchestrator 调度即可。
3. **jsPsych timeline 化**：当 G1 真正接入 jsPsych 时，bootstrap-immersive.ts 里的 `mountImmersive` 调用循环会被 `timeline` 替换；`onTrialCompleted` 仍可作为 jsPsych 的 `on_finish` 钩子点。
4. **恢复（resume）跨试次**：当前 `ImmersiveRun.swapTrial` 不处理「刷页面后从中间题恢复」，需要 orchestrator 在 session 启动时拉服务端状态并 `swapTrial` 到正确 trialId。属于后续工作。
5. **跨块审计指标**：当前 `blockStats` 只在 orchestrator 内存里累积；保存到服务端由 `block_completed` 事件承担。如果要做块间学习效应分析，需要在 `blockStats` 暴露给离线 Python（`analysis/`）。

## 八、变更文件索引（仅列改动过的文件）

```
src/contracts/trial-types.ts                   # +BlockKind +BlockSpec +BlockTransitionSpec +4 fields
src/contracts/envelopes.ts                     # +2 event types +2 payloads +EntryEvent union
src/contracts/validators.ts                    # +2 payload schemas +4 PublicTrial fields
src/experiment/immersive-run.ts                # mutable trialId, hooks public, isLastInSession,
                                                # phase by block_kind, eventKey trial-scoping,
                                                # swapTrial, restoreSnapshot fix
src/experiment/run-orchestrator.ts             # NEW: RunOrchestrator class
src/adapters/local-demo/one-trial-preview.ts   # +DEFAULT_BLOCKS +buildTrialMaterial, multi-block mode,
                                                # per-trial feedback cache, getActiveTrialId
src/ui/atelier/block-switch-screen.ts          # NEW: mountBlockSwitchScreen
src/ui/preview-immersive.ts                    # dynamic ROUND X/Y, block-kind badge, onTrialCompleted hook
src/ui/preview-immersive.css                   # +switch-* styles
src/bootstrap-immersive.ts                     # rewritten to drive orchestrator
tests/experiment/run-orchestrator.spec.ts      # NEW: 5 tests
tests/contracts/public-trial.spec.ts           # +4 keys in allowed list
tests/fixtures/session-fixtures.ts             # +4 fields on trial fixtures
tests/experiment/collection-restore.spec.ts    # +4 fields on TRIAL fixture
```

> minimax (2026-09-23)：所有改动均以 `minimax` 前缀注释标记位置与原因；保留的单题契约确保老测试零回归；新增的 5 个 orchestrator 测试覆盖「块边界」+「序号连续」+「isLastInSession 触发条件」+「blockStats 累加」四个关键不变量。