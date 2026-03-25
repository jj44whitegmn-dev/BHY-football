# CLAUDE.md — 足球彩票预测工具 开发规范

## 项目概述

本项目是一个运行在本地的足球比赛预测 Web 工具，服务于中国体育彩票串关玩法。
用户在手机浏览器通过 GitHub Pages 访问，支持 PWA 离线使用。

详细规划见 `plan.md`。

---

## 技术栈约定

- **架构**：纯前端静态 PWA，无后端，无服务器
- **数据存储**：localStorage（手机本地，无数据库）
- **前端**：原生 HTML5 + Tailwind CSS CDN + Vanilla JavaScript（禁止引入 React/Vue/Angular）
- **图表**：Chart.js CDN
- **核心引擎**：规则引擎 + 打分系统（js/engine.js），透明可解释，无黑箱
- **离线能力**：PWA Service Worker
- **托管**：GitHub Pages（免费静态托管）

> 原则：**零依赖安装，手机打开即用**。不得引入需要 npm/node/Python 的依赖。

---

## 重要 UI 规范

**所有用户可见文字必须使用中文。**
包括：按钮、标签、字段名、提示语、错误信息、图表标注、状态标签、建议文字等。
变量名、注释、HTML id/class 可以使用英文，但界面展示层全部中文。

---

## 文件结构规范

```
football/
├── index.html          # 主页面（单页应用，SPA）
├── manifest.json       # PWA 配置
├── sw.js               # Service Worker（离线缓存）
├── js/
│   ├── config.js       # 三层配置（阈值/权重/分级），全局可调
│   ├── engine.js       # 规则引擎核心（A-K 规则组）
│   ├── storage.js      # localStorage 数据层（所有读写操作）
│   ├── ui.js           # 界面渲染与交互
│   ├── parlay.js       # 串关计算（中国体彩规则）
│   └── model.js        # 旧版 Elo+泊松模型（保留但不调用，仅备用）
├── css/
│   └── app.css         # 自定义样式（Tailwind 补充）
├── icons/              # PWA 图标（192x192, 512x512）
├── plan.md             # 项目规划文档（v3.1）
├── 资料.md             # 研究资料（只读参考）
└── CLAUDE.md           # 本文件
```

---

## 盘口符号规范（全局统一）

```
负数 = 主队让球（主队是热门）
正数 = 客队让球（主队是黑马，受让）
示例：
  ah_open_line = -0.5   → 主让半球
  ah_close_line = -1.0  → 主让一球
  ctf_hdc_line = +0.5   → 客让半球（主队受让）
```

此规范适用于亚盘（ah_*）和体彩让球（ctf_hdc_line），二者使用相同符号体系。

---

## 路径标签枚举（固定，不可自由输入）

**亚盘路径（ah_path_label）**
```
AH_单边强化主队 / AH_单边强化客队 / AH_中途试探后回撤
AH_来回摇摆 / AH_临场突然强化主队 / AH_临场突然强化客队 / AH_基本不动
```

**欧赔路径（eu_path_label）**
```
EU_主胜持续压低 / EU_客胜持续压低 / EU_平赔持续压低
EU_早盘动后面不动 / EU_临场突然压低主胜 / EU_临场突然压低客胜 / EU_三项无明显趋势
```

---

## 模块职责（严格边界）

```
engine.js   ← 只做分析，无外部依赖
ui.js       ← 调度层，调用 engine + storage，处理所有协调逻辑
storage.js  ← 只做 CRUD / 迁移，不依赖 engine
```

- **storage.js** 的 setResult() 只保存原始结果字段，不调用 engine
- **engine.js** 不读写 localStorage，不依赖任何其他模块
- **ui.js** 负责：调 engine → 调 storage 保存；调 storage 取结果 → 更新串关结算

---

## 核心引擎规范（engine.js）

### 评分机制
- 主胜/平局/客胜 三个方向独立打分，初始为 0，范围约 -20 到 +20
- 单条规则最多加减 6 分（由 config weights 层控制）
- quality_score：初始 100，做 clamp(0,100)，通过 quality_breakdown 追踪每次扣减
- risk_score：0-100，由显式条件累加，钳制 0-100，生成 risk_level

### 规则组（A-K）
A：体彩 vs 欧赔价值差异 | B：欧赔压低（三档）| C：亚盘强化
D：盘口赔率一致性 | E：赔率盘口分歧 | F：热门过热
G：试探失败 | H：临场确认 | I：噪音高 | J：平局增强 | K：体彩让球

### 亚盘方向判断（封装函数，不直接用 delta）
- line < 0 → 主队热门；line > 0 → 客队热门；line == 0 → 平手
- 需处理：跨零换边、受让盘、平手盘特殊情况
- 输出 ah_open_analysis / ah_close_analysis / ah_change.interpretation

### ctf_eu_diff 符号规范
- ctf_eu_diff = ctf_nv - eu_close_nv
- **负值 = 体彩该方向赔率更高（更甜）**，正值 = 欧赔该方向更高
- 衍生字段：value_hint_side（哪方向体彩更甜）、value_hint_strength（强/弱/无）

### suggested_side 与 whether_to_bet 分离
- suggested_side：市场信号的方向倾向，即使不建议下注也可以有
- whether_to_bet：独立判断，综合等级/质量/风险/热门后决定
- 四种组合中"无方向但建议下注"不会出现

### rules_hit 格式（必须完整记录 7 个字段）
```javascript
{
  rule_id: 'B1',
  rule_name: '欧赔显著压低主胜',
  side: '主胜',           // 或 '质量分' / '风险分'
  score_delta: +5,
  threshold_used: 0.10,
  actual_value: 0.127,
  reason: '主胜欧赔从2.10降至1.84，变化幅度12.4%，超过显著阈值10%',
}
```

### 分析快照（保护历史复盘）
- analysis.snapshot_config 保存运行时完整 config 副本
- 历史记录不受后续规则/参数修改影响

---

## 数据结构规范（localStorage）

```javascript
// 比赛列表（含分析快照）
'ftb_matches' → [ { ...所有字段, analysis: { snapshot_config, rules_hit, ... } } ]

// 投注记录
'ftb_bets' → [ { id, betDate, betType, stake, totalOdds, potentialWin,
                  actualWin, status, selections, notes, createdAt } ]

// 配置（三层）
'ftb_config' → { ...thresholds, ...weights, ...grading }

// 自动补全用球队/赛事名称
'ftb_autocomplete' → { teams: [], competitions: [] }
```

---

## 市场类型规范

**主标签（9 选 1）**：主队一致强化 / 客队一致强化 / 平局增强 / 热门过热 /
盘口赔率不一致 / 试探失败 / 临场确认 / 高噪音结构 / 低价值不碰

**副标签（可多选）**：体彩偏甜主胜 / 体彩偏甜平局 / 体彩偏甜客胜 /
赢球不穿盘风险 / 让球与亚盘一致 / 让球与亚盘相悖 /
欧赔早动后稳 / 临场资金流入主队 / 临场资金流入客队 / 平赔持续下调

---

## 决策输出规范

等级只有三种：**甲级（可考虑）/ 乙级（观察）/ 丙级（放弃）**
建议只有四种：**主胜可考虑 / 平局可考虑 / 客胜可考虑 / 不碰**

高噪音/热门过热/低价值 → 强制丙级不碰，不给仓位建议。

---

## 编码规范

### JavaScript
- 使用 `fetch` API 与后端通信（本项目无后端，此条保留规范）
- 禁止使用 `alert()`，改用页面内 toast 提示
- 移动端：所有可点击元素最小高度 44px

### HTML/CSS
- 使用 Tailwind CSS，移动端优先
- 颜色语义：绿色=主胜/盈利，红色=客胜/亏损，黄色=平局/待定，蓝色=操作按钮
- 底部固定导航栏：分析/串关/记录/账单/复盘

---

## 禁止事项

1. 禁止引入任何需要 npm install / pip install 的依赖
2. 禁止使用 React/Vue/Angular 等前端框架
3. 禁止任何后端代码
4. 禁止使用外部 API
5. 禁止将用户数据上传到任何服务器
6. 禁止在 UI 中出现英文标签（变量名/注释除外）
7. 禁止在 engine.js 中使用任何黑箱模型，所有规则必须透明可解释

---

## 运行要求

用户零配置：
1. 手机浏览器打开 GitHub Pages 网址
2. 点"添加到主屏幕"
3. 之后离线直接使用

开发调试：直接用浏览器打开 `index.html` 即可。
