# CLAUDE.md — 足彩预测辅助系统 v3 开发规范

## 项目概述

纯前端 PWA，浏览器打开即用，辅助分析竞彩足球赔率价值。
算法：衰减加权否决模型 + EV双重条件 + 亚盘五层信号 + 双重确认决策。

详细算法规格见 `资料.md`，实现计划见 `plan.md`。

---

## 技术栈约定

- **架构**：纯静态 PWA，无后端，无服务器
- **前端**：原生 HTML5 + Tailwind CSS CDN + Vanilla JavaScript
- **存储**：localStorage（浏览器本地）
- **图表**：Chart.js CDN（统计分析页）
- **离线**：PWA Service Worker
- **托管**：GitHub Pages（jj44whitegmn-dev/BHY-football）

> 原则：**零依赖安装，浏览器打开即用**。禁止引入需要 npm/node/pip 的依赖。

---

## 重要 UI 规范

**所有用户可见文字必须使用中文。**
包括：按钮、标签、字段名、提示语、错误信息、图表标注、决策输出等。
变量名、注释、HTML id/class 可以使用英文，但界面展示层全部中文。

---

## 文件结构规范

```
football/
├── index.html           # 单页应用（SPA）
├── manifest.json        # PWA 配置
├── sw.js                # Service Worker
├── js/
│   ├── config.js        # 全局常量（联赛平局率、阈值）
│   ├── veto.js          # 否决模型（衰减加权 W/D/L → 交锋概率 + 平局修正）
│   ├── ev.js            # EV 计算 + 安全边际双重条件
│   ├── asian.js         # 亚盘五层信号逻辑
│   ├── decision.js      # 双重确认决策引擎（含平局专项规则）
│   ├── storage.js       # localStorage CRUD（只做数据层）
│   ├── ui.js            # 页面渲染、事件绑定、模块调度
│   └── stats.js         # 统计分析（100场解锁）
├── css/
│   └── app.css          # Tailwind 补充样式
├── icons/               # PWA 图标
├── 资料.md              # 完整算法规格（只读参考）
├── plan.md              # 实现计划
└── CLAUDE.md            # 本文件
```

---

## 模块职责（严格边界）

```
config.js    ← 只存常量，不含逻辑
veto.js      ← 只做否决模型计算，返回概率对象，不操作 DOM/localStorage
ev.js        ← 只做 EV 计算和双重条件判断，返回结果对象
asian.js     ← 只做五层信号逻辑，返回信号对象，不操作 DOM
decision.js  ← 只做决策逻辑，不做 I/O，不操作 DOM
storage.js   ← 只做 localStorage CRUD，不含分析逻辑
ui.js        ← 调度层：渲染、绑定事件、调用各模块、调用 storage
stats.js     ← 只做统计计算，依赖 storage，不操作 DOM
```

- **veto.js / ev.js / asian.js / decision.js** 是纯函数模块，无副作用，无 DOM 操作
- **storage.js** 不调用任何分析模块
- **ui.js** 负责所有跨模块协调

---

## 否决模型规范（veto.js）

### 衰减加权公式
```javascript
// 最近一场权重最高（decay^0 = 1.0），最早一场最低
weights[i] = Math.pow(decay, n - 1 - i);
```

### 交锋概率（否决逻辑，不用泊松/Elo）
```javascript
P_home = P_H.win * (1 - P_A.win)
P_away = P_A.win * (1 - P_H.win)
P_draw = (P_H.draw + P_A.draw) / 2
// 三项归一化
```

### 平局修正（满足任意两条 → P_draw × 1.15，重归一化）
- 条件A：`Config.LEAGUE_DRAW_RATES[league] > 0.28`
- 条件B：主队近5场平局数 + 客队近5场平局数 ≥ 4
- 条件C：`|pinnacleHomeWater - pinnacleAwayWater| < 0.05`（用户提供，可跳过）

---

## EV 双重条件规范（ev.js）

```
有效价值：EV > 1.05  AND  gap > 0.06
弱价值：  EV > 1.05  OR   gap > 0.03
无价值：  以上均不满足

EV  = P_model × odds
gap = P_model - P_implied
```

---

## 亚盘五层信号规范（asian.js）

| 信号 | 正值（偏主）触发条件 | 负值（偏客）触发条件 | 阈值 |
|------|------|------|------|
| S1 平博重心 | 主水 - 客水 < -0.03 | 主水 - 客水 > +0.03 | 0.03 |
| S2 公司分歧 | 平博偏主且两家分歧 > 0.10 | 平博偏客且分歧显著 | 0.10 |
| S3 水位绝对差 | 主水比客水低 > 0.08 | 客水比主水低 > 0.08 | 0.08 |
| S4 盘口背离 | 盘口升但主水未降（庄不跟） | 盘口降但客水未降 | — |
| S5 降盘异常 | 降盘后回升偏主方向 | 降盘后回升偏客方向 | — |

---

## 决策规则规范（decision.js）

详细规则见 `资料.md` 模块五，关键逻辑：

```
主胜/客胜方向：
  ★★★ 强烈建议：双重条件 AND |asian| >= 2 AND 方向一致
  ★★  建议考虑：弱价值+|asian|>=1 OR 双重条件+|asian|==1
  ❌  信号冲突：有有效价值但亚盘方向相反
  ⚠️  仅亚盘：无数学价值但 |asian| >= 3
  —   无信号：以上均不满足

平局专项（EV最高项为平局时）：
  ★★★：双重条件 AND |asian| <= 1（市场无明确倾向）
  ★★ ：EV>1.05 AND |asian| <= 2
  ❌  ：EV最高为平局但 |asian| >= 3
```

---

## localStorage 数据结构

```javascript
// 分析记录
'ftb_records' → [{
  id, date, time, league, home_team, away_team,
  veto_inputs: {
    home_sequence, away_sequence, n, decay_factor,
    draw_correction_triggered, correction_conditions_met,
    pinnacle_home_water, pinnacle_away_water,
  },
  veto_output:  { p_home, p_draw, p_away },
  odds_input:   { home, draw, away },
  implied_prob: { home, draw, away },
  overround,
  ev:           { home, draw, away },
  gap:          { home, draw, away },
  asian_signals: { s1, s2, s3, s4, s5, total },
  decision,            // "★★★ 强烈建议：主胜"
  model_version,       // "v3"
  actual_result,       // "" | "主胜" | "平局" | "客胜"
  is_correct,          // null | true | false
  notes, createdAt,
}]

// 手动下注记录（账单页）
'ftb_bets' → [{ id, date, match_id, side, odds, stake, result, profit, createdAt }]

// 用户设置（覆盖 config.js 默认值）
'ftb_settings' → { ev_threshold, gap_strong, gap_weak, ... }
```

---

## 编码规范

### JavaScript
- 禁止使用 `alert()`，改用页面内 toast 提示
- 移动端：所有可点击元素最小高度 44px
- 纯函数模块（veto/ev/asian/decision）使用 `const Module = (() => { ... return { fn }; })()` 模式
- 禁止在纯函数模块中直接操作 DOM 或 localStorage

### HTML/CSS
- Tailwind CSS，移动端优先
- 颜色语义：绿色=主胜/盈利，红色=客胜/亏损，黄色=平局/待定，蓝色=操作按钮
- 底部固定导航：分析 / 记录 / 复盘 / 账单 / 设置

---

## 禁止事项

1. 禁止引入需要 npm install / pip install 的依赖
2. 禁止使用 React/Vue/Angular 等前端框架
3. 禁止任何后端代码
4. 禁止使用外部 API
5. 禁止将用户数据上传到任何服务器
6. 禁止 UI 中出现英文标签（变量名/注释除外）
7. 禁止在否决模型中使用泊松/Elo/任何黑箱模型——只用衰减加权 W/D/L
8. 禁止在 storage.js 中调用分析模块
9. 禁止在纯函数模块（veto/ev/asian/decision）中操作 DOM

---

## 运行方式

用户零配置：
1. 浏览器打开 GitHub Pages 网址（或直接打开 index.html）
2. 可选：点"添加到主屏幕"实现 PWA 离线使用
