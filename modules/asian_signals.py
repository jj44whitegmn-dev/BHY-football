"""
asian_signals.py — 亚盘五层信号收集
"""

SIGNALS = [
    {
        'key':   'S0',
        'name':  'S0  CLV方向（平博开盘→关盘主水变化）',
        'guide': (
            '  比较平博初盘主水与终盘主水\n'
            '  主水持续下降（差 > 0.03）→ 偏主方向强化 → 输入  1\n'
            '  主水持续上升（差 > 0.03）→ 偏客方向强化 → 输入 -1\n'
            '  变化 < 0.03 或方向不明确  → 中性         → 输入  0'
        ),
        'time_sensitive': False,
    },
    {
        'key':   'S1',
        'name':  'S1  平博终盘重心',
        'guide': (
            '  查看平博终盘主水与客水的差值\n'
            '  主水 < 客水（差 > 0.03）→ 资金偏主  → 输入  1\n'
            '  两者接近（差 ≤ 0.03）  → 中性      → 输入  0\n'
            '  主水 > 客水（差 > 0.03）→ 资金偏客  → 输入 -1\n'
            '  ⚠️  注：S1与否决模型存在信息重叠，仅供参考'
        ),
        'time_sensitive': False,
    },
    {
        'key':   'S2',
        'name':  'S2  平博 vs 威廉初盘分歧',
        'guide': (
            '  比较平博与威廉希尔初盘方向，两家水位差均 > 0.10 且方向相反\n'
            '  平博偏主、威廉偏客 → 跟平博 → 输入  1\n'
            '  平博偏客、威廉偏主 → 跟平博 → 输入 -1\n'
            '  方向一致或分歧不明显       → 输入  0'
        ),
        'time_sensitive': False,
    },
    {
        'key':   'S3',
        'name':  'S3  终盘水位绝对差',
        'guide': (
            '  终盘主水比客水低超过 0.08 → 资金明显偏主 → 输入  1\n'
            '  终盘客水比主水低超过 0.08 → 资金明显偏客 → 输入 -1\n'
            '  差值在 0.08 以内           → 均衡         → 输入  0'
        ),
        'time_sensitive': False,
    },
    {
        'key':   'S4',
        'name':  'S4  盘口水位背离（需核心窗口：开球前 4-12 小时）',
        'guide': (
            '  散户推动盘口方向，但平博水位向反方向移动\n'
            '  聪明钱偏主（平博水位降主但盘口被推客）→ 输入  1\n'
            '  聪明钱偏客（平博水位降客但盘口被推主）→ 输入 -1\n'
            '  无背离或临盘噪音                       → 输入  0'
        ),
        'time_sensitive': True,
    },
    {
        'key':   'S5',
        'name':  'S5  早期降盘异常 / 深V（需核心窗口：开球前 4-12 小时）',
        'guide': (
            '  核心窗口内出现"先降盘→大资金买回升盘"的深V走势\n'
            '  回升方向偏主 → 输入  1\n'
            '  回升方向偏客 → 输入 -1\n'
            '  无异常或临盘波动 → 输入  0'
        ),
        'time_sensitive': True,
    },
]


def _get_one(sig, window_valid, noise_zone):
    """获取单个信号的用户输入，返回整数"""
    print(f'\n{sig["name"]}')
    print(sig['guide'])

    if sig['time_sensitive'] and noise_zone:
        print('  ⚠️  当前处于噪音区，该信号已自动置 0')
        return 0

    if sig['time_sensitive'] and not window_valid:
        print('  ⚠️  时间窗口状态未知，请据实填写')

    while True:
        raw = input('  请输入得分（1 / 0 / -1）：').strip()
        if raw in ('1', '0', '-1'):
            return int(raw)
        print('  请输入 1、0 或 -1')


def collect_all_signals(window_valid=True, noise_zone=False):
    """
    交互收集全部六层信号
    返回 dict: s0..s5, total, direction, window_valid
    """
    print()
    print('──── 亚盘六层信号评分 ────')
    if noise_zone:
        print('  ⚠️  当前处于噪音区（距开球 < 2 小时），S4/S5 已自动置 0')

    scores = {}
    for sig in SIGNALS:
        scores[sig['key'].lower()] = _get_one(sig, window_valid, noise_zone)

    total = sum(scores.values())
    direction = '偏主' if total > 0 else ('偏客' if total < 0 else '中性')

    s = scores
    print(f'\n  亚盘总分：{total:+d}（{direction}）')
    print(f'  S0:{s["s0"]:+d}  S1:{s["s1"]:+d}  S2:{s["s2"]:+d}  '
          f'S3:{s["s3"]:+d}  S4:{s["s4"]:+d}  S5:{s["s5"]:+d}')
    print('  ⚠️  S1与否决模型存在信息重叠，仅供参考')

    return {**scores, 'total': total, 'direction': direction, 'window_valid': window_valid}
