# 单题界面实现与数据修复

2026-09-18，Codex 实施。UI 版本 atelier-2；contract/schema/client/material 0.3.0；本轮评分版本 0.3.1；protocol unreleased。

## 可体验的内容

入口：`/preview-immersive.html`。三台 SVG/CSS 机柜并排，实际水果转轮、最终预测锁定后的独立拉杆开奖、停止后的真实结果。桌面和手机共用一套流程。

流程：知情同意 → 操作说明 → 开始实验 → 独立预测与信心 → 来源选择 → AI 对话（仅 AI 分支）→ 手动确认最终预测 → 拉杆开奖 → JSON 导出。回答结束不会自动替参与者提交预测。自己判断分支允许调整最终答案，但不展示 AI 建议。历史命中率最高的机器不一定是本轮中奖机器。

聊天采用常见助手界面的消息布局、输入框、逐字分块、停止、同一回答继续、复制和保留历史；使用中性研究助手标识。当前仅支持两个标准问题的预写材料；其他输入返回能力说明。没有连接 GPT、Claude 或 DeepSeek。未把模型自由回答作为实验材料。

## 底层审计结论

| 部分                                        | 当前结论                                                 |
| ------------------------------------------- | -------------------------------------------------------- |
| SessionService / TrialService / ResultStore | 单题内存实现可复用，已有时序、回执、幂等、冲突和评分验证 |
| ChatService                                 | 新增可替换脚本实现，实际页面消费运行时流校验器           |
| 原 MiniMax 页面                             | 已重写；旧页面绕开服务、阶段未锁定，不作为可信数据实现   |
| 持久保存与恢复                              | 未实现；刷新丢失，本地 JSON 需手动下载                   |
| 正式 jsPsych、多题实验、远程后端、真实模型  | 未实现                                                   |

## 修复写死字段

原 `advice_actual_hit: false` 是常量；现由已保存的建议展示事件、建议目标及实际中奖机器计算。原 `advice_target_hit` 没有明确语义，现标记废弃，仍保留 null 兼容旧形状，不能用于分析，也不能把这个旧字段的 null 解读成未展示建议。

新增 `feedback.advice_evaluation`（evaluation_version 1.0.0）：

| 字段                       | 计算含义                                            |
| -------------------------- | --------------------------------------------------- |
| advice_exposed             | 本题已记录 advice_revealed                          |
| advice_target_machine_id   | 已展示的建议目标；未展示为 null                     |
| advice_correct             | 建议目标是否等于实际中奖机器；未展示为 null         |
| independent_matches_advice | 独立答案是否等于建议目标；未展示为 null             |
| final_matches_advice       | 最终答案是否等于建议目标；未展示为 null             |
| switched_to_advice         | 独立答案不同于建议，最终答案等于建议；未展示为 null |
| legacy_target_hit_reason   | undefined_legacy_field，说明旧字段不可解释          |

`advice_actual_hit` 与 `advice_evaluation.advice_correct` 相同。这些比较不等于因果影响，也不直接等于信任或 alpha。

固定演示建议 B、中奖 C 时，独立答案 A 的三种例子：

| 分支与最终答案 | 建议正确 | 最终与建议一致 | 转向建议 |
| -------------- | -------- | -------------- | -------- |
| 自己判断，B    | null     | null           | null     |
| AI，B          | false    | true           | true     |
| AI，A          | false    | false          | false    |

因此后两行的建议正确率相同是合理的；最终答案是否一致另有字段。测试另设建议 B、中奖 B 的正例，确保正确字段不会退化为常量 false。既往导出文件不会自动补算；如需回算，应读取原始事件并单独记录新评分版本。

## 结构与替换接口

- `src/bootstrap-immersive.ts`：装配单题服务、控制器、聊天服务和 UI。未来在这里替换适配器。
- `src/experiment/immersive-run.ts`：保存回执确认后推进阶段；不允许跳过独立预测、来源或最终确认。
- `src/domain/advice-evaluation.ts`：独立的建议比较函数；`text-hash.ts` 使用 SHA-256。
- `src/adapters/local-chat/scripted-chat.ts`：固定材料、分块、取消、同 request_id 的前缀重放；刷新恢复不支持。
- `src/experiment/chat-stream-reader.ts`：运行时核查顺序、ID、连续序号、终结事件、计数和内容哈希。schema 形状校验不能替代它。
- `src/ui/preview-immersive.ts` 与 `src/ui/atelier/`：机柜、对话框和原创 SVG；UI 不另算中奖结果。

真实模型适配器应实现 `ChatService.streamReply`；密钥留在服务端。上线前仍需实现网关、服务端权限与材料边界、失败恢复及记录存储。保留接口不代表真实模型已接通。

## 记录边界

核心预测、信心、来源、完整建议呈现、最终答案、反馈和完成事件进入 ResultStore。新版入口先保存 consent_recorded，自己判断分支合计 7 个事件，AI 分支合计 8 个。旧 preview 默认展示规则保持兼容。

聊天分块、请求、界面动作和页面可见性在导出的 `presentation_audit` 中单独记录，仅存于内存，尚未纳入 ResultStore 的远程保存协议。它是调试审计，不能当作服务端可靠收集。

当前 `advice_revealed` 在标准回答完整渲染、对话框打开且页面可见后记录，不证明参与者实际阅读。部分文字已呈现而停止时，只在分块审计中留痕，不能继续最终预测，必须先读完标准回答。收起对话或页面隐藏会停止生成；继续时重放相同回答并保留前缀。分块记录包含对话框与页面可见标记；这仍不测量注意力。正式研究应另冻结部分呈现和中途退出的记录规则。

## 验证与限制

入口增量后项目 110/110 单测、浏览器 6/6 端到端通过；上一轮历史 Q 反例 12/12 + 6/6 通过，本轮未单独重跑。浏览器覆盖桌面 1280、手机模拟视口 390/360；包含停止/继续、收起后继续、自己判断分支、真实中奖评分及 JSON 比较字段。类型检查、lint、构建通过。视觉截图位于 `artifacts/qa/atelier/`，该目录不入 Git。

上述是同一 Codex 的实现与验证，没有宣称独立 agent 审查或真实手机测试。演示素材仍固定、答案位于浏览器代码，不能招募正式被试。无提交、推送或部署。

## 开始界面（atelier-2）

ENTRY_MATERIAL 在 src/domain/entry-materials.ts 集中保存演示同意文案、确认项、版本和三步流程。src/ui/atelier/entry-screen.ts 与 entry.css 实现两步入口和拒绝退出页，不新引入依赖。

首次进入和刷新均展示同意书；两项未预选的确认都勾选后才能查看说明。不同意不创建实验会话。说明页可返回修改决定，此时清除之前的确认；明确点击开始后才打开会话并经 ResultStore 保存 consent_recorded。未收到保存回执不进入任务。旧 preview 不启用这个可选门控。

导出增加 entry（consent_version、instructions_version、accepted_at、started_at）及 entry_material 文本快照；consent_recorded 的 client_timestamp 为确认时间，sequence_no=0、phase=consent，且没有 trial_id。说明页时间不混入第一个独立预测反应时。同意事件的 elapsed_ms 不是阅读时长，不能拿来推断阅读或理解。未开始便退出的确认只在入口内存存在，不产生导出或研究数据库记录。

当前是原型参与说明草稿，未获确认为正式同意书。资格、时长、报酬、联系人、审批、正式数据保存及撤回办法保持待定；没有捏造已批准状态。正式个人信息页仍未实现。当前安全边界是演示浏览器内的流程门控，不能替代正式服务端校验。
