"""
ev_calculator.py — EV计算与格式化输出
"""


def calculate_ev(calibrated_probs, odds):
    """
    calibrated_probs : (p_home, p_draw, p_away)
    odds             : (o_home, o_draw, o_away)
    返回 dict: ev, implied, gap, margin
    """
    p_h, p_d, p_a = calibrated_probs
    o_h, o_d, o_a = odds

    overround = 1/o_h + 1/o_d + 1/o_a
    mu = 1.0 / overround

    implied = {'home': mu/o_h, 'draw': mu/o_d, 'away': mu/o_a}
    ev      = {'home': p_h*o_h, 'draw': p_d*o_d, 'away': p_a*o_a}
    gap     = {'home': p_h - implied['home'],
               'draw': p_d - implied['draw'],
               'away': p_a - implied['away']}
    margin  = (overround - 1.0) * 100.0

    return {'ev': ev, 'implied': implied, 'gap': gap, 'margin': margin}


def format_ev_table(cal_probs, odds, ev_result, ev_threshold=1.05, gap_threshold=0.06):
    p_h, p_d, p_a = cal_probs
    o_h, o_d, o_a = odds

    def ref(ev_v, gap_v):
        if ev_v > ev_threshold and gap_v > gap_threshold: return '✓'
        if ev_v > ev_threshold or gap_v > 0.03:           return '△'
        return '✗'

    rows = [
        ('主胜', p_h, ev_result['implied']['home'], ev_result['gap']['home'], ev_result['ev']['home']),
        ('平局', p_d, ev_result['implied']['draw'], ev_result['gap']['draw'], ev_result['ev']['draw']),
        ('客胜', p_a, ev_result['implied']['away'], ev_result['gap']['away'], ev_result['ev']['away']),
    ]

    lines = [
        '════════════════════════════════════════',
        '  体彩欧赔分析（参考）',
        '════════════════════════════════════════',
        f'  竞彩抽水：{ev_result["margin"]:.1f}%',
        '',
        f'  {"选项":<4}  {"校准概率":>8}  {"隐含概率":>8}  {"差值":>7}  {"EV":>6}  参考',
    ]
    for name, cal_p, impl_p, gap_p, ev_v in rows:
        lines.append(
            f'  {name:<4}  {cal_p*100:>7.1f}%  {impl_p*100:>7.1f}%  '
            f'{gap_p*100:>+6.1f}%  {ev_v:>6.2f}  {ref(ev_v, gap_p)}'
        )

    best = max(rows, key=lambda r: r[3])
    lines += [
        '',
        f'  注：竞彩{ev_result["margin"]:.0f}%抽水，EV>1.05 且差值>6% 才具参考意义',
        f'  当前最大偏差：{best[0]}（差值 {best[3]*100:+.1f}%）',
        '════════════════════════════════════════',
    ]
    return '\n'.join(lines)
