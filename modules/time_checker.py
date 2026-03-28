"""
time_checker.py — 时间窗口判断
"""
from datetime import datetime


def check_window(kickoff_str, now=None):
    """
    kickoff_str : 'YYYY-MM-DD HH:MM' 或 'MM-DD HH:MM'
    返回 dict: hours_before_kickoff, status, status_code, s45_valid, auto_zero_s45
    """
    if now is None:
        now = datetime.now()

    kickoff = None
    for fmt in ('%Y-%m-%d %H:%M', '%m-%d %H:%M', '%Y/%m/%d %H:%M'):
        try:
            kickoff = datetime.strptime(kickoff_str.strip(), fmt)
            if kickoff.year == 1900:          # MM-DD 格式补年
                kickoff = kickoff.replace(year=now.year)
            break
        except ValueError:
            continue

    if kickoff is None:
        return {
            'hours_before_kickoff': None,
            'status': '时间格式无法解析',
            'status_code': 'unknown',
            's45_valid': True,
            'auto_zero_s45': False,
        }

    hours = (kickoff - now).total_seconds() / 3600.0

    if hours < 0:
        code, s45_valid, auto_zero = 'started', False, True
        label = '❌ 比赛已开始或结束'
    elif hours < 2:
        code, s45_valid, auto_zero = 'noise', False, True
        label = f'❌ 噪音区（距开球 {hours:.1f} 小时，散户大量涌入）'
    elif hours < 4:
        code, s45_valid, auto_zero = 'usable', True, False
        label = f'△ 可用窗口（距开球 {hours:.1f} 小时）'
    elif hours <= 12:
        code, s45_valid, auto_zero = 'optimal', True, False
        label = f'✓ 最优窗口（距开球 {hours:.1f} 小时）'
    else:
        code, s45_valid, auto_zero = 'early', True, False
        label = f'⚠️  过早（距开球 {hours:.1f} 小时，平博盘口可能未稳定）'

    return {
        'hours_before_kickoff': round(hours, 1),
        'status':       label,
        'status_code':  code,
        's45_valid':    s45_valid,
        'auto_zero_s45': auto_zero,
    }
