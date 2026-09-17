# Codex 接手修复与一题预览交付

日期：2026-09-18。用户明确授权直接修复，并追加希望看到可点击成果。基线 HEAD 2f9303b + MiniMax 0.2.0 未提交文件。

## 已完成

| 复审问题              | 修正                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| N1 alias 真实构建失败 | 裸别名采用精确匹配，子路径单独规则；TS/Vite/Vitest 一致；消费者实际打包通过                                                  |
| N2 未揭示建议含内容   | HiddenAdviceBlock 仅 advice_id/revealed:false，严格拒绝内容；揭示后才返回目标及文本                                          |
| N3 本地能力声明被拒绝 | 声明 schema 与准入检查分开；演示的未知入口码能力改为 unverified                                                              |
| N4 写入回执与时序     | 删除 recordSourceChoice；source_selected 和 final_prediction_submitted 分别通过 saveEvents；反馈不能以自身展示事件为前置条件 |
| N5 非试次事件         | 理解检查与可见性事件允许不带 trial_id；预测等事件仍必需关联试次                                                              |
| N6 交接不一致         | CONTRACTS/README/STATUS/职责表同步 0.3.0；原报告保留                                                                         |

同时增加 EventEnvelope 判别联合类型与 parseEventEnvelope；扩展 lint 覆盖 config/工具 TS/后续服务，typecheck 纳入 tsconfig.node；忽略 tsbuildinfo。

旧 source_selected 同时携带最终答案的结构不再支持。0.3.0 明确拆成两条事件。旧消费者应按当前 CONTRACTS 更新，不与旧会话混用；当前没有真实数据需要迁移。

## 用户能看到什么

运行 `npm run dev -- --port 5197` 后打开 http://127.0.0.1:5197/preview.html。状态页 index.html 也有预览入口。

界面支持独立预测、信心、来源选择、揭示模拟建议、最终答案、固定开奖、模拟积分、JSON 下载与重新体验。A 的历史率最高（70%），模拟建议固定 B，中奖固定 C；最终选 A 是 0 分，选 C 是 10 分。期望值在测试中手写核对。

纯 TypeScript 预览使用相同公共接口与内存服务，尚未接 jsPsych。无真实身份、无网络上传、刷新清空。浏览器能访问完整演示代码和答案，因此不适合招募或真实测量。下载包含原始事件和反馈，便于复核。

## 最终验证

| 命令/检查                                 | 结果                                     |
| ----------------------------------------- | ---------------------------------------- |
| npm run typecheck                         | 通过：业务和工具配置                     |
| npm run lint                              | 通过；修正预览文案中的全角空格后复跑     |
| npm run format:check                      | 通过（最终文档收尾检查）                 |
| npm run build                             | 通过；生成 index.html + preview.html     |
| 实际以 contracts-consumer.ts 为 Vite 输入 | 通过，21 modules，write:false            |
| npm run test -- --run                     | 9 文件，68/68 通过                       |
| Q 原 g0-review                            | 12/12 通过，反例未改                     |
| Q 原 g0-revision-review                   | 6/6 通过，反例未改                       |
| npm run test:e2e                          | Edge 1280/390 像素宽各一个用例，2/2 通过 |

总计 88 个测试用例通过。契约场景验证：合法能力声明、隐藏建议、独立/最终答案分开、按实际中奖评分、提前读取拒绝、重复读反馈不重复计分、事件重试幂等、内容冲突、部分回执、跨身份拒绝及完成确认。浏览器测试真实点击、下载并读 JSON、重置/刷新、无 pageerror、无整页横向溢出；截图已检查。

测试证据在 artifacts/qa/codex-repair：unit-tests.log、browser-tests.log、review-v1.json、review-v2.json、preview-advice/result-1280/390.png；该目录被 Git 忽略，交第三方时显式附带。

本轮未执行全新环境 npm ci、真机、远程后台、完整正式实验测试。真实部署能力不由 mock 的测试通过推出。

## 文件与恢复入口

- src/contracts、config/demo、根构建/检查配置：修复核心。
- src/adapters/local-demo/one-trial-preview.ts：仅一题的内存服务，后续 C 不应误称其为完整 LocalDemo。
- src/ui/preview.html、preview.ts、preview.css：可点击 UI；main.ts 增加入口。
- tests/contracts/one-trial-flow.spec.ts：接口串联；tests/e2e/preview.spec.ts：浏览器验收。
- 当前文档、handoffs/A/LATEST.md、docs/STATUS.md：接手依据。

保留旧 Q 报告作为历史审查，不重写其当时结论。已修改两个项目测试的语义：能力不足但声明合法应通过解析；反馈前置改用最终答案事件而非 feedback_presented。这是修正规格矛盾，Q 独立检查未放宽。

本机 5197 预览服务为满足用户查看需求继续运行；会话进程退出后可用上述命令重启。不提交、不推送、不部署。B/C/D 可按 0.3.0 明确分配后进入 G1；本轮没有自动启动它们。
