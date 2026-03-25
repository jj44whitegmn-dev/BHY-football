# 足彩预测工具 — 最终设计说明 v3.2

---

## 一、模块职责与依赖关系（最终确认）

```
engine.js   ← 只做分析，无外部依赖
   ↑
ui.js       ← 调度层，调用 engine + storage，处理所有协调逻辑
   ↑
storage.js  ← 只做 CRUD / 迁移，无 engine 依赖
```

### storage.js 职责边界
- 只负责 localStorage 的读写、CRUD、数据迁移
- setResult() 只保存比赛结果字段，**不调用 engine，不调用 Model**
- 不关心分析逻辑

### engine.js 职责边界
- 只接受一个比赛原始数据对象，返回完整分析对象
- 不读写 localStorage
- 不依赖 storage.js、model.js、ui.js

### ui.js 职责边界
- 提交新比赛时：先调 engine.analyze()，再调 storage.Matches.save()
- 录入结果时：先调 storage.Matches.setResult()，再做串关结算
- 所有跨模块协调由 ui.js 负责

---

## 二、盘口符号规范（全局统一）

```
负数 = 主队让球（主队是热门）
正数 = 客队让球（主队是黑马）
零  = 平手盘

示例：
  ah_open_line  = -0.5  → 主让半球
  ah_close_line = -1.0  → 主让一球（热门强度增强）
  ctf_hdc_line  = +0.5  → 客让半球（主队受让）
```

亚盘（ah_*）与体彩让球（ctf_hdc_line）使用**完全相同的符号体系**，不需转换。

---

## 三、路径标签枚举（固定，不可自由输入）

```javascript
const AH_PATH_LABELS = [
  'AH_单边强化主队',
  'AH_单边强化客队',
  'AH_中途试探后回撤',
  'AH_来回摇摆',
  'AH_临场突然强化主队',
  'AH_临场突然强化客队',
  'AH_基本不动',
];

const EU_PATH_LABELS = [
  'EU_主胜持续压低',
  'EU_客胜持续压低',
  'EU_平赔持续压低',
  'EU_早盘动后面不动',
  'EU_临场突然压低主胜',
  'EU_临场突然压低客胜',
  'EU_三项无明显趋势',
];
```

---

## 四、配置三层结构（config.js）

```javascript
// 第一层：阈值（什么情况触发规则）
const THRESHOLDS = {
  概率差_弱: 0.03,
  概率差_强: 0.06,
  欧赔变化_轻微: 0.03,
  欧赔变化_明显: 0.06,
  欧赔变化_显著: 0.10,
  亚盘盘口变化: 0.25,        // 半个球视为有意义升/降盘
  亚盘水位变化: 0.05,
  热门过热_欧赔上限: 1.55,   // 欧赔低于此视为热门
  热门过热_亚盘深度: 1.25,   // 亚盘让球绝对值超此视为深盘
  价值提示_弱: 0.03,         // ctf_eu_diff 绝对值超此 → 弱价值提示
  价值提示_强: 0.06,         // 超此 → 强价值提示
};

// 第二层：权重（触发后加减多少分，小整数）
const WEIGHTS = {
  欧赔压低_显著: 5,
  欧赔压低_明显: 3,
  欧赔压低_轻微: 1,
  亚盘盘口变化: 6,
  亚盘水位变化: 2,
  一致性奖励: 4,
  体彩欧赔差异: 2,
  体彩让球确认: 3,
  临场确认: 3,
  平局增强: 4,
  // 负向（作用于对应方向或质量分）
  不一致惩罚: -6,       // 质量分
  试探失败惩罚: -3,     // 对应方向
  噪音惩罚: -8,         // 质量分
  热门过热惩罚: -5,     // 质量分
  让球不一致惩罚: -4,   // 质量分
};

// 第三层：分级（把得分转化为决策）
const GRADING = {
  甲级_得分: 12,
  甲级_差距: 6,
  甲级_质量: 65,
  乙级_得分: 7,
  乙级_差距: 3,
  乙级_质量: 50,
  最低得分_展示: 3,
  本金: 1000,
  甲级_仓位比例: 0.005,
  乙级_仓位比例: 0.002,
  // 风险分级阈值
  风险_低上限: 25,
  风险_中上限: 50,
};
```

---

## 五、分析对象完整结构（engine.js 输出）

### 5.1 概率层

```javascript
ctf_nv:      { home, draw, away },    // 体彩去水概率
eu_open_nv:  { home, draw, away },
eu_close_nv: { home, draw, away },
```

### 5.2 体彩 vs 欧赔价值层（修正符号含义）

```javascript
// ctf_eu_diff = ctf_nv - eu_close_nv
// 负值 = 体彩该方向赔率更高（更甜），正值 = 欧赔该方向赔率更高
ctf_eu_diff: { home, draw, away },

// 价值提示（更直观的衍生字段）
value_hint_side: '主胜' | '平局' | '客胜' | null,   // 哪个方向体彩相对更甜
value_hint_strength: '强' | '弱' | '无',            // 甜度强度
// 判断逻辑：找 ctf_eu_diff 中绝对值最大的负值项
// 若最大绝对值 < 价值提示_弱阈值 → '无'
// < 价值提示_强阈值 → '弱'
// ≥ 价值提示_强阈值 → '强'
```

### 5.3 欧赔变化层

```javascript
eu_change: { home, draw, away },
// eu_change.x = (open - close) / open，正值=压低，负值=抬高

eu_direction: {
  home: '压低' | '抬高' | '稳定',
  draw: ...,
  away: ...,
},
eu_strongest_move: '主胜' | '平局' | '客胜' | null,  // 变化幅度最大的方向
```

### 5.4 亚盘分析层（封装函数，不直接用 delta 判断）

```javascript
// 开盘热门分析
ah_open_analysis: {
  favorite: '主队' | '客队' | '平手',  // 开盘热门方
  line: -0.5,
  water_balance: '主队降水' | '客队降水' | '持平',
},

// 终盘热门分析
ah_close_analysis: {
  favorite: '主队' | '客队' | '平手',
  line: -1.0,
  water_balance: '主队降水' | '客队降水' | '持平',
},

// 变化分析（综合解读，不依赖 delta 直接判断）
ah_change: {
  line_delta: -0.5,                        // close_line - open_line
  favorite_changed: false,                 // 热门方是否换边（跨零）
  home_strength: '增强' | '减弱' | '稳定', // 主队热门程度
  away_strength: '增强' | '减弱' | '稳定', // 客队热门程度
  interpretation: '主队升盘半球，主队热门程度增强',  // 人类可读解释
},

// 中盘数据（如有）
ah_mid_analysis: {
  has_data: true | false,
  probe_up_then_back: false,    // 曾升盘后回撤
  late_confirm: false,          // 终盘进一步强化
},
```

亚盘方向判断函数规则：
```
who_is_favorite(line):
  line < 0  → '主队'（主让，主队热门）
  line > 0  → '客队'（主受让，客队热门）
  line == 0 → '平手'

home_strength_change(open_line, close_line):
  // 主队热门程度变化
  if open_line < 0 and close_line < open_line → '增强'（主队让更多）
  if open_line > 0 and close_line < open_line → '增强'（从受让变为让球）
  if open_line < 0 and close_line > open_line → '减弱'（主队让少了）
  if open_line > 0 and close_line > open_line → '减弱'（受让更多）
  else → '稳定'
  // 跨零特殊处理：open > 0 且 close < 0 → 热门换边，打 favorite_changed = true
```

### 5.5 体彩让球分析层

```javascript
ctf_hdc_analysis: {
  ctf_favorite: '主队' | '客队' | '平手',  // 体彩让球热门方
  ah_favorite:  '主队' | '客队' | '平手',  // 亚盘热门方（终盘）
  direction_consistent: true | false,      // 两者方向是否一致

  // 赢球不穿盘风险
  // 触发条件：欧赔/亚盘信号支持某队赢球，
  //           但该队让球盘口绝对值 ≥ 1.0（需赢球且赢球数超过让球数才算赢串）
  cover_risk: true | false,
  cover_risk_detail: '主队让球1球以上，若仅赢一球则让球盘算平局/负',

  ctf_1x2_vs_hdc: {
    consistent: true | false,             // 体彩胜平负热门 vs 让球热门是否一致
    detail: '体彩胜平负主队赔率最低，让球盘主让1球，方向一致',
  },
},
```

### 5.6 rules_hit 明细（完整格式）

```javascript
rules_hit: [
  {
    rule_id: 'B1',
    rule_name: '欧赔显著压低主胜',
    side: '主胜',               // '主胜'|'平局'|'客胜'|'质量分'
    score_delta: +5,
    threshold_used: 0.10,       // 触发所用阈值（来自 config）
    actual_value: 0.127,        // 实际测量值
    reason: '主胜欧赔从2.10降至1.84，变化幅度12.4%，超过显著阈值10%',
  },
  // ...
],
```

### 5.7 得分与质量层

```javascript
// 方向得分（小整数，约 -20 到 +20）
home_score: 0,
draw_score: 0,
away_score: 0,

// 质量分（0-100，做钳制）
quality_score: 100,

// 质量分扣减来源（可追溯）
quality_breakdown: [
  { source: '规则D_盘口赔率不一致', delta: -6, detail: '欧赔支持主队，亚盘支持客队' },
  { source: '规则I_来回摇摆', delta: -8, detail: '路径标签：AH_来回摇摆' },
],
// quality_score = clamp(100 + sum(quality_breakdown.map(x=>x.delta)), 0, 100)
```

### 5.8 风险分层（有显式生成规则，不拍脑袋）

```javascript
// risk_score：0-100，由以下条件累加
risk_score: 0,

risk_breakdown: [
  { source: '质量分低于50', delta: +20, detail: '当前质量分45' },
  { source: '市场噪音高', delta: +15, detail: '存在来回摇摆标记' },
],

// 生成规则：
// quality_score < 50  → risk_score + 20
// quality_score < 35  → risk_score + 15（叠加）
// market_type_primary ∈ {高噪音结构, 试探失败, 盘口赔率不一致} → +20
// 热门过热                                                       → +15
// ctf_cover_risk = true                                          → +10
// favorite_changed（热门换边）                                    → +10
// risk_score 钳制在 0-100

// 风险等级（由 risk_score 决定，不主观判断）
risk_level: '低' | '中' | '高',
// 低：risk_score ≤ 25
// 中：risk_score ≤ 50
// 高：risk_score > 50
```

### 5.9 市场类型（两层）

```javascript
market_type_primary: '主队一致强化',   // 9选1
market_type_secondary: ['临场资金流入主队', '让球与亚盘一致'],  // 可多选
```

**主标签 9 种（互斥，按优先级判断）：**
1. 高噪音结构（quality_score < 30）
2. 低价值不碰（质量和得分均不足）
3. 热门过热（热门赔率无价值）
4. 盘口赔率不一致（欧赔和亚盘方向明显相悖）
5. 试探失败（中途强化后回撤）
6. 临场确认（终盘进一步确认）
7. 平局增强（平赔下调且双方无明显强化）
8. 主队一致强化
9. 客队一致强化

**副标签 10 种（可多选）：**
体彩偏甜主胜 / 体彩偏甜平局 / 体彩偏甜客胜 /
赢球不穿盘风险 / 让球与亚盘一致 / 让球与亚盘相悖 /
欧赔早动后稳 / 临场资金流入主队 / 临场资金流入客队 / 平赔持续下调

### 5.10 决策输出（方向倾向与下注建议分离）

```javascript
// 方向倾向（即使不建议下注也可以有方向倾向）
suggested_side: '主胜' | '平局' | '客胜' | null,
lean_reason: '亚盘升盘支持主队，但终赔价值不足',

// 是否建议下注（独立判断，不与 suggested_side 绑定）
whether_to_bet: true | false,
no_bet_reason: '热门赔率过低，期望值为负',  // 不建议下注时说明原因

// 等级（综合判断）
confidence_grade: '甲级' | '乙级' | '丙级',

// 风险等级（由 risk_score 决定）
risk_level: '低' | '中' | '高',

// 仓位建议（whether_to_bet = false 时强制为 0）
stake_suggestion: 0,

// 快照保护
snapshot_version: '3.2',
snapshot_at: 'ISO时间',
snapshot_config: { ...config完整副本 },
```

**decided_side vs whether_to_bet 的四种组合：**
```
suggested_side = '主胜', whether_to_bet = true   → 主胜可考虑（甲/乙级）
suggested_side = '主胜', whether_to_bet = false  → 信号倾向主胜但建议放弃
suggested_side = null,   whether_to_bet = false  → 不碰，无方向倾向
suggested_side = null,   whether_to_bet = true   → 不会出现（无方向不建议下注）
```

---

## 六、规则引擎流程

```
输入：match 原始数据对象

步骤1：计算概率层
  → ctf_nv, eu_open_nv, eu_close_nv

步骤2：计算 ctf_eu_diff 和价值提示
  → ctf_eu_diff, value_hint_side, value_hint_strength

步骤3：计算欧赔变化
  → eu_change, eu_direction, eu_strongest_move

步骤4：封装亚盘分析（用函数，不用 delta 直判）
  → ah_open_analysis, ah_close_analysis, ah_change, ah_mid_analysis

步骤5：体彩让球分析
  → ctf_hdc_analysis

步骤6：运行规则组 A-K，写入 rules_hit
  → home_score, draw_score, away_score
  → quality_breakdown（每次扣分追加）

步骤7：计算 quality_score = clamp(100 + sum(quality_breakdown), 0, 100)

步骤8：计算 risk_score 和 risk_level
  → risk_breakdown, risk_score, risk_level

步骤9：确定市场类型（按优先级）
  → market_type_primary, market_type_secondary

步骤10：生成决策
  → suggested_side, lean_reason
  → whether_to_bet, no_bet_reason
  → confidence_grade, stake_suggestion

步骤11：写入快照元数据
  → snapshot_version, snapshot_at, snapshot_config

输出：完整 analysis 对象
```

---

## 七、比赛完整字段（storage 层使用）

```javascript
{
  id, match_date, competition, home_team, away_team, createdAt,

  // 体彩（必填）
  ctf_home_odds, ctf_draw_odds, ctf_away_odds,
  ctf_hdc_line, ctf_hdc_home_odds, ctf_hdc_draw_odds, ctf_hdc_away_odds,

  // 欧赔（必填）
  eu_open_home, eu_open_draw, eu_open_away,
  eu_close_home, eu_close_draw, eu_close_away,

  // 亚盘（初盘+终盘必填，中盘可选）
  ah_open_line, ah_open_home_odds, ah_open_away_odds,
  ah_mid_line, ah_mid_home_odds, ah_mid_away_odds,
  ah_close_line, ah_close_home_odds, ah_close_away_odds,

  // 路径标签（固定枚举，无中盘时建议填）
  ah_path_label,   // AH_XXX 之一，或 null
  eu_path_label,   // EU_XXX 之一，或 null

  // 近五场（完全可选，折叠区）
  home_recent_w, home_recent_d, home_recent_l,
  home_recent_gf, home_recent_ga,
  away_recent_w, away_recent_d, away_recent_l,
  away_recent_gf, away_recent_ga,

  // 大小球预留字段（第二阶段，暂为 null）
  ou_line, ou_over_odds, ou_under_odds,

  // 引擎分析快照（ui.js 调用 engine 后写入，storage 不感知内容）
  analysis: { ... },

  // 赛后（storage.setResult 只写这些，不调用 engine）
  result_home_goals, result_away_goals,
  result_1x2,          // ui.js 计算后传入
  user_bet_side,
  user_bet_odds,
  user_stake,
  profit_loss,         // ui.js 计算后传入
  resultAt,
}
```

---

## 八、页面结构

### 导航（全中文）
```
分析 | 串关 | 记录 | 账单 | 复盘
```

### 录入浮层（分区，减少负担）
```
区域一（必填）：基本信息
区域二（必填）：体彩胜平负 + 让球胜平负
区域三（必填）：欧赔初盘 + 终盘
区域四（必填）：亚盘初盘 + 终盘（中盘可选）
区域五（建议）：路径标签（无中盘时出现提示）
区域六（折叠）：近五场辅助信息
```

### 复盘页（两视角切换）
- **系统推荐视角**：验证引擎，按 suggested_side / whether_to_bet / confidence_grade 统计
- **实际下注视角**：追踪资金，按 user_bet_side / user_stake / profit_loss 统计

---

## 九、文件写入顺序

1. `js/config.js`
2. `js/engine.js`
3. `js/storage.js`
4. `js/ui.js`
5. `index.html`
