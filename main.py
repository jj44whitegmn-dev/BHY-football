#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
足彩预测辅助系统 V2 — 分析记录工具

用法：
  python main.py              # 分析一场比赛
  python main.py --calibrate  # 历史数据校准（首次使用必须先跑）
  python main.py --stats      # 统计面板
  python main.py --update-clv # 赛后补录CLV
  python main.py --history    # 查看历史记录
  python main.py --backtest   # 历史回测报告
"""
import sys
import os
import json
from datetime import datetime

# Windows 默认 GBK 终端强制改为 UTF-8，避免特殊字符报错
if sys.stdout.encoding and sys.stdout.encoding.lower() not in ('utf-8', 'utf8'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except AttributeError:
        pass  # Python < 3.7 不支持，忽略

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH  = os.path.join(BASE_DIR, 'config.json')
RECORDS_PATH = os.path.join(BASE_DIR, 'records.json')


def _load_cfg():
    with open(CONFIG_PATH, encoding='utf-8') as f:
        return json.load(f)


# ──────────────────────────────────────────────────────────────
# 输入工具
# ──────────────────────────────────────────────────────────────

def _input_seq(prompt, n=10):
    print(f'\n{prompt}')
    print(f'  格式：W D L W W（最旧在左，最新在右，W=赢 D=平 L=负）')
    print(f'  最少 3 场，最多 {n} 场')
    while True:
        raw   = input('  战绩：').strip().upper()
        parts = raw.split()
        bad   = [p for p in parts if p not in ('W', 'D', 'L')]
        if bad:
            print(f'  无效字符：{bad}'); continue
        if len(parts) < 3:
            print(f'  至少需要 3 场'); continue
        if len(parts) > n:
            parts = parts[-n:]
        return parts


def _input_float(prompt, optional=False):
    hint = '（回车跳过）' if optional else ''
    while True:
        raw = input(f'  {prompt}{hint}：').strip()
        if not raw and optional:
            return None
        try:
            return float(raw)
        except ValueError:
            print('  请输入有效数字')


def _input_league(cfg):
    draw_rates = cfg['league_draw_rates']
    leagues    = [l for l in draw_rates if l != '默认']
    print('\n  联赛列表：')
    for i, l in enumerate(leagues, 1):
        print(f'    {i:2d}. {l}')
    while True:
        raw = input('  选择联赛（序号或名称）：').strip()
        try:
            return leagues[int(raw) - 1]
        except (ValueError, IndexError):
            pass
        if raw in leagues:
            return raw
        hits = [l for l in leagues if raw in l]
        if len(hits) == 1:
            return hits[0]
        print('  请输入有效序号或联赛名称')


# ──────────────────────────────────────────────────────────────
# 综合分析输出
# ──────────────────────────────────────────────────────────────

def _direction_consistency(cal, asian):
    """返回 (model_dir_cn, asian_dir_cn, consistent)"""
    key_map = {'home': '主胜', 'draw': '平局', 'away': '客胜'}
    model_key = max(cal, key=cal.get)
    model_dir  = key_map[model_key]

    t = asian['total']
    asian_dir = '主队' if t > 0 else ('客队' if t < 0 else '中性')

    consistent = (
        (model_dir == '主胜' and asian_dir == '主队') or
        (model_dir == '客胜' and asian_dir == '客队') or
        (model_dir == '平局' and asian_dir == '中性')
    )
    return model_dir, asian_dir, consistent


def _draw_signal(ev_result, asian_total, cfg):
    thr    = cfg['thresholds']
    ev_d   = ev_result['ev']['draw']
    gap_d  = ev_result['gap']['draw']
    ev_ok  = ev_d  > thr['ev_minimum']
    gap_ok = gap_d > thr['gap_minimum']
    a_ok   = abs(asian_total) <= thr.get('draw_asian_range', 1)

    if ev_ok and gap_ok and a_ok: return '★★★ 平局强信号：模型+亚盘双重确认'
    if ev_ok and a_ok:            return '★★ 平局参考：EV达标但差值不足，轻仓'
    if ev_ok and not a_ok:        return '❌ 平局冲突：EV有参考但亚盘明显偏一方'
    return '— 平局无信号'


def _print_analysis(cal, ev_result, asian, cfg, veto=None):
    thr = cfg['thresholds']
    model_dir, asian_dir, consistent = _direction_consistency(cal, asian)

    key = {'主胜':'home','平局':'draw','客胜':'away'}[model_dir]
    ev_best  = ev_result['ev'][key]
    gap_best = ev_result['gap'][key]
    asian_strong = thr.get('asian_strong_signal', 2)

    gaps = {'主胜': ev_result['gap']['home'], '平局': ev_result['gap']['draw'],
            '客胜': ev_result['gap']['away']}
    best_gap_name = max(gaps, key=gaps.get)
    best_gap_val  = gaps[best_gap_name]

    draw_sig = _draw_signal(ev_result, asian['total'], cfg)

    print()
    print('════════════════════════════════════════')
    print('  综合分析')
    print('════════════════════════════════════════')

    print(f'\n  [模型概率]')
    print(f'  主胜 {cal["home"]*100:.1f}% / 平局 {cal["draw"]*100:.1f}% / 客胜 {cal["away"]*100:.1f}%')

    print(f'\n  [市场隐含]')
    im = ev_result['implied']
    print(f'  主胜 {im["home"]*100:.1f}% / 平局 {im["draw"]*100:.1f}% / 客胜 {im["away"]*100:.1f}%')

    sign = '高' if best_gap_val > 0 else '低'
    print(f'\n  [最大偏差项] {best_gap_name}：模型比市场{sign} {abs(best_gap_val)*100:.1f} 个百分点')

    t = asian['total']
    print(f'\n  [亚盘信号] 总分 {t:+d}（{asian["direction"]}）')
    print(f'  S1:{asian["s1"]:+d}  S2:{asian["s2"]:+d}  S3:{asian["s3"]:+d}  '
          f'S4:{asian["s4"]:+d}  S5:{asian["s5"]:+d}')

    print(f'\n  [信号一致性]')
    print(f'  模型偏差方向：{model_dir}')
    print(f'  亚盘信号方向：{asian_dir}')
    print(f'  → {"两者一致 ✓" if consistent else "方向分歧 ⚠️"}')

    print(f'\n  [平局专项]')
    if veto.get('draw_correction_triggered'):
        print(f'  ⚑  平局关注标记已触发（条件 {", ".join(veto["correction_conditions"])}）')
    print(f'  {draw_sig}')

    print(f'\n  [综合判断]')
    if model_dir != '平局':
        if consistent and ev_best > thr['ev_minimum'] and gap_best > thr['gap_minimum'] and abs(t) >= asian_strong:
            judge = f'★★★ 强信号：{model_dir}，模型+亚盘双重确认，EV达标'
        elif consistent and abs(t) >= 1 and (ev_best > thr['ev_minimum'] or gap_best > 0.03):
            judge = f'★★ 参考：{model_dir}方向，条件部分满足'
        elif not consistent and (ev_best > thr['ev_minimum'] or gap_best > thr['gap_minimum']):
            judge = f'❌ 信号冲突：模型偏{model_dir}但亚盘反向，不建议跟进'
        elif abs(t) >= 3:
            judge = f'⚠️  纯亚盘信号：{asian_dir}，模型无明确支持'
        else:
            judge = '— 无明显信号，本场跳过'
    else:
        judge = draw_sig

    print(f'  {judge}')
    print(f'\n  [CLV追踪提醒]')
    print(f'  赛后运行  python main.py --update-clv  补录平博关盘赔率')
    print('════════════════════════════════════════')

    return model_dir, asian_dir, consistent, draw_sig, gap_best


# ──────────────────────────────────────────────────────────────
# 命令实现
# ──────────────────────────────────────────────────────────────

def cmd_calibrate():
    from modules.calibrator import run_calibration
    run_calibration()


def cmd_stats():
    from modules.stats import show_stats
    show_stats()


def cmd_history():
    from modules.recorder import get_all
    records = get_all()
    if not records:
        print('暂无记录'); return
    print(f'\n历史记录（共 {len(records)} 场，最新在上）：')
    print('─' * 62)
    for r in reversed(records[-50:]):
        mi     = r.get('match_info', {})
        league = mi.get('league', '')
        home   = mi.get('home_team', '')
        away   = mi.get('away_team', '')
        dt     = r.get('timestamp', '')[:10]
        result = r.get('actual_result') or '待填'
        print(f'#{r["id"]:3d}  {dt}  [{league}]  {home} vs {away}  结果:{result}')
    print('─' * 62)


def cmd_update_clv():
    from modules.recorder import get_all, update_record
    records = get_all()
    if not records:
        print('暂无记录'); return

    print('\n──── 赛后 CLV 补录 ────')
    print('最近 10 场记录：')
    for r in records[-10:]:
        mi = r.get('match_info', {})
        print(f'  #{r["id"]}  {mi.get("home_team","")} vs {mi.get("away_team","")}  '
              f'[{r.get("timestamp","")[:10]}]  结果:{r.get("actual_result") or "待填"}')

    rid_str = input('\n请输入记录 ID：').strip()
    try:
        rid = int(rid_str)
    except ValueError:
        print('无效 ID'); return

    target = next((r for r in records if r.get('id') == rid), None)
    if not target:
        print('未找到该记录'); return

    mi = target.get('match_info', {})
    print(f'比赛：{mi.get("home_team","")} vs {mi.get("away_team","")}')

    # 实际结果
    actual = input('实际结果（H=主胜 / D=平局 / A=客胜，回车跳过）：').strip().upper()
    updates = {}
    if actual in ('H', 'D', 'A'):
        result_cn = {'H':'主胜','D':'平局','A':'客胜'}[actual]
        updates['actual_result'] = result_cn

    # 平博关盘赔率
    print('平博关盘赔率（不知道则直接回车跳过）：')
    h_str = input('  主胜：').strip()
    d_str = input('  平局：').strip()
    a_str = input('  客胜：').strip()

    clv_data = target.get('clv_tracking', {})
    if h_str and d_str and a_str:
        try:
            clv_data.update({
                'pinnacle_closing_home': float(h_str),
                'pinnacle_closing_draw': float(d_str),
                'pinnacle_closing_away': float(a_str),
            })
            # 计算 CLV
            bet_sel = target.get('bet_selection', '')
            odds    = target.get('odds', {})
            close_map = {'主胜': float(h_str), '平局': float(d_str), '客胜': float(a_str)}
            odds_map  = {'主胜': odds.get('home'), '平局': odds.get('draw'), '客胜': odds.get('away')}
            if bet_sel and odds_map.get(bet_sel) and close_map.get(bet_sel):
                buy_o   = odds_map[bet_sel]
                close_o = close_map[bet_sel]
                clv_pct = (buy_o / close_o - 1) * 100
                clv_data['clv_value'] = round(clv_pct, 2)
                sign = '+' if clv_pct >= 0 else ''
                print(f'\nCLV：买入 {buy_o} / 关盘 {close_o} → {sign}{clv_pct:.1f}%'
                      f'（{"跑赢 ✓" if clv_pct > 0 else "未跑赢"}）')
        except ValueError:
            print('赔率格式无效，跳过 CLV 计算')

    updates['clv_tracking'] = clv_data
    update_record(rid, updates)
    print('✓ 已更新')


def cmd_analyze():
    from modules.veto_model    import compute as veto_compute
    from modules.ev_calculator import calculate_ev, format_ev_table
    from modules.asian_signals import collect_all_signals
    from modules.time_checker  import check_window
    from modules.recorder      import add_record

    cfg = _load_cfg()

    print()
    print('════════════════════════════════════════')
    print('  足彩预测辅助系统 V2 — 分析记录工具')
    print('════════════════════════════════════════')

    if not cfg.get('calibration', {}).get('applied'):
        print('  ⚠️  校准尚未执行，概率为原始值（建议先运行 --calibrate）')

    # ── 步骤 1：基本信息 ──
    print('\n──── 步骤1：基本信息 ────')
    league    = _input_league(cfg)
    home_team = input('  主队名称：').strip()
    away_team = input('  客队名称：').strip()

    kickoff_str = input('  开球时间（MM-DD HH:MM 或 YYYY-MM-DD HH:MM，回车跳过）：').strip()
    if kickoff_str:
        win = check_window(kickoff_str)
        print(f'\n  时间窗口：{win["status"]}')
        if win['auto_zero_s45']:
            print('  S4/S5 将自动置 0')
    else:
        win = {'hours_before_kickoff': None, 'status': '未输入',
               'status_code': 'unknown', 's45_valid': True, 'auto_zero_s45': False}

    # ── 步骤 2：前置亚盘水位 ──
    print('\n──── 步骤2：平博终盘水位（可选，用于平局修正条件C）────')
    pin_home = _input_float('平博终盘主水', optional=True)
    pin_away = _input_float('平博终盘客水', optional=True) if pin_home is not None else None

    # ── 步骤 3：否决模型 ──
    print('\n──── 步骤3：否决模型 ────')
    n        = cfg['veto_model']['default_n']
    home_seq = _input_seq(f'主队 {home_team} 近期战绩（主队视角）', n=n)
    away_seq = _input_seq(f'客队 {away_team} 近期战绩（客队视角）', n=n)

    veto = veto_compute(home_seq, away_seq, league=league,
                        pinnacle_home_water=pin_home, pinnacle_away_water=pin_away, cfg=cfg)
    raw = veto['raw']; cal = veto['calibrated']

    print('\n  原始否决模型输出（未校准）：')
    print(f'  {"":>8}{"原始概率":>10}')
    for name, k in [('主胜','home'),('平局','draw'),('客胜','away')]:
        print(f'  {name:<6}{raw[k]*100:>9.1f}%')
    if veto['draw_correction_triggered']:
        conds = ', '.join(veto['correction_conditions'])
        print(f'\n  ⚑  平局值得关注（满足条件 {conds}）')

    # ── 步骤 4：体彩欧赔 ──
    print('\n──── 步骤4：体彩欧赔 ────')
    o_home = _input_float('主胜赔率')
    o_draw = _input_float('平局赔率')
    o_away = _input_float('客胜赔率')

    ev_result = calculate_ev((raw['home'], raw['draw'], raw['away']),
                             (o_home, o_draw, o_away))
    print('\n' + format_ev_table((raw['home'], raw['draw'], raw['away']),
                                 (o_home, o_draw, o_away), ev_result,
                                 ev_threshold=cfg['thresholds']['ev_minimum'],
                                 gap_threshold=cfg['thresholds']['gap_minimum']))

    # ── 步骤 5：亚盘信号 ──
    asian = collect_all_signals(window_valid=win['s45_valid'],
                                noise_zone=win['auto_zero_s45'])

    # ── 步骤 6：综合分析 ──
    model_dir, asian_dir, consistent, draw_sig, gap_best = \
        _print_analysis(raw, ev_result, asian, cfg, veto=veto)

    # ── 步骤 7：记录存档 ──
    print('\n──── 步骤7：记录存档 ────')
    betted  = input('  是否已下注？（y/n，回车=否）：').strip().lower() == 'y'
    bet_sel = ''
    if betted:
        bet_sel = input('  下注方向（主胜/平局/客胜）：').strip()
    notes = input('  备注（可空）：').strip()

    record = {
        'model_version': 'v2.0',
        'analysis_window': {
            'kickoff_time':       kickoff_str or None,
            'analysis_time':      datetime.now().isoformat(),
            'hours_before_kickoff': win['hours_before_kickoff'],
            'window_status':      win['status'],
        },
        'match_info': {'league': league, 'home_team': home_team, 'away_team': away_team},
        'veto_model_inputs': {
            'home_sequence':            ' '.join(home_seq),
            'away_sequence':            ' '.join(away_seq),
            'n':                        n,
            'decay_factor':             cfg['veto_model']['default_decay'],
            'draw_correction_triggered': veto['draw_correction_triggered'],
            'correction_conditions':    veto['correction_conditions'],
            'calibration_applied':      veto['calibration_applied'],
            'pinnacle_home_water':      pin_home,
            'pinnacle_away_water':      pin_away,
        },
        'veto_model_output': {
            'raw':        {k: round(v*100, 2) for k, v in raw.items()},
            'calibrated': {k: round(v*100, 2) for k, v in cal.items()},
        },
        'odds':               {'home': o_home, 'draw': o_draw, 'away': o_away},
        'implied_probability': {k: round(v*100, 2) for k, v in ev_result['implied'].items()},
        'ev':                 {k: round(v, 4) for k, v in ev_result['ev'].items()},
        'probability_gap':    {k: round(v*100, 2) for k, v in ev_result['gap'].items()},
        'asian_signals':      asian,
        'analysis_output': {
            'model_direction': model_dir,
            'asian_direction': asian_dir,
            'consistency':     consistent,
            'draw_signal':     draw_sig,
            'summary':         f'{model_dir}方向，亚盘{asian["total"]:+d}，最大差值{gap_best*100:.1f}%',
        },
        'clv_tracking': {
            'pinnacle_closing_home': None,
            'pinnacle_closing_draw': None,
            'pinnacle_closing_away': None,
        },
        'actual_result': '',
        'betted':        betted,
        'bet_selection': bet_sel,
        'notes':         notes,
    }

    rec_id = add_record(record)
    print(f'\n  ✓ 已保存为记录 #{rec_id}')
    print()
    print('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    print('  赛后请补录平博关盘赔率（--update-clv）')
    print('  CLV追踪是验证你是否有真实edge的唯一指标')
    print('  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')


# ──────────────────────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────────────────────

def cmd_backtest():
    from modules.backtester import run_backtest
    run_backtest()


if __name__ == '__main__':
    args = sys.argv[1:]
    try:
        if '--calibrate'  in args: cmd_calibrate()
        elif '--stats'    in args: cmd_stats()
        elif '--update-clv' in args: cmd_update_clv()
        elif '--history'  in args: cmd_history()
        elif '--backtest' in args: cmd_backtest()
        else:                      cmd_analyze()
    except KeyboardInterrupt:
        print('\n\n已退出')
