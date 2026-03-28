"""
backtester.py — 历史回测模块

回测范围：英超/德甲/西甲/意甲/法甲，近3赛季 CSV 数据
回测维度：
  1. 否决模型单独表现
  2. S1信号单独表现（平博关盘亚盘水位，PCAHH/PCAHA）
  3. 否决模型 + S1 双重确认
  4. CLV方向验证（平博开盘→关盘欧赔压缩方向）
  5. 各联赛差异
  6. CLV方向 + 否决模型双重确认

注：
  - 时间顺序严格执行，每场只用该场日期之前的战绩（无未来数据）
  - 否决模型最少需要3场历史战绩，否则跳过该场
  - 样本不足(<30场)时在输出中标注
  - 结果写入 backtest_report.json
"""

import csv
import json
import os
from datetime import datetime
from math import exp

BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR    = os.path.join(BASE_DIR, 'data', 'historical')
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')
REPORT_PATH = os.path.join(BASE_DIR, 'backtest_report.json')

LEAGUE_MAP = {
    'E0': '英超', 'D1': '德甲', 'SP1': '西甲',
    'I1': '意甲', 'F1': '法甲',
}

MIN_SAMPLE = 30  # 样本不足警告阈值


# ─────────────────────── 工具函数 ───────────────────────

def _load_config():
    with open(CONFIG_PATH, encoding='utf-8') as f:
        return json.load(f)


def _parse_date(date_str):
    """DD/MM/YYYY → datetime.date，解析失败返回 None"""
    try:
        return datetime.strptime(date_str.strip(), '%d/%m/%Y').date()
    except (ValueError, AttributeError):
        return None


def _safe_float(val):
    """字符串→浮点数，无效值/零值返回 None"""
    try:
        v = float(val)
        return v if v > 0 else None
    except (ValueError, TypeError):
        return None


def _implied_prob_2way(odds_a, odds_b):
    """将两个赔率转为二选一隐含概率（忽略平局，仅看方向）"""
    if odds_a is None or odds_b is None:
        return None, None
    inv_a = 1.0 / odds_a
    inv_b = 1.0 / odds_b
    total = inv_a + inv_b
    return inv_a / total, inv_b / total


def _sample_note(n):
    if n < MIN_SAMPLE:
        return f'⚠ 样本不足（{n}场），结论仅供参考'
    return ''


def _pct(num, den):
    return (num / den * 100) if den > 0 else None


# ─────────────────────── 数据加载 ───────────────────────

def _load_csv_data():
    """
    加载所有历史 CSV，按日期排序后返回 match 字典列表。
    关键字段：
      FTR          — H/D/A 赛果
      PSH/PSD/PSA  — 平博开盘欧赔
      PSCH/PSCA    — 平博关盘欧赔（用于CLV方向）
      PCAHH/PCAHA  — 平博关盘亚盘水位（命令.md中称PSCH/PCAH，实为亚盘水位字段）
      B365H/D/A    — Bet365 欧赔（用于EV参考）
    """
    all_matches = []
    for filename in sorted(os.listdir(DATA_DIR)):
        if not filename.endswith('.csv'):
            continue
        league_code = filename.split('_')[0]
        league = LEAGUE_MAP.get(league_code)
        if not league:
            continue
        filepath = os.path.join(DATA_DIR, filename)
        with open(filepath, encoding='utf-8', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                ftr = row.get('FTR', '').strip()
                if ftr not in ('H', 'D', 'A'):
                    continue
                date = _parse_date(row.get('Date', ''))
                if not date:
                    continue
                all_matches.append({
                    'date':   date,
                    'league': league,
                    'home':   row.get('HomeTeam', '').strip(),
                    'away':   row.get('AwayTeam', '').strip(),
                    'ftr':    ftr,
                    # 平博开盘欧赔（CLV分子）
                    'psh':    _safe_float(row.get('PSH')),
                    'psa':    _safe_float(row.get('PSA')),
                    # 平博关盘欧赔（CLV分母）
                    'psch':   _safe_float(row.get('PSCH')),
                    'psca':   _safe_float(row.get('PSCA')),
                    # 平博关盘亚盘水位（S1信号，命令.md称PSCH/PCAH）
                    'pcahh':  _safe_float(row.get('PCAHH')),
                    'pcaha':  _safe_float(row.get('PCAHA')),
                    # Bet365（EV参考）
                    'b365h':  _safe_float(row.get('B365H')),
                    'b365d':  _safe_float(row.get('B365D')),
                    'b365a':  _safe_float(row.get('B365A')),
                })
    all_matches.sort(key=lambda x: x['date'])
    return all_matches


# ─────────────────────── 时序战绩构建 ───────────────────────

def _build_sequences(all_matches):
    """
    按时间顺序处理，为每场比赛记录赛前战绩快照。
    严格无未来数据：先取战绩快照，比赛结束后再更新队伍历史。

    返回: list of (match_dict, home_seq, away_seq)
    """
    team_history = {}   # team_name -> list of 'W'/'D'/'L'（从队伍视角）
    result = []

    for m in all_matches:
        home = m['home']
        away = m['away']

        # 赛前快照（最多取近10场）
        home_seq = list(team_history.get(home, [])[-10:])
        away_seq = list(team_history.get(away, [])[-10:])
        result.append((m, home_seq, away_seq))

        # 比赛结束后更新历史（严格在快照之后）
        if home not in team_history:
            team_history[home] = []
        if away not in team_history:
            team_history[away] = []

        ftr = m['ftr']
        if ftr == 'H':
            team_history[home].append('W')
            team_history[away].append('L')
        elif ftr == 'A':
            team_history[home].append('L')
            team_history[away].append('W')
        else:
            team_history[home].append('D')
            team_history[away].append('D')

    return result


# ─────────────────────── 模型计算 ───────────────────────

def _platt(x, p):
    a, b = p.get('a'), p.get('b')
    if a is None or b is None:
        return x
    v = a * x + b
    if v > 500:  return 1.0
    if v < -500: return 0.0
    return 1.0 / (1.0 + exp(v))


def _veto_predict(home_seq, away_seq, league, cfg):
    """
    运行否决模型，返回校准后概率 {'home':, 'draw':, 'away':}
    直接调用 veto_model 中已测试的核心函数
    """
    from modules.veto_model import _weighted_probs, apply_calibration

    decay = cfg['veto_model']['default_decay']
    ph = _weighted_probs(home_seq, decay)
    pa = _weighted_probs(away_seq, decay)

    p_home = ph['win'] * (1.0 - pa['win'])
    p_away = pa['win'] * (1.0 - ph['win'])
    p_draw = (ph['draw'] + pa['draw']) / 2.0
    t = p_home + p_draw + p_away
    p_home /= t; p_draw /= t; p_away /= t

    c_home, c_draw, c_away = apply_calibration(p_home, p_draw, p_away, cfg)
    return {'home': c_home, 'draw': c_draw, 'away': c_away}


def _s1_signal(pcahh, pcaha):
    """
    S1：平博关盘亚盘水位重心
    pcahh < pcaha 且差值 > 0.03 → +1 偏主
    pcahh > pcaha 且差值 > 0.03 → -1 偏客
    """
    if pcahh is None or pcaha is None:
        return None
    diff = pcahh - pcaha
    if diff < -0.03: return 1
    if diff >  0.03: return -1
    return 0


def _clv_direction(psh, psa, psch, psca):
    """
    CLV方向：比较平博开盘→关盘欧赔的隐含概率变化
    关盘主胜隐含概率 > 开盘主胜隐含概率（差值>2%）→ 聪明钱流向主队 → 'home'
    关盘客胜隐含概率 > 开盘客胜隐含概率（差值>2%）→ 聪明钱流向客队 → 'away'
    差值不足 → None（无明确方向）
    """
    if None in (psh, psa, psch, psca):
        return None
    open_h, open_a = _implied_prob_2way(psh, psa)
    close_h, close_a = _implied_prob_2way(psch, psca)
    if None in (open_h, close_h):
        return None
    diff_h = close_h - open_h   # 主胜概率变化量
    if diff_h > 0.02:  return 'home'
    if diff_h < -0.02: return 'away'
    return None


# ─────────────────────── 统计累加器 ───────────────────────

class _Acc:
    """命中率累加器"""
    __slots__ = ('total', 'hits')
    def __init__(self):
        self.total = 0
        self.hits  = 0

    def add(self, hit: bool):
        self.total += 1
        if hit:
            self.hits += 1

    def rate(self):
        return _pct(self.hits, self.total)

    def fmt(self):
        r = self.rate()
        if r is None:
            return '无数据'
        note = _sample_note(self.total)
        s = f'{r:.1f}%（{self.total}场）'
        return f'{s}  {note}' if note else s


# ─────────────────────── 主回测逻辑 ───────────────────────

def run_backtest():
    print('\n════════════════════════════════════════════')
    print('  开始历史回测')
    print('════════════════════════════════════════════')

    print('\n[1/4] 读取历史CSV数据...')
    all_matches = _load_csv_data()
    print(f'  共加载 {len(all_matches)} 场比赛（{DATA_DIR}）')

    print('[2/4] 按时间顺序构建队伍战绩序列（严格无未来数据）...')
    match_sequences = _build_sequences(all_matches)

    cfg = _load_config()

    print('[3/4] 逐场计算模型指标...')

    # ── 维度1：否决模型 ──
    veto_all        = _Acc()
    veto_by_pred    = {'home': _Acc(), 'draw': _Acc(), 'away': _Acc()}

    # ── 维度2：S1信号 ──
    s1_pos          = _Acc()   # S1=+1 → 主胜命中
    s1_neg          = _Acc()   # S1=-1 → 客胜命中
    s1_zero_dist    = {'H': 0, 'D': 0, 'A': 0, 'total': 0}

    # ── 维度3：双重确认 ──
    dual_agree      = _Acc()   # 否决模型与S1方向一致
    dual_disagree   = _Acc()   # 否决模型与S1方向相反

    # ── 维度4：CLV方向 ──
    clv_acc         = _Acc()

    # ── 维度6：CLV + 否决模型双重确认 ──
    clv_veto_agree    = _Acc()   # CLV方向与否决模型方向一致
    clv_veto_disagree = _Acc()   # CLV方向与否决模型方向相反

    # ── 维度5：联赛 ──
    lg_names = ['英超', '德甲', '西甲', '意甲', '法甲']
    league_veto     = {lg: _Acc() for lg in lg_names}
    league_dual     = {lg: _Acc() for lg in lg_names}

    skipped_seq  = 0
    skipped_err  = 0

    for match, home_seq, away_seq in match_sequences:
        if len(home_seq) < 3 or len(away_seq) < 3:
            skipped_seq += 1
            continue

        ftr    = match['ftr']
        league = match['league']

        # ── 否决模型 ──
        try:
            cal = _veto_predict(home_seq, away_seq, league, cfg)
        except Exception:
            skipped_err += 1
            continue

        veto_pred = max(cal, key=cal.get)   # 'home'/'draw'/'away'
        veto_hit  = (
            (veto_pred == 'home' and ftr == 'H') or
            (veto_pred == 'draw' and ftr == 'D') or
            (veto_pred == 'away' and ftr == 'A')
        )
        veto_all.add(veto_hit)
        veto_by_pred[veto_pred].add(veto_hit)
        if league in league_veto:
            league_veto[league].add(veto_hit)

        # ── S1信号 ──
        s1 = _s1_signal(match['pcahh'], match['pcaha'])
        if s1 is not None:
            if s1 == 1:
                s1_pos.add(ftr == 'H')
            elif s1 == -1:
                s1_neg.add(ftr == 'A')
            else:
                s1_zero_dist['total'] += 1
                s1_zero_dist[ftr]     += 1

        # ── 双重确认（仅当否决模型有明确方向 & S1有方向时）──
        if s1 is not None and s1 != 0 and veto_pred != 'draw':
            veto_dir = 1 if veto_pred == 'home' else -1
            if veto_dir == s1:
                # 方向一致：以一致方向为预测
                dual_hit = (
                    (veto_pred == 'home' and ftr == 'H') or
                    (veto_pred == 'away' and ftr == 'A')
                )
                dual_agree.add(dual_hit)
                if league in league_dual:
                    league_dual[league].add(dual_hit)
            else:
                # 方向相反：仍以否决模型预测计算命中
                dual_disagree.add(veto_hit)

        # ── CLV方向 ──
        clv_dir = _clv_direction(match['psh'], match['psa'],
                                  match['psch'], match['psca'])
        if clv_dir is not None:
            clv_hit = (
                (clv_dir == 'home' and ftr == 'H') or
                (clv_dir == 'away' and ftr == 'A')
            )
            clv_acc.add(clv_hit)

            # ── 维度6：CLV + 否决模型双重确认（排除平局预测）──
            if veto_pred != 'draw':
                if clv_dir == veto_pred:
                    # 方向一致：以一致方向为预测
                    agree_hit = (
                        (veto_pred == 'home' and ftr == 'H') or
                        (veto_pred == 'away' and ftr == 'A')
                    )
                    clv_veto_agree.add(agree_hit)
                else:
                    # 方向相反：以否决模型预测计算命中
                    clv_veto_disagree.add(veto_hit)

    valid_count = veto_all.total
    print(f'  有效场次：{valid_count}')
    print(f'  跳过（战绩不足3场）：{skipped_seq}')
    if skipped_err:
        print(f'  跳过（计算异常）：{skipped_err}')

    # ── 组装报告 ──
    s1_zero_total = s1_zero_dist['total']
    if s1_zero_total > 0:
        zh = s1_zero_dist['H'] / s1_zero_total * 100
        zd = s1_zero_dist['D'] / s1_zero_total * 100
        za = s1_zero_dist['A'] / s1_zero_total * 100
        s1_zero_str = f'{zh:.1f}%/{zd:.1f}%/{za:.1f}%'
    else:
        s1_zero_str = '无数据'

    veto_overall_rate     = veto_all.rate()
    dual_agree_rate       = dual_agree.rate()
    clv_rate              = clv_acc.rate()
    clv_veto_agree_rate   = clv_veto_agree.rate()

    dual_lift = (
        round(dual_agree_rate - veto_overall_rate, 1)
        if (dual_agree_rate is not None and veto_overall_rate is not None)
        else None
    )
    clv_lift  = (
        round(clv_rate - 33.3, 1)
        if clv_rate is not None else None
    )
    clv_veto_lift = (
        round(clv_veto_agree_rate - veto_overall_rate, 1)
        if (clv_veto_agree_rate is not None and veto_overall_rate is not None)
        else None
    )

    report = {
        'generated_at':  datetime.now().isoformat(),
        'total_matches': valid_count,
        'dim1_veto': {
            'overall':  {'total': veto_all.total,        'accuracy': veto_overall_rate},
            'home_pred':{'total': veto_by_pred['home'].total, 'accuracy': veto_by_pred['home'].rate()},
            'draw_pred':{'total': veto_by_pred['draw'].total, 'accuracy': veto_by_pred['draw'].rate()},
            'away_pred':{'total': veto_by_pred['away'].total, 'accuracy': veto_by_pred['away'].rate()},
        },
        'dim2_s1': {
            'home': {'total': s1_pos.total, 'accuracy': s1_pos.rate()},
            'away': {'total': s1_neg.total, 'accuracy': s1_neg.rate()},
            'neutral': {'total': s1_zero_total, 'distribution': s1_zero_str},
        },
        'dim3_dual': {
            'agree':    {'total': dual_agree.total,    'accuracy': dual_agree_rate},
            'disagree': {'total': dual_disagree.total, 'accuracy': dual_disagree.rate()},
            'lift_vs_veto_overall': dual_lift,
        },
        'dim4_clv': {
            'total':            clv_acc.total,
            'accuracy':         clv_rate,
            'lift_vs_random':   clv_lift,
        },
        'dim5_league': {
            lg: {
                'veto_total':    league_veto[lg].total,
                'veto_accuracy': league_veto[lg].rate(),
                'dual_total':    league_dual[lg].total,
                'dual_accuracy': league_dual[lg].rate(),
            }
            for lg in lg_names
        },
        'dim6_clv_veto': {
            'agree':    {'total': clv_veto_agree.total,    'accuracy': clv_veto_agree_rate},
            'disagree': {'total': clv_veto_disagree.total, 'accuracy': clv_veto_disagree.rate()},
            'lift_vs_veto_overall': clv_veto_lift,
        },
    }

    print('\n[4/4] 生成报告...')
    _print_report(report, veto_by_pred, s1_pos, s1_neg, s1_zero_str,
                  s1_zero_total, dual_agree, dual_disagree, clv_acc,
                  league_veto, league_dual, dual_lift, clv_lift,
                  clv_veto_agree, clv_veto_disagree, clv_veto_lift)

    with open(REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f'\n✓ 完整回测结果已保存至 backtest_report.json')


# ─────────────────────── 报告输出 ───────────────────────

def _print_report(report, veto_by_pred, s1_pos, s1_neg, s1_zero_str,
                  s1_zero_total, dual_agree, dual_disagree, clv_acc,
                  league_veto, league_dual, dual_lift, clv_lift,
                  clv_veto_agree, clv_veto_disagree, clv_veto_lift):
    SEP  = '═' * 44
    d    = report

    print()
    print(SEP)
    print('  历史回测报告')
    print('  数据：英超/德甲/西甲/意甲/法甲，近3赛季')
    print(f'  总场次：{d["total_matches"]}场')
    print(SEP)

    # ── 维度1：否决模型 ──
    print('\n  [否决模型历史表现]')
    ov = d['dim1_veto']['overall']
    ov_rate = ov['accuracy']
    ov_note = _sample_note(ov['total'])
    print(f'  整体命中率：{ov_rate:.1f}%（基准：33.3%）'
          f'{" / "+ov_note if ov_note else ""}')
    for label, key in [('主胜', 'home_pred'), ('平局', 'draw_pred'), ('客胜', 'away_pred')]:
        sub = d['dim1_veto'][key]
        r   = sub['accuracy']
        r_s = f'{r:.1f}%' if r is not None else '无数据'
        note = _sample_note(sub['total'])
        note_s = f'  ⚠ {note}' if note else ''
        print(f'  {label}预测命中：{r_s}（{sub["total"]}场样本）{note_s}')

    # ── 维度2：S1信号 ──
    print('\n  [S1信号历史表现]')
    s1h = d['dim2_s1']['home']
    s1a = d['dim2_s1']['away']
    def _s1_line(r, n, note_label):
        r_s  = f'{r:.1f}%' if r is not None else '无数据'
        note = _sample_note(n)
        return f'{r_s}（{n}场）{"  ⚠ "+note if note else ""}'
    print(f'  平博偏主（S1=+1）→ 主胜实际率：{_s1_line(s1h["accuracy"], s1h["total"], "S1+1")}')
    print(f'  平博偏客（S1=-1）→ 客胜实际率：{_s1_line(s1a["accuracy"], s1a["total"], "S1-1")}')
    print(f'  平博中性（S1=0） → 主/平/客分布：{s1_zero_str}（{s1_zero_total}场）')

    # ── 维度3：双重确认 ──
    print('\n  [双重确认效果]')
    d3 = d['dim3_dual']
    da = d3['agree'];   dd = d3['disagree']
    da_r = da['accuracy']; dd_r = dd['accuracy']
    da_s = f'{da_r:.1f}%' if da_r is not None else '无数据'
    dd_s = f'{dd_r:.1f}%' if dd_r is not None else '无数据'
    da_note = _sample_note(da['total']); dd_note = _sample_note(dd['total'])
    print(f'  否决模型+S1方向一致：命中率{da_s}（{da["total"]}场）'
          f'{"  ⚠ "+da_note if da_note else ""}')
    print(f'  否决模型+S1方向相反：命中率{dd_s}（{dd["total"]}场）'
          f'{"  ⚠ "+dd_note if dd_note else ""}')
    if dual_lift is not None:
        sign = '+' if dual_lift >= 0 else ''
        print(f'  提升幅度（vs整体命中率）：{sign}{dual_lift:.1f}个百分点')

    # ── 维度4：CLV ──
    print('\n  [CLV方向验证]')
    d4 = d['dim4_clv']
    clv_r = d4['accuracy']; clv_n = d4['total']
    clv_s = f'{clv_r:.1f}%' if clv_r is not None else '无数据'
    clv_note = _sample_note(clv_n)
    print(f'  跟随平博开→关盘压缩方向：命中率{clv_s}（{clv_n}场）'
          f'{"  ⚠ "+clv_note if clv_note else ""}')
    if clv_lift is not None:
        sign = '+' if clv_lift >= 0 else ''
        print(f'  对比随机基准提升：{sign}{clv_lift:.1f}个百分点')

    # ── 维度5：联赛 ──
    print('\n  [联赛分布]')
    for lg in ['英超', '德甲', '西甲', '意甲', '法甲']:
        s = d['dim5_league'][lg]
        vr = s['veto_accuracy']; vn = s['veto_total']
        dr = s['dual_accuracy']; dn = s['dual_total']
        v_s = f'{vr:.1f}%' if vr is not None else '无数据'
        d_s = f'{dr:.1f}%' if dr is not None else '无数据'
        if vn < MIN_SAMPLE: v_s += '（样本不足）'
        if dn < MIN_SAMPLE: d_s += '（样本不足）'
        print(f'  {lg}：整体命中{v_s}，双重确认命中{d_s}')

    # ── 维度6：CLV + 否决模型双重确认 ──
    print('\n  [CLV + 否决模型双重确认]')
    d6 = d['dim6_clv_veto']
    ca = d6['agree'];   cd = d6['disagree']
    ca_r = ca['accuracy']; cd_r = cd['accuracy']
    ca_s = f'{ca_r:.1f}%' if ca_r is not None else '无数据'
    cd_s = f'{cd_r:.1f}%' if cd_r is not None else '无数据'
    ca_note = _sample_note(ca['total']); cd_note = _sample_note(cd['total'])
    print(f'  CLV+否决模型方向一致：命中率{ca_s}（{ca["total"]}场）'
          f'{"  ⚠ "+ca_note if ca_note else ""}')
    print(f'  CLV+否决模型方向相反：命中率{cd_s}（{cd["total"]}场）'
          f'{"  ⚠ "+cd_note if cd_note else ""}')
    if clv_veto_lift is not None:
        sign = '+' if clv_veto_lift >= 0 else ''
        print(f'  提升幅度（vs否决模型整体）：{sign}{clv_veto_lift:.1f}个百分点')

    # ── 关键结论 ──
    print('\n  [关键结论]')
    candidates = []
    s1h_r = d['dim2_s1']['home']['accuracy']
    s1a_r = d['dim2_s1']['away']['accuracy']
    if s1h_r is not None: candidates.append(('S1偏主信号', s1h_r))
    if s1a_r is not None: candidates.append(('S1偏客信号', s1a_r))
    if da_r  is not None: candidates.append(('否决+S1双重确认', da_r))
    if ca_r  is not None: candidates.append(('CLV+否决双重确认', ca_r))
    if ov_rate is not None: candidates.append(('否决模型单独', ov_rate))
    if candidates:
        best_sig, best_rate = max(candidates, key=lambda x: x[1])
        print(f'  最有效信号：{best_sig}（{best_rate:.1f}%）')

    best_lg_name = None; best_lg_rate = 0.0
    for lg in ['英超', '德甲', '西甲', '意甲', '法甲']:
        s = d['dim5_league'][lg]
        if s['veto_total'] >= MIN_SAMPLE and s['veto_accuracy'] is not None:
            if s['veto_accuracy'] > best_lg_rate:
                best_lg_rate = s['veto_accuracy']
                best_lg_name = lg
    if best_lg_name:
        print(f'  最适合联赛：{best_lg_name}（整体命中{best_lg_rate:.1f}%）')

    if dual_lift is not None:
        sign = '+' if dual_lift >= 0 else ''
        print(f'  否决+S1双重确认vs单一模型提升：{sign}{dual_lift:.1f}%')
    if clv_veto_lift is not None:
        sign = '+' if clv_veto_lift >= 0 else ''
        print(f'  CLV+否决双重确认vs单一模型提升：{sign}{clv_veto_lift:.1f}%')

    print(SEP)
