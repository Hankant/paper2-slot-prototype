# Paper 2：α 的存在、情境特异性与政策意义

我们不把“论文修改”和“自动驾驶”简单理解为 low stakes vs. high stakes，因为它们之间的差异远不止风险高低。更有价值的理论主张是：

> **α 确实存在，而且 α 具有情境特异性。**

也就是说，α 不是一个固定不变的“对 AI 的态度”，而是一个会随着 AI 所处决策情境变化的行为参数。可以写成：

\[
\alpha_{ic}
\]

其中 \(i\) 是个体，\(c\) 是情境。

## 研究的三层逻辑

### 1. 证明 α 存在

先用老虎机这种高度可控的任务，尽可能固定任务、准确率、错误后果等因素，验证即使 Human 和 AI 的客观表现相同，人们是否仍会对 AI error 赋予不同权重。

### 2. 证明 α 具有情境特异性

再把同样的测量逻辑放进不同 AI 应用情境，例如论文修改、自动驾驶、医疗诊断等，比较：

\[
\alpha_{\text{writing}},\quad
\alpha_{\text{driving}},\quad
\alpha_{\text{medical}}
\]

如果它们系统性不同，就说明 AI error tolerance 会随情境变化。

### 3. 把 α 用于政策判断

不同领域的 α 可以反映公众对 AI 错误的接受门槛。政策意义不在于简单地说“α 高，所以限制 AI”，而在于把公众的行为容忍度与 AI 的客观风险放在一起判断。

## 政策诊断矩阵

|  | 客观上 AI 风险较低 | 客观上 AI 风险较高 |
|---|---|---|
| **公众 α 很高：非常不容忍 AI** | 可能存在 **under-adoption / acceptance gap** | 谨慎态度可能合理 |
| **公众 α 很低：非常容忍 AI** | 可能促进合理 adoption | 可能存在 **over-reliance / automation risk** |

这个矩阵是 α 最直接的政策价值：它不是直接规定“应该接受多少 AI 风险”，而是帮助判断**公众实际容忍度与客观风险之间是否匹配**。

例如：

- **低客观风险 + 高 α**：公众可能过度排斥一个实际上表现良好的 AI，政策上可能需要更好的 performance disclosure、risk communication 或公众教育。
- **高客观风险 + 低 α**：公众可能过度依赖仍不够可靠的 AI，政策上可能需要 warning、human oversight、review 或其他保护机制。
- **不同场景的 α 系统性不同**：说明 one-size-fits-all 的 AI regulation 可能并不合适，更适合采用 differentiated / context-specific AI governance。

## 核心研究故事

> **We propose α as a behavioral measure of asymmetric AI error tolerance, test its existence under controlled conditions, examine its context specificity across AI applications, and use context-specific α profiles to inform differentiated AI governance.**

相比单纯研究“stakes 会不会改变 α”，这个框架更完整：它既关注 α 是否存在，也关注 α 是否具有跨情境差异，以及这种差异如何服务于差异化 AI 治理。
