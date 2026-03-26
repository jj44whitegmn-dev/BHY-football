const Asian = (() => {

  /**
   * SIGNALS — 亚盘信号定义（5 个信号）
   * id: 's1'~'s5'
   * name: 显示名称
   * desc: 说明文字（中文）
   * hasAuto: 是否支持自动计算
   */
  const SIGNALS = [
    {
      id: 's1',
      name: 'S1 平博终盘重心',
      hasAuto: true,
      desc: '查看平博终盘主水与客水的差值。主水低于客水超0.03→偏主+1；客水低超0.03→偏客-1；差值≤0.03→中性0。',
    },
    {
      id: 's2',
      name: 'S2 公司分歧',
      hasAuto: true,
      desc: '比较平博与威廉希尔初盘方向。两家方向相反且各自水位差均>0.10→强分歧，跟随平博（偏主+1/偏客-1）；方向一致或分歧不明显→0。',
    },
    {
      id: 's3',
      name: 'S3 终盘水位绝对差',
      hasAuto: true,
      desc: '终盘主水比客水低超0.08→资金明显偏主+1；客水低超0.08→偏客-1；差值在0.08以内→0。',
    },
    {
      id: 's4',
      name: 'S4 盘口与水位背离',
      hasAuto: true,
      desc: '盘口向主队方向升，但主水未降反升→庄家不跟资金，偏客-1。盘口向客队降但客水未降→偏主+1。无背离→0。',
    },
    {
      id: 's5',
      name: 'S5 降盘异常',
      hasAuto: true,
      desc: '赛前出现明显降盘后回升（跨0.5让球档位以上）→回升偏主+1，回升偏客-1。无异常→0。上传截图后可自动识别。',
    },
  ];

  /**
   * autoCalc({ pinnOpenLine, pinnOpenHome, pinnOpenAway,
   *            pinnCloseLine, pinnCloseHome, pinnCloseAway,
   *            willOpenHome, willOpenAway })
   *
   * 根据提供的盘口与水位数据，自动计算可以计算的信号。
   * 返回对象，仅包含能计算出的信号（key = 's1'~'s4'，value = +1/0/-1）。
   * 未提供足够数据时对应 key 不出现，表示"无法自动计算"。
   *
   * 水位越低 = 赔率越低 = 市场资金偏向该方；
   * 盘口负数 = 主队让球（主队热门）；盘口正数 = 客队让球。
   */
  function autoCalc({
    pinnOpenLine  = null, pinnOpenHome  = null, pinnOpenAway  = null,
    pinnCloseLine = null, pinnCloseHome = null, pinnCloseAway = null,
    willOpenHome  = null, willOpenAway  = null,
  } = {}) {
    const result = {};

    const hasClose = pinnCloseHome !== null && pinnCloseAway !== null;
    const hasOpen  = pinnOpenHome  !== null && pinnOpenAway  !== null;
    const hasLines = pinnOpenLine  !== null && pinnCloseLine !== null;
    const hasWill  = willOpenHome  !== null && willOpenAway  !== null;

    // ── S1：平博终盘重心 ─────────────────────────────────────
    if (hasClose) {
      const d = pinnCloseHome - pinnCloseAway;
      result.s1 = d < -Config.WATER_DIFF_S1 ? 1 : d > Config.WATER_DIFF_S1 ? -1 : 0;
    }

    // ── S2：公司分歧（平博 vs 威廉希尔初盘方向）───────────────
    if (hasOpen && hasWill) {
      // diff < 0 = 主水更低 = 偏主；diff > 0 = 客水更低 = 偏客
      const pDiff = pinnOpenHome - pinnOpenAway;
      const wDiff = willOpenHome - willOpenAway;
      const T = Config.WATER_DIFF_S2; // 0.10
      const pinnH = pDiff < -T;  // 平博强烈偏主
      const pinnA = pDiff >  T;  // 平博强烈偏客
      const willH = wDiff < -T;
      const willA = wDiff >  T;
      if ((pinnH && willA) || (pinnA && willH)) {
        result.s2 = pinnH ? 1 : -1; // 跟随平博方向
      } else {
        result.s2 = 0; // 同向或分歧不足
      }
    }

    // ── S3：终盘水位绝对差 ───────────────────────────────────
    if (hasClose) {
      const d = pinnCloseHome - pinnCloseAway;
      result.s3 = d < -Config.WATER_DIFF_S3 ? 1 : d > Config.WATER_DIFF_S3 ? -1 : 0;
    }

    // ── S4：盘口与水位背离 ───────────────────────────────────
    // 需要：初盘线 + 终盘线 + 初盘水位 + 终盘水位
    if (hasLines && hasOpen && hasClose) {
      const lineDelta  = pinnCloseLine - pinnOpenLine;  // 负 = 盘口向主队移动（主让更多）
      const homeDelta  = pinnCloseHome - pinnOpenHome;  // 正 = 主水上升（资金离开主队）
      const awayDelta  = pinnCloseAway - pinnOpenAway;
      const LINE_TH    = 0.1;   // 有意义的盘口变化（0.25档的40%）
      const WATER_TH   = 0.03;  // 有意义的水位变化

      if (Math.abs(lineDelta) < LINE_TH) {
        result.s4 = 0; // 盘口没有明显移动
      } else if (lineDelta < -LINE_TH) {
        // 盘口向主队方向移动（主让更多）
        // 正常：主水应下降（资金跟进主队）
        // 异常：主水反而上升 → 庄家不跟 → 偏客 -1
        result.s4 = homeDelta > WATER_TH ? -1 : 0;
      } else {
        // 盘口向客队方向移动（主让减少）
        // 正常：客水应下降
        // 异常：客水反而上升 → 庄家不跟 → 偏主 +1
        result.s4 = awayDelta > WATER_TH ? 1 : 0;
      }
    }

    return result;
  }

  /**
   * lineToLabel(line) — 将盘口数值转为中文标签
   * 例：-0.5 → "主让半球"，0 → "平手"，0.25 → "平/半（客）"
   */
  function lineToLabel(line) {
    if (line === null || line === undefined || isNaN(line)) return '';
    const m = {
      '-2': '主让两球',    '-1.75': '主让一球半/两球', '-1.5': '主让一球半',
      '-1.25': '主让一/一球半', '-1': '主让一球',   '-0.75': '主让半/一球',
      '-0.5': '主让半球',  '-0.25': '平/半（主）',  '0': '平手',
      '0.25': '平/半（客）', '0.5': '客让半球',    '0.75': '客让半/一球',
      '1': '客让一球',     '1.25': '客让一/一球半', '1.5': '客让一球半',
      '2': '客让两球',
    };
    return m[String(line)] || (line < 0 ? `主让${Math.abs(line)}球` : `客让${line}球`);
  }

  /**
   * interpret(total)
   * 将亚盘总分（-5 到 +5）转为中文描述
   */
  function interpret(total) {
    if (total >= 4)  return '亚盘强烈支持主队';
    if (total >= 2)  return '亚盘偏主，信号较清晰';
    if (total === 1) return '亚盘轻微偏主，信号偏弱';
    if (total === 0) return '亚盘中性，无明确方向';
    if (total === -1) return '亚盘轻微偏客，信号偏弱';
    if (total >= -3) return '亚盘偏客，信号较清晰';
    return '亚盘强烈支持客队';  // <= -4
  }

  return { SIGNALS, interpret, autoCalc, lineToLabel };
})();
