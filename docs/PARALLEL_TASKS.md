# 多 agent 并行实施任务书

状态：待派发。当前用户要求建立工作区与规划，不是立即启动代码实施。

## 1. 文件所有权

每一轮由协调 agent 指派实际执行者；A/B/C/D/Q 是角色，不是已经创建的任务或运行中 agent。

| 角色 | 职责 | 独占写入范围 | 开始条件 |
|---|---|---|---|
| A 协调与接口 | 工具链、公共类型、入口集成、计划 | 根工程配置/锁文件、README、AGENTS、docs、src/contracts、src/bootstrap.ts、tests/contracts、tests/fixtures、handoffs/A | 可开始 G0 |
| B 实验前端 | jsPsych 时间线、状态控制、界面、手机适配 | src/experiment、src/ui、tests/experiment、handoffs/B | G0 通过 |
| C 后端适配与保存 | LocalDemo、队列、真实后端评估及接入 | src/adapters、src/persistence、server、deploy、tests/adapters、handoffs/C | G0 通过 |
| D 材料与审计 | 模拟材料、领域评分、离线审计 | src/domain、config、materials、analysis、tests/domain、tests/materials、handoffs/D | G0 通过 |
| Q 独立验收 | 端到端与协议可替换检查 | tests/e2e、handoffs/Q、artifacts/qa | G2 可运行版本 |

例外：G0 时 A 可初始化 config/demo.json 和空目录；在移交给 D 后不并发修改。所有 owner 变更写入 STATUS。来源快照无写入 owner，始终只读。

## 2. 并发安排

```text
A：G0 冻结接口、虚拟 fixture、演示配置
                    ↓
       B 前端   C 适配器   D 材料/评分
                    ↓
A：G2 集成；模块 owner 修复各自缺陷
                    ↓
Q：G3 独立验收 → A 汇总状态
```

适用于最多四个同时运行槽位：A 加 B/C/D。Q 在后续波次执行，不额外占用第五槽位。若只有两个槽位，按 B、C、D 顺序缩减并行，不为了并发拆出相互等待的任务。

B 使用 A 的静态接口 fixture，避免等 D 材料才开始页面；C 使用相同 fixture 验证保存；D 独立生成完整模拟材料。G2 统一替换 fixture 为 D 的材料，不各自造一套字段。

## 3. 可直接派发的任务提示

### A：公共基础与集成

> 工作目录为 E:/Info_AI/projects/paper2-slot-prototype。先读 AGENTS、README、DECISIONS、CONTRACTS 和本任务书。先完成 G0：初始化最小 jsPsych/TypeScript/Vite 工程，锁依赖；将接口文档转为类型和校验；建立虚拟 fixture 及明确的 demo 配置，不将候选设置升级为研究决定。当前没有业务代码，不要声称已有脚本可用。接口检查通过后更新 STATUS，通知 B/C/D 同一版本。只修改 A 的路径。后续负责 bootstrap 集成和验收汇总。保留其他项目修改，不自动提交或推送全仓库。

### B：手机与电脑实验前端

> 先读工作区 AGENTS、DECISIONS、CONTRACTS，确认 G0 接口版本。仅负责 src/experiment、src/ui、tests/experiment、handoffs/B。使用注入的 SessionService/TrialService/ResultStore 完成说明、虚拟信息、练习、校准、独立预测、信心、来源选择、反馈与结束。任务为预测实际中奖者；来源选择时点读取 demo 配置。触摸与鼠标均可操作，信息量一致。不得调用 fetch/jatos SDK 或写未来答案，不能把本地保存显示为已上传。需要接口或依赖修改时写交接请求，不改共享文件。提供修改清单和实际验证证据。

### C：可替换后端与保存

> 先读工作区 AGENTS、CONTRACTS 和 G0 fixture。仅负责 src/adapters、src/persistence、server、deploy、tests/adapters、handoffs/C。首先实现 LocalDemo 和待发队列，正确区分 memory/browser_local/remote 保存。验证重复提交、部分成功、断网、刷新与完成确认。再评估 JATOS 或协调者指定的一个真实后端，输出经验证的能力矩阵；不擅自承诺服务端开奖、幂等或恢复。云文档令牌只在服务端。真实后端未选定或缺少凭证时仍完成本地部分与接入说明，不自行购买或把虚拟成功当成远程保存。不得修改前端实验逻辑。

### D：模拟材料与数据审计

> 先读工作区 AGENTS、DECISIONS、CONTRACTS 和 G0 demo 配置。仅负责 src/domain、config、materials、analysis、tests/domain、tests/materials、handoffs/D。实现固定种子、版本化的模拟开奖结果和建议生成；本地演示如采用每轮唯一中奖者，概率之和为 1，按实际中奖者评分。记录建议目标命中率、实际命中率、分母、生成方式及机器位置映射。人类正确率只能由作答估计。构造固定测试向量，检查 TS 评分与 Python 审计一致；禁止把模拟建议说成真实 AI 预测能力。不启动新的理论/机制设计，不根据小演示样本报告 α 结论。

### Q：独立验收

> 先读工作区 AGENTS、ACCEPTANCE、冻结接口和各模块 handoff。仅负责 tests/e2e、handoffs/Q、artifacts/qa，不修改被测业务代码。验证相同材料下不同适配器的原始字段及计分一致；检查手机/电脑、断网重试、刷新、重复点击、错误参与码、不能提前查看结果、完成确认和数据导出重算。模拟视口与真实设备检查分别报告；缺少真实设备或实际云后端时标记未验证。将缺陷按 owner 和文件归属交回 A，不代替 A 更改研究方案。

## 4. 交接与冲突规则

每个角色在 `handoffs/<角色>/` 写独立报告，按 TEMPLATE 填写。完成后向 A 发消息，A 更新 STATUS。B/C/D/Q 不同时抢写看板。

遇到需要其他模块配合的问题：写清契约版本、最小复现、预期行为和需要的变更；不通过复制另一个实现来绕开。共享类型/锁文件仅 A 修改。

若在独立 Git worktree 开发，使用 `codex/` 前缀分支；当前工作区是父仓库子目录，建 worktree 不等于仅复制子目录。是否采用 worktree 由 A 根据当轮环境决定，不对未提交研究文件做自动迁移。共享工作目录模式下严格遵守路径所有权即可。
