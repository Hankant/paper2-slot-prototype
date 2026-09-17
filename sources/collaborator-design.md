# α 的三项实验设计：老虎机、AI 修改论文、自动驾驶

## 统一符号说明

| 符号 | 含义 |
|---|---|
| \(h\) | Human |
| \(a\) | AI |
| \(i\) | 第 \(i\) 个被试 |
| \(slot\) | 娱乐老虎机情境 |
| \(writing\) | AI 修改论文情境 |
| \(driving\) | 自动驾驶情境 |
| \(q\) | Accuracy，正确率 |
| \(e\) | Error rate，错误率 |
| \(q_{h,i}^{slot}\) | 被试 \(i\) 在老虎机任务中的个人 Human accuracy |
| \(e_{h,i}^{slot}\) | 被试 \(i\) 在老虎机任务中的个人 Human error rate |
| \(q_{a,i}^{*}\) | 被试 \(i\) 的 AI acceptance threshold，即预测采纳概率达到 50% 时的 AI accuracy |
| \(e_{a,i}^{*}\) | 被试 \(i\) 在 threshold 上对应的 AI error rate |
| \(\alpha_i^{slot}\) | 被试 \(i\) 在老虎机情境中的 α |
| \(\bar q_h^{slot}\) | Pilot sample 在老虎机任务中的平均 Human accuracy，用于设置正式实验的 AI accuracy levels |

同理：

\[
q_{h,i}^{writing},\quad \alpha_i^{writing}
\]

分别表示被试 \(i\) 在论文修改情境中的 Human accuracy 和 α。

---

# Experiment 1：老虎机

| 项目 | 设计 |
|---|---|
| **IV1** | Accuracy Disclosure：Disclosed / Not disclosed |
| **IV2** | Stakes：Low / High |
| **Threshold elicitation factor** | AI accuracy：根据 pilot 的 \(\bar q_h^{slot}\)，设置 \(-15,-5,+5,+15\) percentage points |
| **DV** | 是否采纳 AI：0 = 坚持自己；1 = 采纳 AI |
| **Human benchmark** | \(q_{h,i}^{slot}=\frac{\text{calibration正确题数}}{\text{总题数}}\) |
| **Human error rate** | \(e_{h,i}^{slot}=1-q_{h,i}^{slot}\) |
| **Acceptance threshold** | \(P(\text{Adopt AI})=0.5\) 时对应 \(q_{a,i}^{*}\) |
| **AI error threshold** | \(e_{a,i}^{*}=1-q_{a,i}^{*}\) |
| **α** | \(\displaystyle \alpha_i^{slot}=\frac{e_{h,i}^{slot}}{e_{a,i}^{*}}-1\) |
| **Covariate** | Self-confidence：每次独立判断后的 0–100 信心评分 |
| **控制变量** | 中奖概率、历史结果序列、trial 数量、AI建议形式、题目难度、四档 AI accuracy |

## 分组

|  | Low Stakes | High Stakes |
|---|---|---|
| **Disclosed** | G1 | G2 |
| **Not disclosed** | G3 | G4 |

Low：正确 +¥0.20，错误 −¥0.20。  
High：正确 +¥2.00，错误 −¥2.00。

## 流程

```text
Pilot
↓
得到平均 Human accuracy：q̄_h^slot
↓
确定四档 AI accuracy
↓
正式实验：无 AI calibration
↓
得到个人 q_h,i^slot 和 e_h,i^slot
↓
随机分配
├─ G1：Disclosed × Low Stakes
├─ G2：Disclosed × High Stakes
├─ G3：Not disclosed × Low Stakes
└─ G4：Not disclosed × High Stakes
↓
观察老虎机历史结果
↓
自己先判断
↓
报告 confidence
↓
看到 AI 建议
↓
坚持自己 / 采纳 AI
↓
重复四档 AI accuracy
↓
估计 q_a,i*
↓
计算 e_a,i*
↓
计算 α_i^slot
```

## 预测

\[
H1:\alpha^{slot}\neq0
\]

\[
H2:|\alpha_{NotDisclosed}|>|\alpha_{Disclosed}|
\]

\[
H3:\alpha_{HighStakes}>\alpha_{LowStakes}
\]

---

# Experiment 2：AI 修改论文

| 项目 | 设计 |
|---|---|
| **IV1** | Accuracy Disclosure：Disclosed / Not disclosed |
| **IV2** | Stakes：Low / High |
| **Threshold elicitation factor** | AI accuracy：根据 \(\bar q_h^{writing}\) 设置 \(-15,-5,+5,+15\) percentage points |
| **DV** | 是否采纳 AI 修改建议：0 / 1 |
| **Human benchmark** | \(q_{h,i}^{writing}=\frac{\text{calibration正确题数}}{\text{总题数}}\) |
| **Human error rate** | \(e_{h,i}^{writing}=1-q_{h,i}^{writing}\) |
| **Acceptance threshold** | \(P(\text{Adopt AI})=0.5\) 对应 \(q_{a,i}^{*}\) |
| **AI error threshold** | \(e_{a,i}^{*}=1-q_{a,i}^{*}\) |
| **α** | \(\displaystyle \alpha_i^{writing}=\frac{e_{h,i}^{writing}}{e_{a,i}^{*}}-1\) |
| **Covariate** | Self-confidence：0–100 |
| **控制变量** | 文本长度、错误类型、题目难度、选项数量、AI建议格式、trial 数量 |

## 分组

|  | Low Stakes | High Stakes |
|---|---|---|
| **Disclosed** | G1 | G2 |
| **Not disclosed** | G3 | G4 |

## 流程

```text
Writing Pilot
↓
得到 q̄_h^writing
↓
确定四档 AI accuracy
↓
正式实验：无 AI calibration
↓
得到 q_h,i^writing 和 e_h,i^writing
↓
随机分配至 G1 / G2 / G3 / G4
↓
呈现论文修改题
↓
被试先独立作答
↓
报告 confidence
↓
呈现 AI 修改建议
↓
坚持自己 / 采纳 AI
↓
重复四档 AI accuracy
↓
q_a,i*
↓
e_a,i*
↓
α_i^writing
```

## 预测

\[
H4:\alpha^{writing}\neq0
\]

并复制 Disclosure 与 Stakes 的效应预测。

---

# Experiment 3：自动驾驶

| 项目 | 设计 |
|---|---|
| **IV1** | Accuracy Disclosure：Disclosed / Not disclosed |
| **IV2** | Stakes：Low / High |
| **Threshold elicitation factor** | AI accuracy：根据 \(\bar q_h^{driving}\) 设置 \(-15,-5,+5,+15\) percentage points |
| **DV** | 是否采纳 AI 驾驶建议：0 / 1 |
| **Human benchmark** | \(q_{h,i}^{driving}=\frac{\text{calibration正确题数}}{\text{总题数}}\) |
| **Human error rate** | \(e_{h,i}^{driving}=1-q_{h,i}^{driving}\) |
| **Acceptance threshold** | \(P(\text{Adopt AI})=0.5\) 对应 \(q_{a,i}^{*}\) |
| **AI error threshold** | \(e_{a,i}^{*}=1-q_{a,i}^{*}\) |
| **α** | \(\displaystyle \alpha_i^{driving}=\frac{e_{h,i}^{driving}}{e_{a,i}^{*}}-1\) |
| **Covariate** | Self-confidence：0–100 |
| **控制变量** | 驾驶场景难度、车辆速度、视频长度、决策选项、AI建议格式、trial 数量 |

## 分组

|  | Low Stakes | High Stakes |
|---|---|---|
| **Disclosed** | G1 | G2 |
| **Not disclosed** | G3 | G4 |

## 流程

```text
Driving Pilot
↓
得到 q̄_h^driving
↓
确定四档 AI accuracy
↓
正式实验：无 AI calibration
↓
得到 q_h,i^driving 和 e_h,i^driving
↓
随机分配至 G1 / G2 / G3 / G4
↓
观看驾驶情境
↓
自己先做驾驶决策
↓
报告 confidence
↓
呈现 AI 驾驶建议
↓
坚持自己 / 采纳 AI
↓
重复四档 AI accuracy
↓
q_a,i*
↓
e_a,i*
↓
α_i^driving
```

# 跨情境核心预测

\[
\boxed{
\alpha^{slot},\alpha^{writing},\alpha^{driving}\neq0
}
\]

并且：

\[
\boxed{
\alpha^{slot},\alpha^{writing},\alpha^{driving}
\text{存在系统性差异}
}
\]

即核心判断：

\[
\boxed{\alpha\text{ exists and is context-specific}}
\]
