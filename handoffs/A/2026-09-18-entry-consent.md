# 实验入口检查点

状态：DONE（演示范围）。用户要求在实验开始前增加知情同意书与流程说明。由 Codex 接手单题原型 UI、入口装配、必要的 consent 事件门控、相关测试与文档，不修改正式研究条件。

现状：preview-immersive 直接初始化单题。当前没有获确认的正式同意文本、联系方式、报酬、保存期限与审批信息；沿用 DECISIONS T07 的待定状态。新增可体验的演示同意书，明确其草稿边界，不声称完成伦理批准。

计划：同意入口 → 操作说明 → 显式开始；拒绝退出，不预选同意。开始前不建立实验会话；同意版本写入现有 ResultStore 事件，导出同时附呈现文本与时间。旧 preview 行为不变。

验证：未同意/拒绝/刷新不进入任务、同意事件先于预测、桌面手机布局、已有两条来源分支回归、类型/lint/build。

## 交付

已实现两步入口及拒绝页，新增 src/domain/entry-materials.ts、src/ui/atelier/entry-screen.ts 和 entry.css；调整 bootstrap-immersive、ImmersiveRun、one-trial-preview 的可选同意门控，以及入口 CSS 导入。使用已有 consent_recorded 事件，不改变接口版本；requireConsentVersion 只由新版入口启用。没有会话或真实资料在确认并点击开始前创建。

UI atelier-2；演示同意版本 preview-consent-2026-09-18-v1，说明版本 preview-instructions-2026-09-18-v1。文案集中维护，可替换为之后确认的正式材料。同意版本与时间写入核心事件，说明版本和原文快照随 JSON 导出；仍仅内存保存。无个人信息表、正式审批或招募承诺。

测试：110/110 项目单测，6/6 浏览器端到端；新增缺失/错误版本门控、同意重试幂等、完成计数、拒绝返回、撤回重新选择、刷新重置和导出核验。lint、类型与 build 通过。桌面 1280、手机模拟 390 的入口与说明截图已查看，360 测试无横向溢出；截图在 artifacts/qa/atelier/entry-_.png 和 instructions-_.png。内嵌浏览器连接本次暂不可用，视觉检查使用实际 Edge 测试截图，不宣称真机验证。

README、CONTRACTS、STATUS、ATELIER_IMPLEMENTATION、LATEST 已更新。当前同一 Codex 顺序承担本轮路径，不启动其他 agent。无提交、推送、部署。其他项目文件保留。
