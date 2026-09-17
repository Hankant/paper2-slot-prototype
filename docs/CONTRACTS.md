# 公共接口规格

版本：**0.3.0，2026-09-18 工程基线**。本轮修复 0.2.0 的接口集成缺陷；正式研究方案仍 unreleased。精确类型以 src/contracts/index.ts 及 validators.ts 为准。

## 服务分工

| 接口           | 方法                          | 约定                                                 |
| -------------- | ----------------------------- | ---------------------------------------------------- |
| SessionService | openSession(credential)       | 凭证内带 client_versions；建立或按所声明策略恢复会话 |
| SessionService | loadState(session)            | 返回服务确认的状态                                   |
| SessionService | describeCapabilities()        | 如实返回 supported/unsupported/unverified            |
| SessionService | finishSession(session)        | 必需事件齐备后返回完成回执                           |
| TrialService   | loadTrial(session, trialId)   | 只提供当前阶段可见内容                               |
| TrialService   | loadAdvice(session, trialId)  | 阶段条件满足后返回 RevealedAdviceBlock               |
| TrialService   | getFeedback(session, trialId) | 最终答案确认后返回评分；不能重抽结果或重复记分       |
| ResultStore    | saveEvents(session, events)   | 所有参与者写入的唯一入口，逐事件返回 SaveReceipt     |

删除 0.2.0 的 recordSourceChoice：来源选择和最终答案不再通过另一条无回执的方法写入。所有重试使用同一 event_id 与相同内容，内容冲突必须报 EVENT_CONFLICT。

## 事件和载荷

封套包含 schema_version、contract_version、protocol_version、material_version、client_version、session_id、participant_id、event_id、sequence_no、trial_id（按事件要求）、phase、event_type、client_timestamp、elapsed_ms、payload。

EventEnvelope 是按 event_type 区分的 TypeScript 联合类型；来自网络/缓存的 unknown 先用 parseEventEnvelope 校验。运行时保留已验证的 payload；不能将其丢弃后称为已保存。

| 事件                         | payload                                            | trial_id                          |
| ---------------------------- | -------------------------------------------------- | --------------------------------- |
| consent_recorded             | version                                            | 禁止；具体同意/退出流程待正式实现 |
| profile_submitted            | fields                                             | 禁止；真实字段仍待研究确定        |
| comprehension_answered       | question_id, answer, correct                       | 可选，说明页不伪造试次            |
| prediction_submitted         | machine_id, display_position                       | 必需；独立预测                    |
| confidence_submitted         | confidence_percent                                 | 必需；0—100                       |
| source_selected              | source                                             | 必需；不要求此时已有最终答案      |
| advice_revealed              | advice_id, revealed_at_phase                       | 必需；建议已可见后记录            |
| final_prediction_submitted   | machine_id, display_position, changed_after_advice | 必需；与独立预测分开              |
| feedback_presented           | presented_at_ms                                    | 必需；先获取/展示反馈，再记录     |
| visibility_changed           | element_id, visible                                | 可选，会话级页面可不属于试次      |
| session_completion_requested | ack_required_event_count                           | 禁止                              |

source 的 human/ai/mixed/no_advice_shown 是接口保留值，不代表正式实验条件已确认。当前单题预览仅用 human（明确表示自己）和 ai（模拟建议），不实施 mixed 条件。没有建议的正式阶段应另明确完成规则，不伪造 source_selected。

## 本轮可运行的单题顺序

单题预览跳过知情同意与资料页，不收集个人资料；从 main 开始。演示固定为：

```text
独立预测保存 → 信心保存 → 来源选择保存 → 读取并展示建议
→ 建议展示事件保存 → 最终预测保存 → 读取并展示反馈
→ 反馈展示事件保存 → 完成请求保存 → finishSession
```

这是明确的模拟设置，正式 T03 不因此定稿。配置中的 after_choice 在本预览指独立预测后，预览还要求来源选择先确认；before_choice/none 与多题实验仍由 B/C/D 按将来选定协议实施，不声称该单题服务覆盖所有模式。

Preview 的 loadAdvice/反馈读取可重复；评分是固定开奖结果与已保存最终答案比较。最高历史命中率但没中奖仍为错误。source_selected 与最终答案可不同，并分别记录；不把答案一致自动当作采纳。

## 可见数据与评分

- HiddenAdviceBlock 只含 advice_id 与 revealed:false；任何目标机器、位置、copy 都会被拒绝。
- RevealedAdviceBlock 才包含目标机器、显示位置和 copy，revealed 必须为 true。PublicTrial 在揭示前可省略 advice 或只带 hidden metadata。
- 机器逻辑编号、屏幕位置分别保存，并要求试次内唯一；揭示建议的目标必须与机器映射一致。
- TrialFeedback 包含实际中奖机器、独立/最终是否命中、积分、scoring_version、反馈释放前所需事件类型。required_event_types 不得包含 feedback_presented，避免循环前置条件。
- 原始事件与反馈通过 trial_id 关联；JSON 下载包含两者。全套逐题 CSV、校准分子分母、材料清单等仍是 G1/G2 要求。
- 正确率内部 0—1、信心 0—100、时间毫秒。参与方式与设备类型分开；预览不推断真实身份或采样来源。

## 保存范围与能力

SaveReceipt 包含 acknowledged_event_ids、rejected_events、unconfirmed_event_ids、persistence_scope、session_status、persisted_at、receipt_id、current_phase。三个 ID 集合内部唯一且互斥。remote 要求确认时间与回执 ID；memory/browser_local 对应字段为 null。HTTP 200 不等于远程持久保存。

capabilitiesSchema 只验证声明形状，允许 unsupported/unverified。satisfiesRequired 另检查生产最低条件 persistentResults、idempotentWrites、serverControlledTrials；通过只是必要条件，真实部署还需协议所需能力和实际保存证据。

one-trial-preview 仅在内存保留事件；已验证内存幂等，不支持刷新恢复、独立参与码、服务端开奖/计分或持久保存。它明确返回 memory。它的完整答案存在浏览器代码中，绝不能作为正式实验服务。

真实适配器仍需验证请求和回执对应、身份隔离、部分成功、断网/刷新恢复及持久存储。切换后端默认仅作用于新会话。

## 版本与责任

当前 contract/schema/client 为 0.3.0，演示材料为 0.3.0，demo 配置为 demo-0.3.0；正式 protocol=unreleased。已有实验会话不得中途换版。本次没有真实样本需要迁移。

A 唯一维护共享接口、依赖、bootstrap 和版本。B/C/D 按职责表实施；修改字段先交 A 协调。推荐公共 import '@contracts'，裸别名与子路径在 TS/Vite/Vitest 三处均配置，并经过真实消费者验证。
