# 足彩预测辅助系统 V2 升级指令

## 写给Claude Code的说明

这是一个已有V1基础的系统升级任务。V1已经实现了基本的CLI交互和JSON记录功能。
本文档描述V2需要新增、修改和重构的全部内容。请完整阅读后再开始执行。

---

## 一、系统定位（重要，影响所有设计决策）

**本系统是分析记录工具，不是下注决策系统。**

核心价值优先级：
1. 完整记录每场分析过程（最高优先级）
2. 校准用户的读盘能力
3. 验证各信号的真实预测力
4. EV和决策建议作为参考显示，不作为核心驱动

原因：中国竞彩抽水31%，EV>1.05在绝大多数场次算不出来。
强行以"找到可下注场次"为目标，会导致系统大部分时间输出"无信号"而失去实用价值。

---

## 二、V2新增模块：历史数据校准系统

这是V2最重要的新增功能，需要在系统启动时完成初始化。

### 2.1 数据获取

从football-data.co.uk下载历史赛果CSV文件。
文件包含字段：Date, HomeTeam, AwayTeam, FTHG(主队进球), FTAG(客队进球), FTR(赛果H/D/A)

支持联赛（优先实现）：
- 英超（E0）
- 德甲（D1）
- 西甲（SP1）
- 意甲（I1）
- 法甲（F1）
- J联赛（J1）

系统需要提供一个初始化命令：
```
python main.py --calibrate
```

执行流程：
1. 自动下载或读取本地已有的历史CSV文件
2. 对每场历史比赛，用否决模型计算预测概率
3. 对比预测概率与实际赛果，计算Brier Score
4. 执行Platt Scaling校准，输出校准参数
5. 将校准参数保存到config.json

### 2.2 否决模型校准算法

**原始否决模型（保持不变）：**
```python
def veto_model(home_sequence, away_sequence, n=10, decay=0.8):
    weights = [decay ** (n - i) for i in range(1, n+1)]
    
    def weighted_prob(seq, result):
        return sum(w for w, r in zip(weights, seq) if r == result) / sum(weights)
    
    ph_win  = weighted_prob(home_sequence, 'W')
    ph_draw = weighted_prob(home_sequence, 'D')
    pa_win  = weighted_prob(away_sequence, 'W')  # 注意：客队W是从客队视角
    pa_draw = weighted_prob(away_sequence, 'D')
    
    p_home = ph_win * (1 - pa_win)
    p_away = pa_win * (1 - ph_win)
    p_draw = (ph_draw + pa_draw) / 2
    
    total = p_home + p_draw + p_away
    return p_home/total, p_draw/total, p_away/total
```

**Brier Score计算：**
```python
def brier_score(predictions, actuals):
    # predictions: list of (p_home, p_draw, p_away)
    # actuals: list of 'H'/'D'/'A'
    scores = []
    for (ph, pd, pa), result in zip(predictions, actuals):
        actual_vec = [1,0,0] if result=='H' else [0,1,0] if result=='D' else [0,0,1]
        score = sum((p - a)**2 for p, a in zip([ph,pd,pa], actual_vec))
        scores.append(score)
    return sum(scores) / len(scores)
# 完美模型Brier Score = 0，随机猜测约0.667，目标 < 0.60
```

**Platt Scaling校准：**
```python
from math import log, exp

def platt_scaling(raw_probs, actuals):
    # 对三分类分别做sigmoid校准
    # 返回校准参数 (a, b) for each class
    # 校准后概率 = 1 / (1 + exp(a * raw_prob + b))
    # 使用scipy.optimize或手动梯度下降实现
    # 校准参数保存到config.json的calibration字段
    pass
```

注意：如果scipy不可用，使用简化版线性校准：
对每个概率区间（0-20%, 20-40%, 40-60%, 60-80%, 80-100%）计算实际命中率，建立映射表。

### 2.3 校准报告输出

校准完成后显示：
```
════════════════════════════════════════
  校准报告
════════════════════════════════════════
  历史数据：X场比赛（X个赛季）
  原始Brier Score：X.XXX
  校准后Brier Score：X.XXX
  改善幅度：X.X%

  平局预测校准：
  模型预测20-30%区间 → 实际平局率：XX%
  模型预测30-40%区间 → 实际平局率：XX%

  校准参数已保存至 config.json
════════════════════════════════════════
```

---

## 三、V2修改：交互流程重构

### 3.1 新的交互顺序

V1的顺序存在循环论证问题（模块一需要亚盘水位数据，但亚盘在后面才输入）。
V2修正为：

```
1. 基本信息（联赛/主客队/比赛时间/平博开盘时间）
2. 前置亚盘数据（终盘水位差，用于平局修正条件C）
3. 否决模型计算（含平局修正）
4. 体彩欧赔输入与转换
5. EV与安全边际计算（参考显示）
6. 亚盘五层信号完整评分
7. 综合分析输出
8. 记录存档
```

### 3.2 新增：时间窗口检查

在基本信息环节，新增时间窗口判断：

```
输入：
- 平博开盘时间（例：昨天18:00）
- 比赛开球时间（例：今天23:00）
- 当前分析时间（自动获取系统时间）

计算：
- 距开球时间 = 开球时间 - 当前时间
- 核心分析窗口 = 开球前4小时到开球前12小时

判断：
距开球 > 12小时 → ⚠️ 过早：平博盘口可能未稳定，聪明钱未入场
距开球 4-12小时 → ✓ 最优窗口：信号质量最高，建议在此时完成分析
距开球 2-4小时  → △ 可用窗口：信号基本可用，注意临场噪音
距开球 < 2小时  → ❌ 噪音区：散户大量涌入，S4/S5信号不可信
```

### 3.3 串关时间检查

如果涉及串关，对每一场赛事单独检查时间窗口：
```
串关场次检查：
场次A [联赛名] 开球XX:XX → 当前窗口状态：[最优/可用/噪音区]
场次B [联赛名] 开球XX:XX → 当前窗口状态：[最优/可用/噪音区/未开盘]

如果任何一场处于"未开盘"或"噪音区"：
→ ⛔ 串关风险警告：场次B尚未进入有效分析窗口
→ 建议：等待场次B进入最优窗口后再出票
→ 或：取消本次串关
```

---

## 四、V2修改：否决模型

### 4.1 使用校准参数

如果config.json中存在校准参数，自动应用：
```python
def get_calibrated_prob(raw_prob, calibration_params):
    if calibration_params is None:
        return raw_prob  # 未校准时直接返回原始概率
    a, b = calibration_params
    return 1 / (1 + exp(a * raw_prob + b))
```

显示时同时展示原始概率和校准后概率：
```
否决模型输出：
              原始概率    校准后概率
主胜：        42.1%      38.6%
平局：        31.5%  →   33.2%  ← 已触发平局修正
客胜：        26.4%      28.2%
```

### 4.2 平局修正（修正条件）

触发条件：满足以下任意两条：
- 条件A：联赛历史平局率 > 28%（内置数据）
- 条件B：主队近5场平局数 + 客队近5场平局数 ≥ 4
- 条件C：平博终盘双方水位差 < 0.05（需前置输入，跳过则不触发）

触发后：P(平局) × 1.15，重新归一化

内置联赛平局率：
```python
LEAGUE_DRAW_RATES = {
    'J联赛': 0.30,
    '意甲': 0.28,
    '荷甲': 0.27,
    '英超': 0.25,
    '西甲': 0.25,
    '德甲': 0.24,
    '中超': 0.24,
    '澳超': 0.22,
    '默认': 0.25
}
```

---

## 五、V2修改：亚盘五层信号

### 5.1 S4和S5的时间边界（重要修改）

**S4（盘口水位背离）：**
```
核心逻辑：散户推动盘口方向，但平博水位反向移动
→ 平博水位方向代表聪明钱真实立场

有效判断条件：
  必须在核心分析窗口内（开球前4-12小时）观察到
  临盘2小时内的背离不计入S4得分（标记为噪音）

打分：
  聪明钱偏主（平博水位偏主但盘口被散户推客）→ +1
  聪明钱偏客（平博水位偏客但盘口被散户推主）→ -1
  无背离或临盘噪音 → 0
```

**S5（早期降盘异常）：**
```
核心逻辑：核心分析窗口内出现"深V"走势
  先降盘（机构试探）→ 后被大资金迅速买回升盘

有效判断条件：
  必须发生在开球前4-12小时窗口内
  开球前2小时内的降盘一律视为散户噪音，不计入

打分：
  深V回升方向偏主 → +1
  深V回升方向偏客 → -1
  无异常或临盘波动 → 0
```

用户输入时，系统显示当前时间窗口状态，提醒用户S4/S5是否有效：
```
当前时间窗口：最优窗口（距开球8小时）
S4/S5信号：有效，请据实填写
```
或：
```
当前时间窗口：噪音区（距开球1.5小时）
S4/S5信号：已自动置0，临盘波动不计入评分
```

### 5.2 五层信号评分提示（用户输入时显示）

每个信号输入前显示简短提示：

```
S1 平博终盘重心
  主水 < 客水（差>0.03）→ 输入 1
  两者接近（差≤0.03） → 输入 0
  主水 > 客水（差>0.03）→ 输入 -1
请输入S1得分：
```

```
S2 平博vs威廉初盘分歧
  两家方向相反且水位差均>0.10，跟随平博方向
  平博偏主 → 输入 1 / 平博偏客 → 输入 -1
  方向一致或分歧不明显 → 输入 0
请输入S2得分：
```

```
S3 终盘水位绝对差
  终盘主水比客水低超过0.08 → 输入 1
  终盘客水比主水低超过0.08 → 输入 -1
  差值在0.08以内 → 输入 0
请输入S3得分：
```

---

## 六、V2修改：EV计算与显示

### 6.1 使用校准后概率计算EV

```python
def calculate_ev(calibrated_probs, odds):
    p_home, p_draw, p_away = calibrated_probs
    o_home, o_draw, o_away = odds
    
    mu = 1 / (1/o_home + 1/o_draw + 1/o_away)
    implied = (mu/o_home, mu/o_draw, mu/o_away)
    
    ev_home  = p_home  * o_home
    ev_draw  = p_draw  * o_draw
    ev_away  = p_away  * o_away
    
    gap_home  = p_home  - implied[0]
    gap_draw  = p_draw  - implied[1]
    gap_away  = p_away  - implied[2]
    
    margin = (1/o_home + 1/o_draw + 1/o_away - 1) * 100
    
    return ev_home, ev_draw, ev_away, gap_home, gap_draw, gap_away, margin
```

### 6.2 EV显示格式（参考显示，非决策驱动）

```
════════════════════════════════════════
  体彩欧赔分析（参考）
════════════════════════════════════════
  竞彩抽水：XX.X%（官方返奖69%）

  选项    校准概率   隐含概率   差值      EV      参考
  主胜    38.6%     46.5%    -7.9%    0.81    ✗
  平局    33.2%     30.5%    +2.7%    1.06    △
  客胜    28.2%     23.0%    +5.2%    0.99    ✗

  注：竞彩31%抽水环境下，EV>1.05且差值>6%才具参考意义
      当前场次：平局差值仅2.7%，未达有效门槛
════════════════════════════════════════
```

---

## 七、V2修改：综合分析输出

### 7.1 输出结构调整

V2的输出重心从"决策建议"转向"综合分析"：

```
════════════════════════════════════════
  综合分析
════════════════════════════════════════

  [模型概率]
  主胜 38.6% / 平局 33.2% / 客胜 28.2%

  [市场隐含]
  主胜 46.5% / 平局 30.5% / 客胜 23.0%

  [最大偏差项] 客胜：模型比市场高5.2个百分点

  [亚盘信号] 总分 -3（明显偏客）
  S1:-1  S2:-1  S3:0  S4:0  S5:-1

  [信号一致性]
  模型偏差方向：客胜
  亚盘信号方向：客队
  → 两者一致

  [平局专项]
  平局模型概率33.2% > 隐含30.5%
  亚盘总分-3，市场有明确倾向（偏客）
  → 平局信号不足（亚盘需在-1到+1之间才确认平局）

  [综合判断]
  客胜方向：模型与亚盘一致，但EV差值仅5.2%（未达6%门槛）
  → 参考价值：中等
  → 如需下注：客胜方向，轻仓

  [CLV追踪提醒]
  赛后请记录平博关盘赔率，用于复盘校准
════════════════════════════════════════
```

### 7.2 平局专项规则

```python
def draw_signal_check(ev_draw, gap_draw, asian_total_score):
    ev_ok    = ev_draw > 1.05
    gap_ok   = gap_draw > 0.06
    asian_ok = -1 <= asian_total_score <= 1
    
    if ev_ok and gap_ok and asian_ok:
        return "★★★ 平局强信号：模型+亚盘双重确认"
    elif ev_ok and asian_ok:
        return "★★ 平局参考：EV达标但差值不足，轻仓参考"
    elif ev_ok and not asian_ok:
        return "❌ 平局冲突：EV有参考但亚盘明显偏向一方"
    else:
        return "— 平局无信号"
```

---

## 八、V2修改：记录存档

### 8.1 JSON字段完整版

```json
{
  "id": 1,
  "model_version": "v2.0",
  "timestamp": "2026-03-26T21:30:00",
  "analysis_window": {
    "kickoff_time": "2026-03-26T23:00:00",
    "analysis_time": "2026-03-26T15:30:00",
    "hours_before_kickoff": 7.5,
    "window_status": "最优窗口"
  },
  "match_info": {
    "league": "J联赛",
    "home_team": "主队名",
    "away_team": "客队名"
  },
  "veto_model_inputs": {
    "home_sequence": "W D L W W D W L W W",
    "away_sequence": "D W W L W D W W D L",
    "n": 10,
    "decay_factor": 0.8,
    "draw_correction_triggered": true,
    "correction_conditions": ["A", "B"],
    "calibration_applied": true
  },
  "veto_model_output": {
    "raw": {"home": 42.1, "draw": 28.5, "away": 29.4},
    "calibrated": {"home": 38.6, "draw": 33.2, "away": 28.2}
  },
  "odds": {
    "home": 2.10, "draw": 3.20, "away": 3.50
  },
  "implied_probability": {
    "home": 46.5, "draw": 30.5, "away": 23.0
  },
  "ev": {
    "home": 0.81, "draw": 1.06, "away": 0.99
  },
  "probability_gap": {
    "home": -7.9, "draw": 2.7, "away": 5.2
  },
  "asian_signals": {
    "window_valid": true,
    "s1_pinnacle_lean": -1,
    "s2_company_divergence": -1,
    "s3_closing_water_diff": 0,
    "s4_line_water_divergence": 0,
    "s5_early_line_drop": -1,
    "total": -3
  },
  "analysis_output": {
    "model_direction": "客胜",
    "asian_direction": "客队",
    "consistency": true,
    "draw_signal": "❌ 平局冲突",
    "summary": "客胜方向一致，EV差值5.2%未达门槛，轻仓参考"
  },
  "clv_tracking": {
    "pinnacle_closing_home": null,
    "pinnacle_closing_draw": null,
    "pinnacle_closing_away": null
  },
  "actual_result": "",
  "betted": false,
  "bet_selection": "",
  "notes": ""
}
```

### 8.2 CLV追踪功能

新增一个独立命令，用于赛后补录平博关盘赔率：

```
python main.py --update-clv
```

用户输入比赛ID和平博关盘三项赔率，系统自动计算：
```
CLV分析：
你买入赔率：3.50（客胜）
平博关盘：3.20（客胜）
CLV = 3.50 / 3.20 = +9.4%（跑赢关盘线）

长期CLV统计（累计X场）：
平均CLV：+X.X%
正CLV场次：XX场（XX%）
```

---

## 九、V2新增：统计面板（实时可用，非100场后解锁）

V2取消"100场后解锁"的限制，改为从第一场开始就实时显示统计，数据越多越准。

```
python main.py --stats
```

显示内容：
```
════════════════════════════════════════
  系统统计（共X场记录）
════════════════════════════════════════

  [整体准确率]
  已有结果场次：X场
  整体命中率：XX%
  （基准：随机猜测约33%）

  [各信号独立统计]
  S1正确率：XX%（X场样本）
  S2正确率：XX%
  S3正确率：XX%
  S4正确率：XX%
  S5正确率：XX%

  [亚盘总分与结果相关性]
  |总分| ≥ 3 的场次命中率：XX%
  |总分| 1-2 的场次命中率：XX%
  总分 = 0 的场次命中率：XX%

  [CLV统计]（需补录平博关盘赔率）
  累计CLV：+X.X%
  正CLV场次比例：XX%

  [联赛分布]
  J联赛：X场，命中XX%
  英超：X场，命中XX%
  ...

  [否决模型校准状态]
  Brier Score：X.XXX
  校准状态：已校准 / 未校准
════════════════════════════════════════
```

---

## 十、V2修改：config.json结构

```json
{
  "model_version": "v2.0",
  "veto_model": {
    "default_n": 10,
    "default_decay": 0.8
  },
  "calibration": {
    "applied": false,
    "brier_score_raw": null,
    "brier_score_calibrated": null,
    "platt_params": {
      "home":  {"a": null, "b": null},
      "draw":  {"a": null, "b": null},
      "away":  {"a": null, "b": null}
    },
    "calibration_date": null,
    "sample_size": null
  },
  "thresholds": {
    "ev_minimum": 1.05,
    "gap_minimum": 0.06,
    "asian_strong_signal": 2,
    "draw_asian_range": 1
  },
  "time_windows": {
    "noise_zone_hours": 2,
    "optimal_window_min_hours": 4,
    "optimal_window_max_hours": 12
  },
  "league_draw_rates": {
    "J联赛": 0.30,
    "意甲": 0.28,
    "荷甲": 0.27,
    "英超": 0.25,
    "西甲": 0.25,
    "德甲": 0.24,
    "中超": 0.24,
    "澳超": 0.22,
    "默认": 0.25
  }
}
```

---

## 十一、文件结构

```
project/
├── main.py              # 主入口，CLI交互
├── config.json          # 配置文件（含校准参数）
├── records.json         # 所有场次记录
├── modules/
│   ├── veto_model.py    # 否决模型 + 校准
│   ├── asian_signals.py # 亚盘五层信号
│   ├── ev_calculator.py # EV计算
│   ├── calibrator.py    # 历史数据校准系统
│   ├── time_checker.py  # 时间窗口判断
│   ├── recorder.py      # JSON记录存档
│   └── stats.py         # 统计面板
└── data/
    └── historical/      # 存放历史CSV文件
```

---

## 十二、依赖库

优先使用Python标准库。允许使用：
- json, math, datetime, os, csv（标准库）
- urllib.request（用于下载历史数据，标准库）
- collections, statistics（标准库）

如果Platt Scaling需要scipy：
- scipy（仅用于校准模块，可选）
- 如果scipy不可用，用简化版分桶校准代替

不使用pandas、numpy或其他重型库。

---

## 十三、执行命令总览

```
python main.py              # 主流程：分析一场比赛
python main.py --calibrate  # 初始化：历史数据校准
python main.py --update-clv # 补录平博关盘赔率
python main.py --stats      # 查看统计面板
python main.py --history    # 查看历史记录列表
```

---

## 十四、V1到V2的关键变更摘要

| 项目 | V1 | V2 |
|------|----|----|
| 系统定位 | 下注决策系统 | 分析记录工具 |
| 校准 | 无 | 历史数据初始校准 + Brier Score |
| 交互顺序 | 亚盘在模块四 | 前置水位差，修正循环论证 |
| S4/S5时间边界 | 无定义 | 明确噪音区/最优窗口 |
| 时间窗口检查 | 无 | 自动判断并警告 |
| EV显示 | 核心决策驱动 | 参考显示 |
| 统计解锁 | 100场后 | 实时可用 |
| CLV追踪 | 无 | 新增 |
| 概率显示 | 仅校准后 | 原始+校准后对比 |
| 串关检查 | 简单规则 | 逐场时间窗口验证 |
