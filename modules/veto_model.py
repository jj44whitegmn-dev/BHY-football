"""
veto_model.py — 否决模型
衰减加权 W/D/L → 三分类概率 + 平局修正 + 可选校准
"""
import json
import os
from math import exp

BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')


def load_config():
    with open(CONFIG_PATH, encoding='utf-8') as f:
        return json.load(f)


def _weighted_probs(sequence, decay=0.8):
    """衰减加权，返回 win/draw/loss 概率（从该队视角）
    使用 Laplace 平滑（α=1）防止极端序列导致概率为0"""
    n = len(sequence)
    weights = [decay ** (n - 1 - i) for i in range(n)]
    total_w = sum(weights)
    wins  = sum(w for w, r in zip(weights, sequence) if r == 'W')
    draws = sum(w for w, r in zip(weights, sequence) if r == 'D')
    ALPHA = 1.0   # Laplace 平滑，防止极端序列出现0概率
    smooth_total = total_w + ALPHA * 3
    return {
        'win':  (wins  + ALPHA) / smooth_total,
        'draw': (draws + ALPHA) / smooth_total,
        'loss': (total_w - wins - draws + ALPHA) / smooth_total,
    }


def _platt(x, p):
    a, b = p.get('a'), p.get('b')
    if a is None or b is None:
        return x
    v = a * x + b
    if v > 500:  return 1.0
    if v < -500: return 0.0
    return 1.0 / (1.0 + exp(v))


def _bucket(x, bkts):
    if not bkts:
        return x
    for lo, hi, rate in bkts:
        if lo <= x < hi:
            return rate
    return x


def apply_calibration(p_home, p_draw, p_away, cfg):
    cal = cfg.get('calibration', {})
    if not cal.get('applied', False):
        return p_home, p_draw, p_away
    method = cal.get('calibration_method')
    if method == 'platt':
        params = cal.get('platt_params', {})
        c_h = _platt(p_home, params.get('home', {}))
        c_d = _platt(p_draw, params.get('draw', {}))
        c_a = _platt(p_away, params.get('away', {}))
    elif method == 'bucket':
        params = cal.get('bucket_calibration', {}) or {}
        c_h = _bucket(p_home, params.get('home', []))
        c_d = _bucket(p_draw, params.get('draw', []))
        c_a = _bucket(p_away, params.get('away', []))
    else:
        return p_home, p_draw, p_away
    t = c_h + c_d + c_a
    if t <= 0:
        return p_home, p_draw, p_away
    return c_h/t, c_d/t, c_a/t


def compute(home_sequence, away_sequence, league='默认',
            pinnacle_home_water=None, pinnacle_away_water=None, cfg=None):
    """
    计算否决模型概率

    home_sequence / away_sequence : list['W'|'D'|'L']，最旧在前最新在后
    返回 dict 含 raw / calibrated / draw_correction_triggered / correction_conditions
    """
    if cfg is None:
        cfg = load_config()

    decay = cfg['veto_model']['default_decay']
    ph = _weighted_probs(home_sequence, decay)
    pa = _weighted_probs(away_sequence, decay)

    n_home = len(home_sequence)
    n_away = len(away_sequence)

    p_home = ph['win'] * (1.0 - pa['win'])
    p_away = pa['win'] * (1.0 - ph['win'])
    # 按实际场次数加权平均（n_home=n_away时与简单平均等价）
    p_draw = (ph['draw'] * n_home + pa['draw'] * n_away) / (n_home + n_away)
    t = p_home + p_draw + p_away
    p_home /= t; p_draw /= t; p_away /= t

    # 平局修正
    draw_rates  = cfg['league_draw_rates']
    league_rate = draw_rates.get(league, draw_rates.get('默认', 0.25))
    thr = cfg.get('thresholds', {})

    cond_a = league_rate > thr.get('draw_rate_threshold', 0.28)
    cond_b = home_sequence[-5:].count('D') + away_sequence[-5:].count('D') >= 4
    cond_c = (
        pinnacle_home_water is not None and pinnacle_away_water is not None
        and abs(pinnacle_home_water - pinnacle_away_water) < 0.05
    )

    conditions_met   = [c for c, flag in [('A', cond_a), ('B', cond_b), ('C', cond_c)] if flag]
    draw_correction  = len(conditions_met) >= 2

    # 平局修正：不再调整概率数值，仅作为关注标记
    # Platt Scaling 已校准了平局的系统性高估，手动乘系数会产生二次干预

    c_home, c_draw, c_away = apply_calibration(p_home, p_draw, p_away, cfg)

    return {
        'raw':        {'home': p_home, 'draw': p_draw, 'away': p_away},
        'calibrated': {'home': c_home, 'draw': c_draw, 'away': c_away},
        'calibration_applied':       cfg.get('calibration', {}).get('applied', False),
        'draw_correction_triggered': draw_correction,
        'correction_conditions':     conditions_met,
    }
