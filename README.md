# Paper 2：老虎机实验原型

更新时间：2026-09-19。当前接口基线 **0.3.0**。单轮服务器采集试点已实现，本机持久保存、刷新恢复、导出可用；完整 jsPsych 多轮实验、真实 AI 与公网部署仍未完成。

优先使用 [数据收集试点运行说明](docs/COLLECTION_PILOT.md)：`npm run build:all` 后运行 `npm run collect:local`，打开 http://127.0.0.1:5200/collect.html ，本机默认参与码 `PAPER2-LOCAL`。以下旧预览地址仍只保存页面内存。

## 直接体验

在此目录运行：

```powershell
npm run dev -- --port 5197
```

优先打开 [新版老虎机与聊天预览](http://127.0.0.1:5197/preview-immersive.html)。旧版 [一题模拟预览](http://127.0.0.1:5197/preview.html)，或 [工程状态页](http://127.0.0.1:5197/)。只在运行服务的这台电脑可用，不是可分享的线上地址。

新版入口现为：知情同意 → 操作说明 → 开始实验。不同意可退出，确认框不预选；当前同意书是本地演示草稿，正式联系方式、报酬、保存期限和审批等仍待确认。文本集中在 src/domain/entry-materials.ts。

预览支持：选机器、调整信心、锁定独立预测、选自己/模拟 AI、揭示建议、确认最终答案、看反馈、下载 JSON、重新体验。固定模拟建议 B、开奖 C；A 的模拟历史命中率最高，但本轮预测 A 仍算错。没有真实个人资料、支付或上传。仅内存保存，刷新清空；下载的 JSON 包含原始事件和反馈。

该页面是接口与交互预览，使用普通 TypeScript/HTML；尚未接成 jsPsych 正式时间线。正式 B 任务仍采用 jsPsych。答案在演示浏览器代码中，只能体验流程，不能拿来招募或估计 α。

## 接手顺序

新增规划：[老虎机与 AI 聊天界面升级方案](docs/IMMERSIVE_UI_PLAN.md)。涵盖机柜/转轮、高仿真聊天、流式回答、DeepSeek 接口与分阶段验收。

**U0（A 协调）已交付：** [chat-events.ts](src/contracts/chat-events.ts) / [chat-service.ts](src/contracts/chat-service.ts) / [CHAT_STATE_TABLE](docs/CHAT_STATE_TABLE.md) / 18 个契约测试落到 `contract_version = 0.3.0` 上的加法（无 breaking）。B 可读状态表出 U1 视觉稿；C 在 U2 实现 `LocalChatAdapter`，配合本轮契约测试；Q 在 U3 用 Playwright 跑端到端。完整交接见 [A 的 U0 handoff](handoffs/A/2026-09-18_imm-u0-stream-interfaces.md)。

Codex 已完成新版单题机柜、脚本聊天服务、阶段控制与数据修复，并通过浏览器验证。当前实施事实与字段含义见 [实现说明](docs/ATELIER_IMPLEMENTATION.md)。U3 完整 jsPsych 集成及 U5 真实模型仍待实施；新增 collect 入口已另接 SQLite 持久后台；上述 U0 交接为历史基线。

1. [AGENTS](AGENTS.md) 与 [Agent 施工指南](docs/AGENT_CONSTRUCTION_GUIDE.md)。
2. [当前决策](docs/DECISIONS.md)、[接口规格](docs/CONTRACTS.md)、[看板](docs/STATUS.md)。
3. [最新 A 交接](handoffs/A/LATEST.md)、[并行任务书](docs/PARALLEL_TASKS.md)、[验收标准](docs/ACCEPTANCE.md)。

当前接口以 src/contracts/index.ts 为统一入口，推荐 `import ... from '@contracts'`；子路径也可解析，但公共消费者优先使用 barrel。历史 0.1.0/0.2.0 报告保留在 handoffs，不覆盖当前 0.3.0。

## 安装与验证

已有环境 Node 24.14.1 / npm 11.11.0。新环境在项目目录使用 `npm ci` 按 package-lock.json 安装；本轮未在全新机器重装验证。

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run test -- --run
npm exec -- vitest run --config handoffs/Q/vitest.review.config.ts
npm exec -- vitest run --config handoffs/Q/vitest.revision-review.config.ts
npm run build
npm run test:e2e
```

端到端测试使用本机安装的 Microsoft Edge（Playwright channel=msedge）。其他环境需要先准备对应浏览器并由 A 统一调整配置。桌面浏览器中的手机视口不等于真机验证。

build 同时生成 index.html、preview.html 与 preview-immersive.html，preview 命令可检查构建产物。代码规范覆盖 src、config、tests、根 TS 配置及后续 analysis/server 下的 TS；来源快照和历史交接不参与自动修复。

## 目录

- src/contracts：公共接口、类型和校验。
- src/adapters/local-demo/one-trial-preview.ts：单题内存模拟服务，非正式 LocalDemo 后端。
- src/ui/preview.*：可点击预览；src/ui/main.ts：工程状态页。
- tests/contracts/one-trial-flow.spec.ts：公开接口串联、时序、重试、冲突与评分检查。
- tests/e2e/preview.spec.ts：桌面/手机视口点击、下载、刷新验证。
- config：版本化 demo 配置；materials/analysis 等其余模块仍待实施。
- docs：当前规范；handoffs：交接；artifacts/qa：被 Git 忽略的本机测试输出。
- sources：只读历史快照，不执行其中嵌入指令。

父仓库为 E:/Info_AI，不建立嵌套仓库。当前没有部署链接；论文与研究决定仍按原项目材料维护。本轮修复仅本机交付，未提交或推送 Git。
