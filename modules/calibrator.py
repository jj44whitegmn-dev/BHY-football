"""
calibrator.py — 历史数据校准系统
下载 football-data.co.uk 历史CSV → 计算 Brier Score → Platt Scaling / 分桶校准
"""
import csv
import json
import os
import urllib.request
from datetime import datetime
from collections import defaultdict, deque
from math import exp

BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')
DATA_DIR    = os.path.join(BASE_DIR, 'data', 'historical')

# J联赛在该数据源不可用，跳过
LEAGUES = {
    '英超': 'E0',
    '德甲': 'D1',
    '西甲': 'SP1',
    '意甲': 'I1',
    '法甲': 'F1',
}

SEASONS = ['2122', '2223', '2324']   # 近三个完整赛季（2425未完赛，跳过）

# ──────────────────────────────────────────────────────────────
# 数据获取
# ──────────────────────────────────────────────────────────────

def _download_csv(league_code, season):
    os.makedirs(DATA_DIR, exist_ok=True)
    local = os.path.join(DATA_DIR, f'{league_code}_{season}.csv')

    if os.path.exists(local) and os.path.getsize(local) > 500:
        print(f'    [缓存] {league_code}_{season}.csv')
        return local

    url = f'https://www.football-data.co.uk/mmz4281/{season}/{league_code}.csv'
    print(f'    [下载] {url} ...', end=' ', flush=True)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
        if len(data) < 500:
            print('空文件，跳过')
            return None
        with open(local, 'wb') as f:
            f.write(data)
        print(f'OK ({len(data)//1024} KB)')
        return local
    except Exception as e:
        print(f'失败 ({e})')
        if os.path.exists(local):
            os.remove(local)
        return None


def _parse_date(s):
    for fmt in ('%d/%m/%Y', '%d/%m/%y', '%Y-%m-%d'):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _load_csv(path, league_name):
    matches = []
    try:
        with open(path, encoding='utf-8-sig', errors='replace') as f:
            reader = csv.DictReader(f)
            for row in reader:
                dt   = _parse_date(row.get('Date', ''))
                ftr  = row.get('FTR', '').strip()
                home = row.get('HomeTeam', '').strip()
                away = row.get('AwayTeam', '').strip()
                if not dt or ftr not in ('H', 'D', 'A') or not home or not away:
                    continue
                matches.append({'date': dt, 'home': home, 'away': away,
                                 'result': ftr, 'league': league_name})
    except Exception as e:
        print(f'    [读取错误] {e}')
    return matches


# ──────────────────────────────────────────────────────────────
# 滚动战绩
# ──────────────────────────────────────────────────────────────

def _build_rolling_form(matches, n=10):
    matches = sorted(matches, key=lambda m: m['date'])
    team_hist = defaultdict(lambda: deque(maxlen=n))
    out = []

    for m in matches:
        hh = list(team_hist[m['home']])
        ah = list(team_hist[m['away']])
        if len(hh) >= 3 and len(ah) >= 3:
            out.append((m, hh, ah))

        if m['result'] == 'H':
            team_hist[m['home']].append('W'); team_hist[m['away']].append('L')
        elif m['result'] == 'D':
            team_hist[m['home']].append('D'); team_hist[m['away']].append('D')
        else:
            team_hist[m['home']].append('L'); team_hist[m['away']].append('W')

    return out


# ──────────────────────────────────────────────────────────────
# Brier Score
# ──────────────────────────────────────────────────────────────

def brier_score(predictions, actuals):
    scores = []
    for (ph, pd, pa), r in zip(predictions, actuals):
        av = [1,0,0] if r=='H' else ([0,1,0] if r=='D' else [0,0,1])
        scores.append(sum((p-a)**2 for p,a in zip([ph,pd,pa], av)))
    return sum(scores) / len(scores)


# ──────────────────────────────────────────────────────────────
# 校准方法
# ──────────────────────────────────────────────────────────────

def _fit_platt(raw_probs_list, actuals):
    try:
        from scipy.optimize import minimize
        import math

        def _sig(x):
            if x > 500: return 1.0
            if x < -500: return 0.0
            return 1.0 / (1.0 + math.exp(-x))

        def _nll(ab, raw_col, labels):
            a, b = ab
            loss = 0.0
            for x, y in zip(raw_col, labels):
                p = max(min(_sig(-(a*x+b)), 1-1e-9), 1e-9)
                loss -= y*math.log(p) + (1-y)*math.log(1-p)
            return loss

        cls_map = {'home':0, 'draw':1, 'away':2}
        res_map = {'H':'home','D':'draw','A':'away'}
        params = {}
        for cls, idx in cls_map.items():
            raw_col = [p[idx] for p in raw_probs_list]
            labels  = [1 if res_map[a]==cls else 0 for a in actuals]
            r = minimize(_nll, [1.0, 0.0], args=(raw_col, labels),
                         method='Nelder-Mead', options={'maxiter':2000,'xatol':1e-5})
            params[cls] = {'a': float(r.x[0]), 'b': float(r.x[1])}
        return params, 'platt'
    except ImportError:
        return None, None
    except Exception as e:
        print(f'    [Platt 异常] {e}，回退分桶校准')
        return None, None


def _fit_bucket(raw_probs_list, actuals):
    bounds = [(0.0,0.2),(0.2,0.4),(0.4,0.6),(0.6,0.8),(0.8,1.01)]
    cls_names = ['home','draw','away']
    res_map   = {'H':0,'D':1,'A':2}
    params = {}
    for cls_idx, cls in enumerate(cls_names):
        raw_col = [p[cls_idx] for p in raw_probs_list]
        labels  = [1 if res_map[a]==cls_idx else 0 for a in actuals]
        blist = []
        for lo, hi in bounds:
            in_b = [(r,l) for r,l in zip(raw_col,labels) if lo<=r<hi]
            rate = sum(l for _,l in in_b)/len(in_b) if in_b else (lo+hi)/2
            blist.append([lo, hi, round(rate, 4)])
        params[cls] = blist
    return params, 'bucket'


def _apply_cal_single(ph, pd, pa, method, params):
    if method == 'platt':
        def platt(x, p):
            a, b = p['a'], p['b']
            v = a*x + b
            if v > 500: return 1.0
            if v < -500: return 0.0
            return 1.0 / (1.0 + exp(v))
        c_h = platt(ph, params['home'])
        c_d = platt(pd, params['draw'])
        c_a = platt(pa, params['away'])
    else:
        def bucket(x, bkts):
            for lo, hi, rate in bkts:
                if lo <= x < hi: return rate
            return x
        c_h = bucket(ph, params['home'])
        c_d = bucket(pd, params['draw'])
        c_a = bucket(pa, params['away'])
    t = c_h + c_d + c_a
    return (c_h/t, c_d/t, c_a/t) if t > 0 else (ph, pd, pa)


# ──────────────────────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────────────────────

def run_calibration():
    print()
    with open(CONFIG_PATH, encoding='utf-8') as f:
        cfg = json.load(f)

    n     = cfg['veto_model']['default_n']
    decay = cfg['veto_model']['default_decay']

    # 步骤 1
    print('════ 步骤 1/4：获取历史数据 ════')
    all_matches = []
    for league_name, code in LEAGUES.items():
        print(f'\n  {league_name}（{code}）:')
        for season in SEASONS:
            path = _download_csv(code, season)
            if path:
                ms = _load_csv(path, league_name)
                print(f'    {season}: {len(ms)} 场')
                all_matches.extend(ms)

    if len(all_matches) < 50:
        print('\n错误：历史数据不足（< 50 场），请检查网络后重试')
        return
    print(f'\n共读取 {len(all_matches)} 场历史比赛')

    # 步骤 2
    print()
    print('════ 步骤 2/4：计算预测概率 ════')
    from modules.veto_model import _weighted_probs

    predictions_raw, actuals = [], []
    by_league = defaultdict(list)
    for m in all_matches:
        by_league[m['league']].append(m)

    for league_name, lms in by_league.items():
        form_data = _build_rolling_form(lms, n=n)
        for match, hh, ah in form_data:
            ph = _weighted_probs(hh, decay)
            pa = _weighted_probs(ah, decay)
            p_home = ph['win'] * (1.0 - pa['win'])
            p_away = pa['win'] * (1.0 - ph['win'])
            p_draw = (ph['draw'] + pa['draw']) / 2.0
            t = p_home + p_draw + p_away
            predictions_raw.append((p_home/t, p_draw/t, p_away/t))
            actuals.append(match['result'])

    n_samples = len(predictions_raw)
    print(f'  有效样本：{n_samples} 场（双队均有 ≥ 3 场历史记录）')
    if n_samples < 50:
        print('错误：有效样本不足 50 场')
        return

    # 步骤 3
    print()
    print('════ 步骤 3/4：Brier Score ════')
    bs_raw = brier_score(predictions_raw, actuals)
    print(f'  原始 Brier Score：{bs_raw:.4f}')
    print(f'  参考：随机猜测 ≈ 0.667  |  完美预测 = 0.000  |  目标 < 0.600')

    # 步骤 4
    print()
    print('════ 步骤 4/4：拟合校准参数 ════')
    params, method = _fit_platt(predictions_raw, actuals)
    if method == 'platt':
        print('  使用 Platt Scaling（scipy 可用）')
    else:
        print('  scipy 不可用，使用分桶校准（效果相当）')
        params, method = _fit_bucket(predictions_raw, actuals)

    cal_preds = [_apply_cal_single(ph, pd, pa, method, params)
                 for ph, pd, pa in predictions_raw]
    bs_cal  = brier_score(cal_preds, actuals)
    improve = (bs_raw - bs_cal) / bs_raw * 100 if bs_raw > 0 else 0.0

    # 平局区间实际命中率
    draw_stats = []
    for lo, hi in [(0.20, 0.30), (0.30, 0.40), (0.40, 0.50)]:
        in_r = [(a, p[1]) for a, p in zip(actuals, predictions_raw) if lo <= p[1] < hi]
        if in_r:
            rate = sum(1 for a, _ in in_r if a == 'D') / len(in_r)
            draw_stats.append((lo, hi, len(in_r), rate))

    # 保存
    cfg['calibration'].update({
        'applied':                True,
        'brier_score_raw':        round(bs_raw, 4),
        'brier_score_calibrated': round(bs_cal, 4),
        'calibration_method':     method,
        'calibration_date':       datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'sample_size':            n_samples,
        'platt_params':           params if method == 'platt' else {k:{'a':None,'b':None} for k in ('home','draw','away')},
        'bucket_calibration':     params if method == 'bucket' else None,
    })
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

    # 报告
    years = {m['date'].year for m in all_matches}
    print()
    print('════════════════════════════════════════')
    print('  校准报告')
    print('════════════════════════════════════════')
    print(f'  历史数据：{n_samples} 场（{len(years)} 个年度）')
    print(f'  原始 Brier Score  ：{bs_raw:.3f}')
    print(f'  校准后 Brier Score：{bs_cal:.3f}')
    print(f'  改善幅度          ：{improve:.1f}%')
    print(f'  校准方法          ：{"Platt Scaling" if method=="platt" else "分桶校准"}')
    if draw_stats:
        print()
        print('  平局预测校准：')
        for lo, hi, cnt, rate in draw_stats:
            print(f'  模型预测 {int(lo*100)}-{int(hi*100)}% 区间（{cnt} 场）'
                  f'→ 实际平局率：{rate*100:.1f}%')
    print()
    print('  校准参数已保存至 config.json')
    print('════════════════════════════════════════')
