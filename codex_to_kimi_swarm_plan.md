# Codex → Kimi 异构 Agent 工作方案

## 1. 目标

构建一个 **Codex 控制层 + Kimi 执行层 + Git/Test 状态层** 的异构 Agent 系统。

核心目标：

- 尽可能把高 token、重复性强的工作转移给 Kimi。
- 让 Codex 只承担高价值决策：架构、任务拆分、风险判断、升级、最终审查。
- 使用 Git、worktree、tests 和结构化 JSON 作为 Agent 之间的主要通信媒介。
- 从第一天开始记录成本、轨迹、成功率与升级率，为后续自适应 routing 提供数据。

核心原则：

> Codex 是控制平面（Control Plane），Kimi 是计算平面（Compute Plane）。

---

## 2. 总体架构

```text
                         Human
                           │
                           ▼
                 ┌─────────────────┐
                 │ Codex Controller│
                 │                 │
                 │ architecture    │
                 │ decomposition   │
                 │ routing         │
                 │ escalation      │
                 │ final review    │
                 └────────┬────────┘
                          │
                     task.json
                          │
                  ┌───────▼────────┐
                  │ Local Scheduler│
                  │   swarmctl.py  │
                  └───────┬────────┘
                          │
             ┌────────────┼─────────────┐
             │            │             │
             ▼            ▼             ▼
         worktree A   worktree B    worktree C
             │            │             │
             ▼            ▼             ▼
          Kimi A        Kimi B        Kimi C
         explorer        coder        tester
             │            │             │
             └────────────┼─────────────┘
                          ▼
                 automated verifier
                test/lint/typecheck
                          │
                    result.json
                          │
                          ▼
                    Risk Router
                    /          \
                 low            high
                  │              │
                merge        Codex review
                                  │
                                merge
```

---

## 3. Codex 与 Kimi 的职责边界

### 3.1 Codex：Principal / Architect / Auditor

Codex 负责：

- 理解用户最终目标。
- 全局架构决策。
- Task decomposition。
- 判断任务风险。
- 决定是否并行与并发数。
- 决定是否升级到更强模型或人工式审查。
- 高风险 diff review。
- 最终 integration。

Codex 尽量不负责：

- 大规模 repo 搜索。
- 普通模块代码实现。
- 批量测试生成。
- 重复 debug。
- 长时间 shell 探索。

可以把 Codex 理解成：

```text
expensive managerial compute
```

### 3.2 Kimi：Worker

Kimi 主要负责：

- Repository exploration。
- 普通代码实现。
- 单元测试与集成测试补充。
- 反复 debug。
- 文档更新。
- 模块级重构。
- 低风险 code review。

---

## 4. 最重要的通信原则

### 4.1 不要让 Codex 读取 Kimi 的完整输出

错误做法：

```text
Codex
 ↓
kimi -p "implement feature"
 ↓
50,000 token terminal output
 ↓
Codex 全量读取
```

这样会把额度优势重新吃掉。

正确做法：

```text
Codex
 ↓
task.json
 ↓
Kimi
 ↓
logs/raw/task-001.log   ← 默认不进入 Codex 上下文
 ↓
git commit
 ↓
result.json             ← Codex 默认只读取这个
```

### 4.2 Git 是主要通信总线

优先使用：

- Git commit
- git diff
- worktree
- tests
- JSON artifacts

而不是 Agent 之间的大段自然语言转述。

原则：

```text
Agent A
  ↓
Git / files / tests
  ↓
Agent B
```

而不是：

```text
Agent A
  ↓ natural language
Agent B
```

---

## 5. Task Contract

Codex 委派任务时，必须生成结构化任务描述。

建议 schema：

```json
{
  "task_id": "AUTH-003",
  "goal": "Implement refresh-token rotation",
  "scope": {
    "allowed_files": [
      "src/auth/**",
      "tests/auth/**"
    ],
    "forbidden_files": [
      "migrations/**",
      "infra/**"
    ]
  },
  "context": {
    "entry_files": [
      "src/auth/service.py",
      "src/auth/models.py"
    ]
  },
  "acceptance": [
    "existing auth tests pass",
    "expired refresh token is rejected",
    "rotation invalidates previous token"
  ],
  "risk": "medium",
  "budget": {
    "max_minutes": 20,
    "max_files_changed": 6,
    "max_diff_lines": 800,
    "max_retries": 2
  },
  "output": {
    "commit_required": true,
    "result_json_required": true
  }
}
```

核心思想：

> Agent 委派不是一句模糊自然语言，而是一个 Delegation Contract。

---

## 6. Repository 目录建议

```text
repo/
│
├── AGENTS.md
│
├── .agents/
│   ├── policy.yaml
│   ├── architecture.md
│   ├── interfaces.json
│   ├── state.json
│   │
│   ├── tasks/
│   │   ├── AUTH-001.json
│   │   ├── AUTH-002.json
│   │   └── AUTH-003.json
│   │
│   ├── results/
│   │   ├── AUTH-001.json
│   │   └── AUTH-002.json
│   │
│   └── logs/
│       └── ...
│
├── src/
├── tests/
│
└── tools/
    └── swarmctl.py
```

### AGENTS.md 建议内容

```md
# Agent Delegation Rules

Codex acts as architect and integrator.

Prefer Kimi workers for:
- repository exploration
- implementation
- test generation
- repetitive debugging

Codex must review:
- authentication
- authorization
- database migrations
- public API changes
- dependency changes
- changes > 1000 LOC

Never ingest full Kimi logs unless debugging the worker itself.
Use result.json and git diff by default.
```

---

## 7. Scheduler：swarmctl.py

Codex 不直接自由调用大量 Kimi CLI，而是统一通过 scheduler。

入口示例：

```bash
python tools/swarmctl.py run AUTH-003
```

Scheduler 负责：

1. 读取 task.json。
2. 验证 budget。
3. 创建 Git worktree。
4. 启动 Kimi worker。
5. 将完整 stdout/stderr 写入 log 文件。
6. 运行 tests / lint / typecheck。
7. 检查 scope violation。
8. 生成 result.json。
9. 只向 Codex 返回短摘要。

这是典型的：

```text
Control Plane / Data Plane Separation
```

---

## 8. Git Worktree 隔离

每个 worker 使用独立 worktree：

```text
repo-main/
../workers/AUTH-001/
../workers/AUTH-002/
../workers/AUTH-003/
```

逻辑上相当于：

```text
main
 ├── task/AUTH-001
 ├── task/AUTH-002
 └── task/AUTH-003
```

多个 Kimi 可同时工作而不互相覆盖。

完成后进行逐个集成：

```text
cherry-pick A
↓
test
↓
cherry-pick B
↓
test
↓
cherry-pick C
↓
test
```

不要一次性合并所有结果。

---

## 9. V1 的 Worker 类型

第一版只需要 3 类 worker：

### EXPLORE

权限：只读。

职责：

- 搜索 repo。
- 找相关模块。
- 建立 dependency map。
- 定位 bug。

### CODER

权限：读写。

职责：

- 实现任务。
- 修改代码。
- 运行测试。
- commit。

### REVIEWER

权限：只读。

职责：

- 审查 patch。
- 找潜在逻辑错误。
- 检查边界条件。

---

## 10. V1 Routing Policy

第一版不使用机器学习，直接规则化。

| Risk | 执行 | Review |
|---|---|---|
| Low | Kimi | tests |
| Medium | Kimi | Kimi reviewer + tests |
| High | Kimi | Codex review |
| Critical | Codex plan → Kimi implement | Codex full review |

### Low

示例：

- README
- docs
- formatting
- simple tests
- isolated utility

流程：

```text
Kimi → Tests → Merge
```

### Medium

示例：

- 普通 feature
- 独立 backend API
- UI component

流程：

```text
Kimi coder
  ↓
Tests
  ↓
Kimi reviewer
```

### High

示例：

- cross-module changes
- concurrency
- complex state
- core business logic

流程：

```text
Kimi
 ↓
Tests
 ↓
Codex review
```

### Critical

示例：

- auth
- security
- database migration
- payment
- public API breaking change

流程：

```text
Codex Plan
 ↓
Kimi Implement
 ↓
Codex Review
```

---

## 11. Escalation Policy

默认允许 Kimi 自己重试一次或恢复同一上下文。

```text
Kimi attempt 1
      ↓ fail
resume same worker
      ↓
Kimi attempt 2
```

触发以下任一条件时升级到 Codex：

- 连续 2 次失败。
- scope violation。
- regression tests fail。
- 修改文件数 > 8。
- diff > 1200 LOC。
- 新增依赖。
- architecture assumption 不清楚。
- 涉及 critical path。

Codex 收到的应该是摘要：

```text
TASK AUTH-003 FAILED

attempts: 2

failing tests:
- test_token_rotation
- test_concurrent_refresh

changed files:
5

worker diagnosis:
possible transaction race condition
```

而不是完整原始日志。

---

## 12. Verifier 设计

不能信任 Agent 自报成功。

正确流程：

```text
Kimi says success
        ↓
      IGNORE
        ↓
Automated verifier
        ↓
pytest
lint
typecheck
build
scope check
        ↓
    verified?
```

任务状态建议：

```text
RUNNING
  ↓
CANDIDATE_SUCCESS
  ↓
VERIFIED_SUCCESS
```

Kimi 只能提交：

```text
candidate_success
```

只有 scheduler 才能把状态提升为：

```text
verified_success
```

---

## 13. Codex Review 分层

避免 Codex 每次读取整个 repo。

### Level 0

只读取：

```text
result.json
```

### Level 1

读取：

```bash
git diff --stat
```

### Level 2

读取：

```bash
git diff
```

### Level 3

读取：

```text
diff
+ related interfaces
+ failing tests
```

### Level 4

Repo-wide exploration。

只有极高风险或复杂失败时才使用。

原则：

```text
Review Cost = f(Risk)
```

---

## 14. 并发与 Swarm 策略

V1 不让 Kimi 自由递归开 AgentSwarm。

建议：

```text
max_workers = 3
max_agent_depth = 1
```

第一版：

```text
Codex
 ↓
Scheduler
 ↓
Kimi A / Kimi B / Kimi C
```

等积累足够运行数据后，再考虑：

```text
Kimi worker
 ↓
内部 AgentSwarm
```

原则：

> 先受控并发，再动态 swarm。

---

## 15. 安全边界

Worker 默认只能访问自己的 worktree。

禁止：

- `~/.ssh`
- AWS/GCP/Azure credentials
- production secrets
- production DB
- Docker socket
- arbitrary home directory

网络：

```text
default off
```

除非任务明确需要。

---

## 16. 观测与数据采集

每个任务都记录：

```json
{
  "task": "AUTH-003",
  "model": "kimi",
  "risk": "medium",
  "trajectory": {
    "duration_seconds": 384,
    "tool_calls": 37,
    "retries": 1
  },
  "cost": {
    "kimi_tokens": 82410,
    "codex_review": false
  },
  "result": {
    "tests_pass": true,
    "merged": true
  }
}
```

长期数据集：

```text
D = {
  task features,
  model,
  cost,
  trajectory,
  success
}
```

未来可训练：

```text
P(success | task, model)
```

以及：

```text
P(needs Codex review | task, Kimi result)
```

---

## 17. 三阶段路线图

### V1 — Controlled Delegation

目标：证明 Codex quota 可以显著下降。

架构：

```text
Codex
 ↓
task.json
 ↓
swarmctl.py
 ↓
≤ 3 Kimi workers
 ↓
worktree
 ↓
tests
 ↓
result.json
 ↓
Codex selective review
```

不做：

- ML router
- dynamic swarm
- recursive agent spawning

### V2 — Adaptive Routing

积累约 100–500 个 tasks 后，开始学习：

```text
task complexity
↓
Kimi or Codex?
```

以及：

```text
Kimi result
↓
need Codex review?
```

从规则：

```text
π_rule
```

升级到：

```text
π_θ
```

### V3 — Heterogeneous Swarm

让 scheduler 动态决定：

```text
π(s) → (N, Model, Role, Budget)
```

示例：

```text
复杂 issue
    ↓
Codex architecture
    ↓
Scheduler
    ├── Kimi explore
    ├── Kimi backend
    ├── Kimi frontend
    └── Kimi tests
              ↓
       uncertainty high
              ↓
         Codex reviewer
```

---

## 18. 核心 KPI

不要只看 SWE-bench accuracy。

建议核心指标：

```text
Success Rate
Cost / Task
Codex Quota / Task
Kimi Tokens / Task
Latency / Task
Escalation Rate
Regression Rate
Merge Conflict Rate
```

最重要的指标：

```text
Codex Leverage
=
Successful Engineering Tasks
/
Codex Compute Consumed
```

目标不是单纯追求最高成功率，而是让系统沿着：

```text
Quality ↑
Cost ↓
```

方向推进 Pareto Frontier。

---

## 19. V1 最小可行实现清单

第一版只做以下六件事：

1. `AGENTS.md`
2. `task.json / result.json` schema
3. `swarmctl.py`
4. Git worktree 隔离
5. automated verifier
6. escalation rules

完成这六项后，就已经具备一个可运行、可量化、可迭代的：

```text
Codex → Kimi Heterogeneous-Agent Harness
```

后续的 AgentSwarm、自适应 routing、bandit、MDP 与 learned scheduler，都应在这一骨架上逐步演化，而不是一开始就引入过高复杂度。
