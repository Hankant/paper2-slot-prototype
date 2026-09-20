# 2026-09-19 采集链路验收交接

状态：**VERIFIED_LOCAL_PILOT**。Codex 直接接管后的修复已同步到主项目；不是公网或正式招募验收。

## 实际结果

- `npm run test:run`：132 / 132（含 5 项 SQLite/HTTP 集成测试，10 项远程适配器测试，6 项恢复测试）。
- `npm run test:collection`：4 / 4。自己分支桌面/390px；丢失已保存回执后刷新；AI 流式回答及刷新、完成接口故障重试。
- `npm run test:e2e`：6 / 6，旧预览与单题界面未回归。
- typecheck、lint、前端与服务端构建通过；format:check 通过。新增 server/tools 也按 Prettier 格式化。
- 主项目 `npm run build:all` 再次通过，`npm run collect:local` 已启动在 127.0.0.1:5200。
- 本机真实 HTTP 写入一条明确标记 `synthetic_operations_smoke` 的合成会话：7 个核心事件，完成回执、本人导出均成功。不是被试数据。
- `npm run collect:export` 成功生成 JSON + CSV；`npm run collect:backup` 成功生成快照并通过 SQLite integrity_check。
- Docker Compose `config --quiet` 通过；Docker Desktop Linux 引擎未运行，容器 build/run、Caddy 与公网 HTTPS **未验证**。

## 接管后发现并修复

1. 服务端自己分支开放 AI 建议，且测试沿用错误预期：改为禁止，自己分支不要求建议事件。
2. 所有会话使用 virtual-preview 参与者编号：改为独立随机匿名 ID。
3. 任意客户端同意版本被服务端接受，入口确认可能夹带参与码入库：固定试点版本并只保存白名单字段。
4. 审计 ID 根据数组位置生成，刷新后同 ID 对应不同内容：改为生成一次的 UUID，重试从持久队列重用同一记录。
5. 先构建控制器、后刷新待确认队列，导致恢复状态落后：现在先确认旧队列，再拉取新快照。
6. 待发队列没有会话隔离，AI 阶段刷新未重新加载建议：改为按会话命名空间恢复并补齐建议加载。
7. 完成失败仍显示完成，或停留正在开奖：显示等待保存确认及可重试按钮，完成前不开放重新开始。
8. 源码只收到 memory 回执仍可清队列：HTTP adapter 必须验证 remote + receipt_id + persisted_at，未确认 ID 不丢弃。
9. 已加载但未呈现的建议在重启后丢状态；写入时自动加载建议/反馈弱化门控：恢复数据库加载标记，写入不再代替读取。
10. 审计同一批次内部冲突、静态目录真实路径约束、POST JSON、CSV 公式前缀处理及建议比较列已补齐。

## 使用入口

- 页面：http://127.0.0.1:5200/collect.html
- 首次本地参与码：PAPER2-LOCAL；非云端或正式实验密钥。
- 数据库/本机设置/导出/备份：主项目 `private/collection/`，Git 与 Docker context 均排除。
- 使用说明：`docs/COLLECTION_PILOT.md`；云端方案：`docs/COLLECTION_DEPLOYMENT.md`。
- 手机视口截图：主项目 `artifacts/qa/collection/`。真机及微信内置浏览器仍未测试。

## 调度和版本记录

早期 Kimi 的候选报告不等于验收结果；原始报告在 `.agents/worker-reports/`，调度摘要仍在 `.agents/results/`。一次外部测试因旧 Vite 无法解析 node:sqlite 而失败；隔离集成提交 a2126fd 已修复 Node 加载兼容等问题，本轮在该实际文件基础上继续审阅。候选曾未通过的摘要保留，最终状态以本报告为准。

用户最新要求停止 Kimi/多 agent。后续由 Codex 单人推进，既有 worker 和控制器仅作历史记录，不继续运行。没有新增外部 agent，没有购买资源、部署公网或 Git 推送。

隔离集成分支：codex/paper2-collection-20260919。仅同步本项目文件，未改动其他论文资料；同步前旧文件副本保留在主项目 ignored artifacts/integration-before-20260919/。

## 仍未解决的正式上线边界

单轮、固定模拟结果；非正式 jsPsych timeline，非真实 AI。正式试次/随机化、研究材料、招募码管理、跨设备找回、负载、异地备份、云端验收另行实施。协议仍 unreleased，alpha 的研究识别未因此得到验证。Node 24.14.1 的 node:sqlite 当前发出实验性提示；已有开发依赖 audit 告警未以大版本升级强行消除，须在公开部署前继续审查。
