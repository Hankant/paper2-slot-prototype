# Swarm 候选集成与验证修复交接

2026-09-19 晚，Kimi（本会话）完成，未经过 Codex。

## 已完成

1. **三轮 swarm 候选已全部集成**到 `codex/paper2-collection-20260919`（worktree：`E:/Info_AI_workers/paper2-20260919-base`）：COLLECT-SERVER(+RETRY)、COLLECT-CLIENT(+RETRY)、COLLECT-DEPLOY(+FIX)，cherry-pick 无冲突，集成提交 `a2126fd`。
2. **验证修复**（worker 产出从未跑通过测试，因 GBK 崩溃中断在检查前）：
   - `node:sqlite`：Node 24 仍将其标记为 experimental，`module.builtinModules` 不含 `sqlite`，Vite 5/vitest 1.6 转换期无法解析 → `server/app.ts` 改用 `createRequire(import.meta.url)('node:sqlite')` 绕过 Vite 解析器。
   - 测试 Client 在构造时快照 baseUrl，重启后打到旧端口（ECONNRESET/ECONNREFUSED）→ 改为请求时取当前端口 + `connection: close`。
   - `SameIdRetryQueue.load()` 只接受 object body，重载后丢弃原始值 → 改为只要求 body 存在。
   - 审计记录 id 原为随机 UUID，跨刷新无法去重 → 改为会话内稳定序数 id；`restoreAudit` 期望相应调整（本运行的 'opened' 与投递批次去重）。
   - 测试桩保真度：`completed` 跟随 finish 回执而非调用次数；中断保存模拟同时移除服务端持久记录。
   - `SessionMetadata` seed 补全三个必填字段；`server/**` 纳入 tsconfig include，删除 triple-slash reference（lint error）。
3. **质量门**：127/127 单测通过，tsc 无错误，ESLint 0 error（4 个既有 non-null warning），vite build 通过。未跑 Playwright e2e。

## swarmctl.ts 修复（主工作区，未提交，与项目"本机交付不提交"状态一致）

`E:/Info_AI/projects/paper2-slot-prototype/tools/swarmctl.ts`：

- 启动 `kimi.exe` 与 verifier 时注入 `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`（修 GBK 崩溃，该 bug 曾废掉 COLLECT-CLIENT-RETRY 整轮产出）。
- 新增**自动修复环**：verifier 失败或 CLI 崩溃时，用 `-r <sessionId>` 在同一 worktree 续跑同一 session，把失败日志尾部喂回 worker，最多 `budget.max_retries` 次，不再每次失败都惊动控制者。
- `candidate_success` 现在要求全部 verifier 通过（此前 exit 0 即成功，SERVER-RETRY 曾带红灯标记成功）。
- 尽力从 stream-json 采集 token 用量到 `token_usage` 字段（原来硬编码 null）。
- 系统提示补充：`node:` 前缀内置模块、文件可能是 CRLF（replace_text 报错根因）。

## 仍未完成 / 边界

- 本轮修复未提交或推送主仓库；集成分支在 base worktree 本地。
- DEPLOY 的 Dockerfile/compose 仅为配置，Docker engine 未运行，容器未实际构建验证。
- collect.html 客户端流程未做浏览器端到端验证（需要 Playwright + Edge）。
- `COLLECT-DEPLOY-REVIEW` 只改了自身 result.json，未集成（无实质内容）。
- 这仍是单题合成工程试点，不是正式研究验收；jsPsych 多题与正式材料依旧待研究决策。

## 给 Codex 的复核建议

重点看 `a2126fd` 的 diff（58 行插入）即可，无需读 swarm 原始日志。语义改动只有两处值得人工判断：审计 id 稳定化（immersive-run.ts）与测试桩 completed 语义（collection-restore.spec.ts）。
