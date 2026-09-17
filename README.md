# Paper 2：老虎机实验原型

更新时间：2026-09-18。当前接口基线 **0.3.0**。工程基础已实现，并提供一题可点击模拟预览；完整 jsPsych 实验、持久保存与远程后台尚未实现。

## 直接体验

在此目录运行：

```powershell
npm run dev -- --port 5197
```

打开 [一题模拟预览](http://127.0.0.1:5197/preview.html)，或 [工程状态页](http://127.0.0.1:5197/)。只在运行服务的这台电脑可用，不是可分享的线上地址。

预览支持：选机器、调整信心、锁定独立预测、选自己/模拟 AI、揭示建议、确认最终答案、看反馈、下载 JSON、重新体验。固定模拟建议 B、开奖 C；A 的模拟历史命中率最高，但本轮预测 A 仍算错。没有真实个人资料、支付或上传。仅内存保存，刷新清空；下载的 JSON 包含原始事件和反馈。

该页面是接口与交互预览，使用普通 TypeScript/HTML；尚未接成 jsPsych 正式时间线。正式 B 任务仍采用 jsPsych。答案在演示浏览器代码中，只能体验流程，不能拿来招募或估计 α。

## 接手顺序

新增规划：[老虎机与 AI 聊天界面升级方案](docs/IMMERSIVE_UI_PLAN.md)。涵盖机柜/转轮、高仿真聊天、流式回答、DeepSeek 接口与分阶段验收；状态为 PROPOSED，尚未实施，现有 0.3.0 页面保持原样。

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

build 同时生成 index.html 与 preview.html，preview 命令可检查构建产物。代码规范覆盖 src、config、tests、根 TS 配置及后续 analysis/server 下的 TS；来源快照和历史交接不参与自动修复。

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
