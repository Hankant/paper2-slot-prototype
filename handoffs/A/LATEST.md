# A 当前检查点：0.3.0 修复与交互预览

后续规划（2026-09-18）：用户要求高仿真老虎机、GPT/Claude 风格聊天、流式输出与未来 DeepSeek 接口；已落盘 [UI 升级方案](../../docs/IMMERSIVE_UI_PLAN.md)。仅文档规划完成，尚未实施 U0–U5，不改变下列代码基线及既有验证结论。接手前连同该方案阅读，公共聊天契约仍需 A 冻结。

- 日期：2026-09-18；任务 ID：G0-codex-repair-preview；执行者：Codex（用户授权接手 A）。
- 状态：DONE；仅表示本轮 G0 修复与单题预览完成，不表示完整实验或真实采集可用。
- 基线：HEAD 2f9303b + MiniMax 未提交交付；contract/schema/client/material 0.3.0，demo-0.3.0，protocol unreleased。
- 允许范围：工程配置、公共类型、demo 配置、当前文档与测试；用户追加可点击成果后临时接手单题 UI 和内存 adapter。所有权说明在 PARALLEL_TASKS。
- 已完成/文件清单/迁移：[2026-09-18-codex-repair.md](2026-09-18-codex-repair.md)。
- 验证：68 项项目测试 + Q 原 12/6 项 + 浏览器 2 项通过；类型、lint、格式、构建、真实 alias 消费者通过。
- 已知未完成：jsPsych 多题、生产适配器、可靠保存队列/刷新恢复、真机、正式研究协议。
- 代码位置：E:/Info_AI/projects/paper2-slot-prototype；本机落盘，未提交、未推送、未部署。
- 活跃进程：本机预览服务 127.0.0.1:5197（npm run dev -- --port 5197），用户要求查看，保持运行。自动测试临时服务已退出。
- 下一步：明确派发 B/C/D，先读当前 README/CONTRACTS/STATUS，不照旧 0.2.0 交接再初始化；公共类型/依赖/入口仍由 A 协调。
- owner 状态：本轮收尾后释放临时写入占用，后续接手前登记实际 owner。
- 恢复检查：先核对源码与上述版本，使用项目检查命令；Q 旧报告是历史状态，当前修复结果以本交接为准。
