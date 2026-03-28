"""
stats.py — 统计面板（实时可用，无场次门槛）
"""
import json
import os
from collections import defaultdict

BASE_DIR     = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH  = os.path.join(BASE_DIR, 'config.json')

RESULT_MAP = {'H': '主胜', 'D': '平局', 'A': '客胜'}
REVERSE_MAP = {'主胜': 'H', '平局': 'D', '客胜': 'A'}


def show_stats():
    from modules.recorder import get_all
    records   = get_all()
    completed = [r for r in records if r.get('actual_result') and
                 r['actual_result'] not in ('', None)]
    total = len(records)

    print()
    print('════════════════════════════════════════')
    print(f'  系统统计（共 {total} 场记录）')
    print('════════════════════════════════════════')

    if not completed:
        print(f'\n  已记录 {total} 场，暂无已填结果')
        _show_calibration_status()
        print('════════════════════════════════════════')
        return

    # ── 辅助：否决模型命中 ──
    def _veto_hit(r):
        vo = r.get('veto_model_output', {})
        probs = vo.get('raw') or vo.get('calibrated') or {}
        if not probs:
            return None
        pred_key = max(probs, key=probs.get)
        pred_cn  = {'home':'主胜','draw':'平局','away':'客胜'}.get(pred_key, pred_key)
        return pred_cn == r.get('actual_result')

    # ── ① CLV统计（最优先）──
    print(f'\n  [CLV统计] ★ 核心指标：长期正CLV = 有真实edge')
    clv_recs = [r for r in completed
                if r.get('clv_tracking', {}).get('clv_value') is not None]
    if clv_recs:
        avg_clv = sum(r['clv_tracking']['clv_value'] for r in clv_recs) / len(clv_recs)
        pos     = sum(1 for r in clv_recs if r['clv_tracking']['clv_value'] > 0)
        print(f'  累计 CLV 场次：{len(clv_recs)} 场')
        print(f'  平均 CLV：{avg_clv:+.1f}%  ← {"✓ 有edge" if avg_clv > 0 else "✗ 需审视"}')
        print(f'  正 CLV 比例：{pos/len(clv_recs)*100:.1f}%')
    else:
        print('  暂无 CLV 数据（赛后运行 --update-clv 补录）')
        print('  CLV追踪是验证你是否有真实edge的唯一指标')

    # ── ② S4/S5信号 + 亚盘总分≥3 ──
    print(f'\n  [关键信号命中率]（需积累≥20场样本）')
    for sk in ('s4', 's5'):
        hits = total_s = 0
        for r in completed:
            val    = r.get('asian_signals', {}).get(sk)
            actual = r.get('actual_result', '')
            if not val:
                continue
            actual_en = REVERSE_MAP.get(actual, actual)
            if (val > 0 and actual_en == 'H') or (val < 0 and actual_en == 'A'):
                hits += 1
            total_s += 1
        if total_s >= 20:
            print(f'  {sk.upper()} 命中率：{hits/total_s*100:.1f}%（{total_s} 场）')
        elif total_s > 0:
            print(f'  {sk.upper()} 命中率：{hits/total_s*100:.1f}%（{total_s} 场，样本不足，建议≥20场）')
        else:
            print(f'  {sk.upper()} 命中率：暂无有效样本')

    t_high = []; t_high_hit = 0
    for r in completed:
        t_score   = r.get('asian_signals', {}).get('total', 0) or 0
        actual_en = REVERSE_MAP.get(r.get('actual_result',''), r.get('actual_result',''))
        if abs(t_score) >= 3:
            t_high.append(r)
            expected = 'H' if t_score > 0 else 'A'
            if actual_en == expected:
                t_high_hit += 1
    if t_high:
        print(f'  亚盘|总分|≥3：命中率 {t_high_hit/len(t_high)*100:.1f}%（{len(t_high)} 场）')
    else:
        print('  亚盘|总分|≥3：暂无样本')

    # ── ③ 参考指标 ──
    veto_hits = [h for h in [_veto_hit(r) for r in completed] if h is not None]
    veto_acc  = sum(veto_hits)/len(veto_hits)*100 if veto_hits else None

    print(f'\n  [参考指标]')
    print(f'  已有结果：{len(completed)} 场')
    if veto_acc is not None:
        print(f'  否决模型方向命中率：{veto_acc:.1f}%（随机基准 ≈ 33%）')
    print(f'  各信号独立命中率（S0~S3）：')
    for sk in ('s0', 's1', 's2', 's3'):
        hits = total_s = 0
        for r in completed:
            val    = r.get('asian_signals', {}).get(sk)
            actual = r.get('actual_result', '')
            if not val:
                continue
            actual_en = REVERSE_MAP.get(actual, actual)
            if (val > 0 and actual_en == 'H') or (val < 0 and actual_en == 'A'):
                hits += 1
            total_s += 1
        if total_s:
            print(f'    {sk.upper()} 命中率：{hits/total_s*100:.1f}%（{total_s} 场）')
        else:
            print(f'    {sk.upper()} 命中率：暂无样本')

    # ── 联赛分布 ──
    print(f'\n  [联赛分布]')
    league_stat = defaultdict(lambda: {'total':0,'correct':0})
    for r in completed:
        mi = r.get('match_info', {})
        league = mi.get('league', r.get('league', '未知'))
        league_stat[league]['total'] += 1
        if _veto_hit(r):
            league_stat[league]['correct'] += 1
    for league, st in sorted(league_stat.items()):
        rate = st['correct']/st['total']*100
        print(f'  {league}：{st["total"]} 场，命中 {rate:.1f}%')

    print('════════════════════════════════════════')


def _show_calibration_status():
    pass  # 校准已禁用，不再显示校准状态
