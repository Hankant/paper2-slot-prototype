# G0 第二轮复审：contract 0.2.0

审查日期：2026-09-18，Asia/Shanghai。对象：A 的 `2026-09-17T23-12+08-00_g0-revision.md` 及本机对应源码；Git HEAD 仍为 `2f9303b`，交付尚未提交。

**结论：上一轮已复现的数据校验缺陷有明确修复，但接口集成仍未通过；保持 READY_FOR_REVIEW，先完成本报告列出的收尾，再放行依赖契约的 B/C/D。**

本轮仅审查、运行测试并在 Q 目录保存证据，没有改动 A 的业务实现、配置、原测试或看板。没有部署和推送。

## 实测结果

| 检查                                          | 本轮结果                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run typecheck`                           | 通过                                                                      |
| `npm run lint`                                | 通过，覆盖范围仍为 src/tests                                              |
| `npm run format:check`                        | 通过，按现有 glob 范围                                                    |
| `npm run build`                               | 通过：Vite 5.4.21，27 modules                                             |
| `npm run test -- --run`                       | 8 个文件，59/59 通过                                                      |
| 上轮 Q 独立检查                               | 原脚本未改，12/12 通过（上轮为 2 通过、10 失败）                          |
| 新增接口组合检查                              | 6 项：2 通过、4 失败，具体见 N2/N3/N5                                     |
| 将新增 contracts-consumer.ts 作为真实构建入口 | 失败，ENOENT：`src/contracts/index.ts/index.js`                           |
| Edge 桌面/手机视口状态页                      | 1280×800、390×844 加载及刷新通过，无 pageerror，模拟标识与 0.2.0 版本正确 |

浏览器检查使用 Edge 153.0.4234.32 headless；手机尺寸是模拟视口，不是真机。状态页仍显示 adapter_wired=false，没有 jsPsych 时间线或真实后端，不能检验完整实验、评分、断网保存与远程上传。独立测试使用已有依赖；未在全新环境执行 npm ci。端到端原目录仍无用例，本轮未重复执行空套件。

## 上轮问题逐项结案情况

| 原问题                   | 本轮判断                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| R1 payload 丢失          | 已修复该数据丢失和范围校验反例；payload 内容现在保留。公共 TS 类型仍为 payload: unknown，尚非可按 event_type 收窄的联合类型 |
| R2 建议/最终预测渠道缺失 | 已增加类型、方法、反馈 schema；仍有未揭示内容提前进入公共对象及流程/保存接口矛盾，见 N2/N4                                  |
| R3 回执矛盾              | 上轮反例通过；新增代码也覆盖集合去重、互斥和保存范围元数据                                                                  |
| R4 生产能力门槛          | 已把 persistentResults 加入门槛；但把生产准入规则混入通用声明解析，引入 LocalDemo 被拒绝的回归，见 N3                       |
| R5 配置运行时校验        | 负题量、虚假无真实资料标记的反例通过；不把这些通过扩大为所有配置组合已验证                                                  |
| R6 机器编号/位置重复     | 已修复；增加建议目标与机器映射校验                                                                                          |
| R7 导入/文档不一致       | TS 别名可编译，真实打包失败；文档仍未同步完成，见 N1/N6                                                                     |

## 尚需修正的接口集成问题

### N1 / P1：新增消费者只通过类型检查，实际无法打包

位置：`vite.config.ts:11`、`vitest.config.ts:9`、`src/experiment/contracts-consumer.ts`。

`@contracts` 被映射到单个文件 index.ts，且这条规则先匹配了 `@contracts/index.js` 的前缀，结果拼成 index.ts/index.js。普通 build 不包含这个未被页面引用的消费者，所以“typecheck/build 双重验证该消费者”的交接描述不成立。

实际错误：

```text
Could not load E:\Info_AI\projects\paper2-slot-prototype\src\contracts\index.ts/index.js
(imported by src/experiment/contracts-consumer.ts): ENOENT
```

修复与验收：A 统一入口写法。可用精确匹配的裸 @contracts 与明确的子路径规则，也可统一使用相对 barrel 路径；Vite/Vitest/TS 三者保持一致。实际 import 消费者并打包、执行一次，不能仅把它放在 tsconfig.include 中。无需更换工具链。

### N2 / P1：“未揭示建议”仍携带具体答案

位置：`src/contracts/trial-types.ts:37`、`src/contracts/validators.ts:126`。

PublicAdviceBlock 无论 revealed 的值都必须包含 advice_target_machine_id、位置和 copy。实测 revealed=false、copy='选择机器 B' 的 PublicTrial 被校验接受，返回对象仍带 B。A 的新交接还要求 advice_timing 非 none 时必须带此 block；照此实现，隐藏 UI 无法保证建议在指定时点前未进入浏览器。

这是契约信息边界的反例，当前没有真实后端，不声称已有被试提前看到答案。

修复与验收：未揭示状态只允许非内容元信息，或直接省略 advice；揭示后才能返回目标和文本。通过判别类型及 runtime schema 区分两种状态。测试序列应包含独立预测前的 loadTrial 不含建议内容、满足阶段条件后 loadAdvice 才有内容。LocalDemo 的本机完整材料和正式后端的信息边界应分别说明。

### N3 / P1：LocalDemo 的真实能力声明无法经过统一校验

位置：`src/contracts/validators.ts:446`。

capabilitiesSchema 的 superRefine 强制每个必需能力都为 supported。将当前 demo.json 的实际 capabilities 连同 provider/adapter_version 送入它，解析失败。通用接口原本需要合法表达 unsupported/unverified，供调用方决定允许演示、拒绝正式收集或提示不足。

修复与验收：把“声明格式是否有效”与“是否满足某种运行模式要求”分开。LocalDemo 的声明应正常解析，但正式准入检查返回 false；能力不足的真实后台同样可以被解析并报告原因，不能靠伪报 supported 绕过。现有 demo.json 的 individualEntryCodes=supported 也没有实现证据，应如实标注。

### N4 / P1：来源选择的新增写入方法破坏了统一回执，并留下流程顺序矛盾

位置：`src/contracts/interfaces.ts:47`、`src/contracts/interfaces.ts:53`、`src/contracts/trial-types.ts:37`、`tests/contracts/trial-feedback.spec.ts:17`。

recordSourceChoice 同时要求 choice 与 finalPrediction，返回 Promise<void>，没有稳定 event_id 或 SaveReceipt；与此同时 ResultStore 已通过 source_selected 事件承载这类写入。A 未定义哪个通路权威、哪个可重试、部分保存如何确认，C 无法沿用统一队列保证。

另外，PublicAdviceBlock 注释要求来源选择已记录后才揭示建议，而记录来源选择又要求最终预测。如果用户选择 AI，最终预测依赖尚未揭示的建议：两条约定不能直接组成所承诺的流程。

反馈样例把 feedback_presented 列为“释放反馈所需事件”，也会在按注释实现时出现先展示才可读取的循环。这是类型、注释和 fixture 的静态矛盾，尚无运行服务可复现死锁。

修复与验收：选定一条权威写入路径。建议通过带 ID 的 source_selected / final_prediction_submitted 等已定义事件及统一 SaveReceipt 完成；具体命名由 A 协调。来源选择与最终答案必须允许在不同阶段记录，不用伪造最终答案换取建议。明确独立预测、来源选择、建议展示、最终预测、反馈的顺序，反馈展示事件只能在读取/展示反馈后记录。

无需实现整个 G1，但 G0 应有一个最小 fake adapter/契约场景：通过公共方法和事件走完一题，覆盖重复请求同 ID、明确回执、以及“概率较高但实际未中奖仍算错”的固定反馈样例。期望值手写核对，不能每个对象各自合法就宣布流程成立。模拟验证不代表真实存储能力。

### N5 / P2：非试次页面的事件被错误要求绑定试次

位置：`src/contracts/envelopes.ts:88`、`src/contracts/validators.ts:296`。

comprehension_answered 与 visibility_changed 被无条件纳入 TRIAL_LEVEL_EVENTS。实测说明阶段的理解检查（已有 question_id）和同意页的页面不可见记录，都因没有 trial_id 被拒绝。这些页面出现在第一题之前，不应靠虚构 trial ID 才能记录。

修复与验收：按事件及实际阶段决定 trial_id 要求；预测等必需绑定真实试次，说明页理解检查使用 question_id，会话级可见性事件允许没有 trial_id。若有题内理解检查，可以另明确可选/必需规则。补正负例。

### N6 / P2：新报告仍有与文件不符的完成声明

位置：`docs/CONTRACTS.md:3`、A 第二轮交接 R7 段。

报告声称 CONTRACTS 已改为 0.2.0，但本轮实际读取仍为 DRAFT，方法表也没有 loadAdvice / recordSourceChoice。READY_FOR_REVIEW 本身是正确状态，问题是新接口入口和报告不一致。新报告也称“旧 src/contracts/index.js 导入仍可用”，却没有相应一致的打包验证。

修复与验收：同步当前方法、导出名称、事件字段、阶段顺序与 owner 规则；可以明确“0.2.x 候选、待复审”，不必提前写冻结完成。旧报告保留为历史，新报告只陈述实际结果。

## 可重复执行的证据

```powershell
# 项目根目录，原 59 项与上轮独立 12 项
npm run test -- --run
npm exec -- vitest run --config handoffs/Q/vitest.review.config.ts

# 本轮新增：当前 4 失败、2 通过
npm exec -- vitest run --config handoffs/Q/vitest.revision-review.config.ts

# 将 alias 消费者作为真正入口，write:false 不覆盖构建产物
node --input-type=module -e 'import { build } from "vite"; import path from "node:path"; try { await build({build:{write:false,rollupOptions:{input:path.resolve("src/experiment/contracts-consumer.ts")}}}); } catch(e) { console.error(e.message); process.exitCode=1; }'
```

- [本轮反例源文件](g0-revision-review.spec.ts)及[测试配置](vitest.revision-review.config.ts)。上轮 Q 反例未改动。
- [反例结果 JSON](../../artifacts/qa/g0-revision-review/contract-results.json)。
- [浏览器结果 JSON](../../artifacts/qa/g0-revision-review/browser-results.json)。
- [桌面截图](../../artifacts/qa/g0-revision-review/g0-1280.png)、[手机视口截图](../../artifacts/qa/g0-revision-review/g0-390.png)。
- 浏览器脚本只增加可选 REVIEW_OUTPUT_DIR，用于分目录保留两轮证据；断言未放宽。原截图及结果未覆盖。本轮 5197 测试服务检查后已停止。

## 下一轮派发给 A

```text
继续完成 G0 收尾，先读 handoffs/Q/2026-09-18-g0-revision-review.md。
已通过的 59+12 项保持通过；不要重构已验收部分，也不要改 Q 反例绕过失败。
本轮解决 N1-N6：真实 alias 构建、未揭示建议不含内容、能力声明/准入分离、
统一带事件 ID 和保存回执的写入通路、无 trial 页面事件、文档同步。
交付一个仅使用公共接口的一题完整 fake-adapter 流程样例，验证时序和回执；
这不是开始实现 G1 全部功能，也不是正式研究设计。
记录运行命令与结果，保存检查点后交 Q 复审。只落盘交付，不推送或部署。
```

本轮建议仍是保留现有工程基础，集中修正上述有限的接口集成问题。真正实验、后端和真机验收继续留在 G1—G3，不把它们提前当成 G0 阻塞。
