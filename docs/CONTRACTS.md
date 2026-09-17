# 公共接口规格

状态：`DRAFT`，G0 前不能宣称已冻结。本文是当前开发接口入口；来源快照仅供追溯。

## 1. 核心类型和职责

| 公共对象 | 必须表达的含义 |
|---|---|
| Session | 随机研究编号、会话身份、研究版本、分组、批次、后端及保存范围 |
| ExperimentState | 当前阶段、题号、最后确认事件、完成状态 |
| PublicTrial | 当前阶段可见的历史和说明；不含正式未来结果、私有种子 |
| Feedback | 合法提交后可见的实际中奖者、最终预测、积分及评分版本 |
| Event | 版本化响应及过程记录，见下节 |
| SaveReceipt | 哪些事件已持久保存、哪些被拒绝或未确认 |
| Capabilities | `supported / unsupported / unverified`，不能混用 |

材料的完整 `PrivateTrial` 仅由生成器、模拟适配器或服务器使用。LocalDemo 可在本机持有答案，但标记仅演示，不能因此将它打包进正式版。

## 2. 接口方法

| 接口 | 方法 | 语义 |
|---|---|---|
| SessionService | openSession(entryCredential, versions) | 验证入口、建立或按明确策略恢复会话，固定条件 |
| SessionService | loadState(session) | 返回已确认状态，不信任浏览器提交的旧状态 |
| TrialService | loadTrial(session, trialId) | 返回此阶段可见材料；建议是否可见受状态和配置约束 |
| ResultStore | saveEvents(session, events) | 逐事件回执；可能部分成功，不默认为全成功 |
| TrialService | getFeedback(session, trialId) | 选择已确认后返回结果；不能重抽结果或重复计分 |
| SessionService | finishSession(session) | 必需事件齐全才完成，不以浏览器单方面声明结束 |

G0 将这些约定转为精确 TypeScript 签名。认证令牌由适配器私有管理，领域对象不在 UI 中暴露凭证。

## 3. 原始事件及数据字典

公共封套：`schema_version, contract_version, protocol_version, material_version, client_version, session_id, participant_id, event_id, sequence_no, trial_id?, phase, event_type, client_timestamp, elapsed_ms, payload`。

session 另外记录 `participation_mode`（现场/远程/未知）、`device_class`、`recruitment_batch`、`adapter_version`、`provider`；设备不决定参与方式。

候选事件：`consent_recorded, profile_submitted, comprehension_answered, prediction_submitted, confidence_submitted, source_selected, feedback_presented, visibility_changed, session_completion_requested`。权威开奖和评分记录由实验服务生成，并标记来源，不接受浏览器任意覆盖。

原始反应时单位为毫秒，由本地单调时钟计算；服务器接收时间分开记录。信心 0—100；正确率内部统一 0—1，并保存正确题数和分母。机器逻辑 ID 与屏幕位置分别保存。

逐题导出至少包括：历史材料编号、机器位置、个人预测、信心、建议、建议是否已揭示、来源选择、最终预测、实际中奖者、双方是否预测命中、积分、建议目标/实际/披露正确率、校准分子分母。

## 4. 保存与状态

SaveReceipt 必含 `acknowledged_event_ids, rejected_events, unconfirmed_event_ids, persistence_scope, session_status`；远程已保存时另有服务器确认时间。保存范围区分 `memory / browser_local / remote`，只有经过验证的远程回执能显示“已上传”。

相同 event_id 同内容重试不重复计分；不同内容报 EVENT_CONFLICT。先展示反馈必须已满足保存及阶段要求。HTTP 200 不是保存语义本身。

最小阶段：`entry → consent → profile → instructions → practice → calibration → main → finalizing → completed`；正式题内部 `history → prediction → confidence → advice/source（顺序由配置指定）→ feedback`。无建议阶段不生成虚假 source_selected。

错误统一为 `INVALID_ENTRY_CODE, SESSION_EXPIRED, INVALID_EVENT, EVENT_CONFLICT, OUT_OF_ORDER, RATE_LIMITED, NETWORK_UNAVAILABLE, PERSISTENCE_UNCONFIRMED, UNSUPPORTED_CAPABILITY`，带 retryable 和可展示信息。

## 5. 能力与版本

必查 `persistentResults, idempotentWrites, resumeSession, serverControlledTrials, serverScoring, individualEntryCodes`。JATOS、HTTP 或云表格的名字不构成能力已通过的证据。

G0 建立必需能力配置；本地演示允许能力不足但明确标识，正式模式不得静默降级。切换后端默认只作用于新会话；历史数据迁移独立执行。

版本变化由 A 维护。B/C/D 需要改接口时在自己的 handoff 提交变更请求：现有字段、拟改内容、原因、影响模块和兼容策略；A 更新版本后统一通知。
