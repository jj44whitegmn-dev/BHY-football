# 足彩预测辅助系统 v3 — 实现计划

> 规格依据：`资料.md`（v2.0）。算法细节以资料.md为准，本文件专注于实现路径、文件结构和开发顺序。

---

## 一、项目定位

纯前端 PWA，浏览器打开即用，辅助分析竞彩足球赔率价值。

**工作流：**
输入两队近期 W/D/L 战绩 → 输入体彩赔率 → EV 计算 → 逐条打分五层亚盘信号 → 双重确认决策 → localStorage 存档 → 赛后回填结果 → 100场后统计分析

**不是什么：** 量化黑箱、爬虫、串关计算器。

---

## 二、技术栈

- **架构**：纯静态 PWA，无后端，无服务器
- **前端**：原生 HTML5 + Tailwind CSS CDN + Vanilla JavaScript
- **存储**：localStorage（浏览器本地）
- **图表**：Chart.js CDN（统计分析页用）
- **离线**：PWA Service Worker
- **托管**：GitHub Pages（仓库：jj44whitegmn-dev/BHY-football）
- **禁止**：React/Vue/Angular，任何需要 npm/pip 的依赖

---

## 三、文件结构

```
football/
├── index.html           # 单页应用（SPA），五个页面区域
├── manifest.json        # PWA 配置
├── sw.js                # Service Worker（离线缓存）
├── js/
│   ├── config.js        # 全局常量（联赛平局率、EV阈值、信号阈值）
│   ├── veto.js          # 否决模型（衰减加权 W/D/L → 交锋概率 + 平局修正）
│   ├── ev.js            # EV 计算 + 安全边际双重条件
│   ├── asian.js         # 亚盘五层信号评分逻辑
│   ├── decision.js      # 双重确认决策引擎（含平局专项规则）
│   ├── storage.js       # localStorage CRUD（只做数据层）
│   ├── ui.js            # 页面渲染、表单交互、模块调度
│   └── stats.js         # 统计分析（100场解锁）
├── css/
│   └── app.css          # Tailwind 补充样式
├── icons/               # PWA 图标
├── 资料.md              # 完整规格说明（只读）
├── plan.md              # 本文件
└── CLAUDE.md            # 开发规范
```

---

## 四、页面结构（五页导航）

```
底部固定导航：分析 | 记录 | 复盘 | 账单 | 设置
```

### 分析页（核心）

分步向导式布局，一次完成一场比赛的完整分析：

```
步骤一：基本信息
  └─ 联赛（下拉选择）、主队、客队、比赛时间

步骤二：近期战绩（否决模型输入）
  └─ 主队近N场序列（如 W D L W W）
  └─ 客队近N场序列
  └─ [可选] 终盘亚盘主水/客水（用于平局修正条件C）
  └─ → 实时显示否决模型计算结果（三项概率 + 是否触发平局修正）

步骤三：体彩赔率
  └─ 主胜/平局/客胜 三个赔率
  └─ → 实时显示：抽水率、隐含概率、EV表格（✓/△/✗标注）

步骤四：亚盘五层信号
  └─ S1-S5 逐条显示说明，用户点击 +1 / 0 / -1 按钮选择
  └─ → 实时显示亚盘总分 + 方向解读

步骤五：分析结果（自动生成）
  └─ 否决模型概率 | EV分析表 | 亚盘信号 | 最终决策（★★★/★★/❌/⚠️/—）
  └─ [保存记录] 按钮
```

### 记录页

- 卡片列表，按日期降序
- 每张卡片：联赛 / 主队 vs 客队 / 决策结论 / 实际结果（未填时显示"待填"）
- 点击卡片展开完整分析详情
- 支持回填实际比赛结果

### 复盘页

- 统计分析（需100条完整记录）
- 未满100条时显示进度条 + 当前条数

### 账单页（轻量）

- 用户手动记录每次实际下注金额、赔率、是否中奖
- 汇总：总投入 / 总收益 / ROI / 月度趋势图

### 设置页

- 调整 config.js 中的阈值参数（EV门槛、概率差门槛等）
- 联赛平局率列表显示
- 数据导出（导出 JSON）/ 导入

---

## 五、核心算法模块

### veto.js — 否决模型

```javascript
// 衰减加权
function weightedProbs(sequence, decay = 0.8) {
  const n = sequence.length;
  let totalW = 0, wins = 0, draws = 0;
  sequence.forEach((r, i) => {
    const w = Math.pow(decay, n - 1 - i);
    totalW += w;
    if (r === 'W') wins += w;
    if (r === 'D') draws += w;
  });
  return { win: wins/totalW, draw: draws/totalW, loss: 1 - wins/totalW - draws/totalW };
}

// 交锋概率（否决逻辑）
P_home = P_H.win * (1 - P_A.win)
P_away = P_A.win * (1 - P_H.win)
P_draw = (P_H.draw + P_A.draw) / 2
// 归一化

// 平局修正（满足任意两条 → P_draw × 1.15，重归一化）
// 条件A：联赛平均平局率 > 0.28
// 条件B：主队近5场平局数 + 客队近5场平局数 >= 4
// 条件C：|终盘主水 - 客水| < 0.05（用户提供，可跳过）
```

### ev.js — EV计算

```javascript
// 隐含概率去水
const mu = 1 / (1/oHome + 1/oDraw + 1/oAway);
const pImplied = { home: mu/oHome, draw: mu/oDraw, away: mu/oAway };
const overround = (1/oHome + 1/oDraw + 1/oAway - 1) * 100;

// EV
const ev = { home: pModel.home * oHome, draw: pModel.draw * oDraw, away: pModel.away * oAway };
const gap = { home: pModel.home - pImplied.home, ... };

// 判断
// 有效价值：ev > 1.05 AND gap > 0.06
// 弱价值：  ev > 1.05 OR gap > 0.03
// 无价值：  以上均不满足
```

### asian.js — 亚盘五层信号

每个信号（S1-S5）独立函数，返回 +1 / 0 / -1 及说明文字。
UI 层显示说明，用户点选；asian.js 只做逻辑判断（用户也可手动覆盖）。

```javascript
// S1 平博重心方向
function s1(pinnacleHomeWater, pinnacleAwayWater) {
  const diff = pinnacleHomeWater - pinnacleAwayWater;
  if (diff < -0.03) return +1;   // 主水低 → 偏主
  if (diff > +0.03) return -1;   // 客水低 → 偏客
  return 0;
}
// S2-S5 同理
```

### decision.js — 双重确认决策

```javascript
// 正常方向（主胜/客胜）
// ★★★：双重条件 AND |asian| >= 2 AND 方向一致
// ★★ ：弱价值+|asian|>=1 OR 双重条件+|asian|==1
// ❌  ：有有效价值但亚盘方向相反
// ⚠️  ：无数学价值但 |asian| >= 3
// —  ：无信号

// 平局专项（当EV最高项为平局时）
// ★★★：双重条件 AND |asian| <= 1（市场无明确倾向）
// ★★ ：EV>1.05 AND |asian| <= 2
// ❌  ：EV最高为平局但 |asian| >= 3
```

---

## 六、localStorage 数据结构

```javascript
// 分析记录
'ftb_records' → [
  {
    id,
    date,               // "2026-03-26"
    time,               // "21:30"
    league,
    home_team,
    away_team,
    veto_inputs: {
      home_sequence,    // "W D L W W D W L W W"
      away_sequence,
      n,
      decay_factor,
      draw_correction_triggered,
      correction_conditions_met,  // ["A","B"]
      pinnacle_home_water,        // 可为 null
      pinnacle_away_water,
    },
    veto_output: { p_home, p_draw, p_away },
    odds_input:  { home, draw, away },
    implied_prob: { home, draw, away },
    overround,
    ev: { home, draw, away },
    gap: { home, draw, away },    // 单位：小数，如 0.083
    asian_signals: {
      s1, s2, s3, s4, s5,
      total,
      inputs_used,                // 'auto'|'manual'（用户是否手动覆盖）
    },
    decision,                     // "★★★ 强烈建议：主胜"
    model_version,                // "v3"
    actual_result,                // ""（待填）| "主胜"|"平局"|"客胜"
    is_correct,                   // null | true | false
    notes,
    createdAt,
  }
]

// 手动下注记录（账单页）
'ftb_bets' → [
  { id, date, match_id, side, odds, stake, result, profit, createdAt }
]

// 用户设置（覆盖 config.js 默认值）
'ftb_settings' → { ev_threshold, gap_strong, gap_weak, ... }
```

---

## 七、config.js 规范

```javascript
const Config = {
  // 联赛平均平局率
  LEAGUE_DRAW_RATES: {
    'J联赛': 0.30, '意甲': 0.28, '荷甲': 0.27,
    '英超': 0.25, '西甲': 0.25, '德甲': 0.24,
    '中超': 0.24, '澳超': 0.22, '其他': 0.25,
  },

  // EV 与概率差阈值
  EV_THRESHOLD:    1.05,
  GAP_STRONG:      0.06,
  GAP_WEAK:        0.03,

  // 亚盘信号阈值
  WATER_DIFF_S1:   0.03,   // S1 触发阈值
  WATER_DIFF_S2:   0.10,   // S2 公司分歧强阈值
  WATER_DIFF_S3:   0.08,   // S3 水位绝对差
  WATER_DIFF_DRAW: 0.05,   // 平局修正条件C

  // 平局修正参数
  DRAW_RATE_THRESHOLD:     0.28,
  DRAW_COUNT_THRESHOLD:    4,
  DRAW_CORRECTION_FACTOR:  1.15,

  // 决策阈值
  ASIAN_STRONG:   2,
  ASIAN_WEAK:     1,
  ASIAN_ONLY:     3,
  DRAW_ASIAN_STRONG: 1,
  DRAW_ASIAN_WEAK:   2,

  MODEL_VERSION: 'v3',
};
```

---

## 八、模块职责（严格边界）

```
config.js    ← 只存常量，不含逻辑
veto.js      ← 只做否决模型计算，返回概率对象，不操作 DOM/localStorage
ev.js        ← 只做 EV 计算和双重条件判断，返回结果对象
asian.js     ← 只做五层信号逻辑，返回信号对象，不操作 DOM
decision.js  ← 只做决策逻辑，不做 I/O，不操作 DOM
storage.js   ← 只做 localStorage CRUD，不含分析逻辑
ui.js        ← 调度层：渲染页面、绑定事件、调用各模块、调用 storage 保存
stats.js     ← 只做统计计算，不操作 localStorage
```

---

## 九、开发顺序

按依赖关系从底层到顶层：

1. `js/config.js` — 常量，无依赖
2. `js/veto.js` — 依赖 config
3. `js/ev.js` — 依赖 config
4. `js/asian.js` — 依赖 config
5. `js/decision.js` — 依赖 config
6. `js/storage.js` — 依赖 config
7. `js/stats.js` — 依赖 storage
8. `css/app.css` — 样式
9. `index.html` — 页面结构
10. `js/ui.js` — 最后写，调度所有模块
11. `manifest.json` + `sw.js` — PWA 配置

---

## 十、统计分析（stats.js，100场解锁）

**解锁条件**：`ftb_records` 中 `actual_result` 非空的记录 ≥ 100 条。

**统计内容：**
1. 总体命中率（decision 推荐方向 vs actual_result）
2. 各决策等级（★★★ / ★★）的实际命中率 vs 预期EV
3. 各亚盘信号（S1-S5）的独立预测准确率
4. 各联赛的模型校准（模型说X%，实际是多少%）
5. 平局修正触发 vs 未触发的实际平局率对比
6. EV阈值建议（基于实际数据推荐最优门槛）

未满100条时：显示进度条 + `当前 N / 100 条`

---

## 十一、亚盘信号 UI 设计

每个信号显示：
1. 信号名称和说明文字（中文，告诉用户该看什么）
2. 可选择的三个按钮：`+1（偏主）` `0（中性）` `-1（偏客）`
3. 选中后高亮，未选时灰色

示例（S1）：
```
平博终盘重心方向
查看平博终盘主水与客水，判断资金重心偏向哪方。
主水 < 客水（差 > 0.03）→ 偏主 → +1
主水 ≈ 客水（差 ≤ 0.03）→ 中性 → 0
主水 > 客水（差 > 0.03）→ 偏客 → -1

[+1 偏主]  [0 中性]  [-1 偏客]
```

用户也可以直接输入平博主水/客水数值，系统自动计算 S1/S3。

---

## 十二、错误处理

- 用户输入无效数值：即时验证，红色提示，不允许提交
- localStorage 满：提示用户导出数据后清理旧记录
- 禁止使用 `alert()`，改用页面内 toast 提示
