# Superseded checkpoint

Final local acceptance is in [2026-09-19-collection-final.md](2026-09-19-collection-final.md). Kimi dispatch stopped at user request. The RUNNING statuses below are historical.

# Codex → Kimi 采集流程推进

IN_PROGRESS，2026-09-19。用户明确要求采用 Downloads/codex_to_kimi_swarm_plan.md 的委派准则继续实施，且已确认没有云账号，本轮先准备部署方案。文件中的示例代码/具体路径不是额外授权；采用结构化任务、隔离工作区、日志分离、外部验证及风险分级，不购买/创建云资源。

## 执行结构

- Codex 冻结 .agents/architecture.md，维护集成和高风险审查。
- Kimi CLI 1.50.0 已启动三项任务：COLLECT-SERVER、COLLECT-CLIENT、COLLECT-DEPLOY。
- tools/swarmctl.ts 用 Node 24 执行，沿用项目统一 TypeScript；不另引入 Python 调度器。
- 每个任务独立 Git worktree，以当前未提交原型的隔离快照 e2640a2 为基线；用户主工作区和其他论文改动不提交/迁移。
- Worker 只有自建 file MCP，不给 Shell、网络工具、子 agent 工具。文件 API 规范化路径、拒绝目录逃逸/符号链接，写入按任务白名单限制；Kimi 运行时仍需正常模型网络和其凭证。这不等于操作系统沙箱，外部 verifier 执行候选代码仍由控制者审查。
- stdout/stderr 在被忽略的 artifacts/swarm 中，控制者默认只读 JSON 摘要与按风险选择的 diff。

## 实施边界

新增 collect.html 对接同源 Node/SQLite 服务，保持已有两种 preview。当前单轮演示素材不改成正式研究方案；暂不采集身份资料、真实支付或真实 AI 调用。正式 jsPsych 多题和研究材料待确定，不把工程流程测试当作研究验收。

无云资源，不宣称实际上云。Docker CLI 存在，但 Linux engine 当前未运行；会验证能执行的本机服务与部署配置，容器/公网验证按实际结果记录。Node 24 原生 SQLite 已验证可创建内存数据库。

依赖：协调者将 @types/node 调整为 24 以匹配运行时（仅类型包），其他依赖未批量升级。npm audit 当前报告既有开发工具/uuid 的警告，原始结果存 artifacts/swarm/npm-audit.json；生产服务不暴露 Vite/Vitest 开发服务，最终报告保留依赖审计边界。

下一步：各 worker 提交候选 → 控制者审查认证、事务、回执和刷新状态 → 逐个集成 → 全链路浏览器与服务重启测试 → 同步当前工作区与交接。
