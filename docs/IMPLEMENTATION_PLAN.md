# 结构与实施计划

当前实施补记（2026-09-18）：用户授权 G0 修复并增加单题交互预览；已建立 preview UI、内存模拟服务、契约流程与浏览器测试。它们是有限预览，后续 jsPsych 多题流程、可靠保存队列和真实后端仍按下列波次实施。当前状态以 STATUS 为准；下列“本轮不实施”是最初目录规划的范围说明。

## 1. 开发目录

```text
paper2-slot-prototype/
  README.md / AGENTS.md / .gitignore
  docs/
    DECISIONS.md
    IMPLEMENTATION_PLAN.md
    CONTRACTS.md
    PARALLEL_TASKS.md
    STATUS.md
    ACCEPTANCE.md
    AGENT_CONSTRUCTION_GUIDE.md
  src/
    domain/             # 无 UI、无网络的评分规则与事件处理
    contracts/          # 公共类型、方法和运行时校验
    experiment/         # jsPsych 时间线、控制器与自定义插件
    ui/                 # 页面、触屏样式、布局
    adapters/
      local-demo/       # 本地模拟，诚实报告保存范围
      jatos/            # 候选真实后端之一
      http/             # 通用 HTTP 候选，不要求首版实现
    persistence/        # 待发事件队列、重试状态
    bootstrap.ts        # 后续由协调 agent 创建，组装依赖
  config/               # 显式 demo 配置与正式配置模板
  materials/demo/       # 模拟材料及版本化清单
  analysis/             # TypeScript 材料生成、审计和导出整理
  tests/
    contracts/
    domain/
    experiment/
    adapters/
    materials/
    e2e/
  server/               # 若选定平台缺少必需能力，在这里补充
  deploy/               # 仅已选后端的部署模板
  sources/              # 历史只读快照和 MANIFEST.json
  handoffs/             # 分角色交接和 LATEST 检查点，协调者汇总
  artifacts/            # 运行输出，忽略提交
```

目录已实际建立；`.gitkeep` 只保留空目录。图中的业务文件是待实现目标，不意味着已经存在。正式 package.json、tsconfig、构建工具和 lockfile 由协调 agent 在 G0 建立。

## 2. 依赖方向

`experiment/ui → controller → contracts → adapters → backend`。

domain 不导入 jsPsych 或 SDK；contracts 不导入实现；适配器不导入页面；平台网络调用只存在于适配器。bootstrap 是选择后端的唯一入口。

实验服务（身份、分组、材料、反馈、评分）和结果存储分别抽象。更换云表格、数据库或 API 不改变分析字段；只提供写表能力的后端不能伪装成完整实验服务。

## 3. 实施波次

### G0：公共基础，协调 agent 先完成

- 确认没有覆盖现有修改，初始化最小 TypeScript/Vite/jsPsych 工程并锁版本。
- 按 AGENT_CONSTRUCTION_GUIDE 设置统一 TypeScript、npm、ESLint/Prettier、Vitest/Playwright 和标准验证命令；初始化检查点。依赖安装和脚本验证完成前不声称工具链可用。
- 将 CONTRACTS 草案转为公共类型、校验器和接口验收样例，冻结 `contract_version`。
- 显式选择一组仅用于演示的候选设置；把 T03 时点写入 demo 配置，不默认代表正式研究决定。
- 定义公共事件、试次阶段、稳定错误及统一保存回执；建立最小固定虚拟 fixture。
- 在 STATUS 中记录文件、版本和验收证据后释放并行工作。

### G1：三个 agent 并行

- B：jsPsych 页面与实验控制，使用已冻结接口及 fixture。
- C：LocalDemo、保存队列与第一个真实后端的能力评估。
- D：可复现的模拟材料生成、评分纯函数及数据审计。
- A：协调、解决接口请求和维护入口，不与 B/C/D 同时修改其文件。

C 的真实后端调查可以与本地开发并行，但不在部署决定缺失时购买服务或使用真实个人信息。

### G2：集成与一个真实后端

A 连接 B/C/D 产物，完成本地端到端演示。按实际能力选择一个后端：接入、保存与导出。JATOS 的额外实验服务若未支持，明确记录并决定补充方式，不降低正式要求以得到“跑通”结果。

### G3：独立验收

Q 在独立波次只改验收文件，执行手机/电脑流程、保存重试、结果重算和适配器替换检查。交接缺陷由各模块 owner 修复；Q 不越界修改业务代码。

### G4：正式研究准备（当前范围外）

只有研究参数、参与说明、支付与部署安排确定，并通过技术及测量验证后才能收集真实样本。能跑演示并不解除这些待定项。

## 4. 非目标

本轮不实施业务代码、不启动多个开发 agent、不安装后端、不自动修改 RP、不搬迁论文材料。后续首版不做支付网关、复杂研究者门户、真实 LLM 接口或多个生产后端。
