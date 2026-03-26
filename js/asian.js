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
      hasAuto: false,
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
      hasAuto: false,
      desc: '盘口向主队方向升，但主水未降反升→庄家不跟资金，偏客-1。盘口向客队降但客水未降→偏主+1。无背离→0。',
    },
    {
      id: 's5',
      name: 'S5 降盘异常',
      hasAuto: false,
      desc: '赛前出现明显降盘后回升（跨0.5让球档位以上）→回升偏主+1，回升偏客-1。无异常→0。',
    },
  ];

  /**
   * autoCalc(pinnHomeWater, pinnAwayWater)
   * 根据平博主/客水位自动计算 s1、s3 信号值
   * 返回 { s1: +1/0/-1, s3: +1/0/-1 } 或 null（水位未提供时）
   *
   * 注意：水位越低 = 该方向赔率越低 = 市场资金支持该方向
   * 因此主水低于客水 → 偏主 +1；客水低于主水 → 偏客 -1
   *
   * diff = pinnHomeWater - pinnAwayWater
   *   diff < -THRESHOLD → 主水更低 → 偏主 +1
   *   diff > +THRESHOLD → 客水更低 → 偏客 -1
   *   |diff| <= THRESHOLD → 中性 0
   */
  function autoCalc(pinnHomeWater, pinnAwayWater) {
    if (pinnHomeWater === null || pinnHomeWater === undefined ||
        pinnAwayWater === null || pinnAwayWater === undefined) {
      return null;
    }

    const diff = pinnHomeWater - pinnAwayWater;

    // S1：使用 WATER_DIFF_S1 阈值
    let s1;
    if (diff < -Config.WATER_DIFF_S1) {
      s1 = +1;  // 主水更低 → 偏主
    } else if (diff > Config.WATER_DIFF_S1) {
      s1 = -1;  // 客水更低 → 偏客
    } else {
      s1 = 0;
    }

    // S3：使用 WATER_DIFF_S3 阈值
    let s3;
    if (diff < -Config.WATER_DIFF_S3) {
      s3 = +1;  // 主水明显更低 → 偏主
    } else if (diff > Config.WATER_DIFF_S3) {
      s3 = -1;  // 客水明显更低 → 偏客
    } else {
      s3 = 0;
    }

    return { s1, s3 };
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

  return { SIGNALS, interpret, autoCalc };
})();
