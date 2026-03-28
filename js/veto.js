const Veto = (() => {

  /**
   * parseSequence(str)
   * 将 "W D L W W" 类字符串拆分为数组，过滤只保留 W/D/L，转大写
   */
  function parseSequence(str) {
    if (!str || typeof str !== 'string') return [];
    return str
      .toUpperCase()
      .split(/[\s,;|]+/)
      .map(s => s.trim())
      .filter(s => s === 'W' || s === 'D' || s === 'L');
  }

  /**
   * _weightedProbs(seq, decay)
   * 给定比赛序列和衰减因子，计算加权的胜/平/负概率
   * weights[i] = decay^(n-1-i)，即越近的比赛权重越大
   */
  function _weightedProbs(seq, decay) {
    const n = seq.length;
    if (n === 0) return { win: 1/3, draw: 1/3, loss: 1/3 };

    let totalWeight = 0;
    let winWeight = 0;
    let drawWeight = 0;

    for (let i = 0; i < n; i++) {
      const w = Math.pow(decay, n - 1 - i);
      totalWeight += w;
      if (seq[i] === 'W') winWeight += w;
      else if (seq[i] === 'D') drawWeight += w;
    }

    // Laplace平滑：每个结果加 ALPHA 虚拟权重，防止0%极端值
    // 例：10场全败时，胜率从0%提升到约10%，更接近现实
    const ALPHA = 1.0;
    const smoothedTotal = totalWeight + ALPHA * 3;
    const win  = (winWeight  + ALPHA) / smoothedTotal;
    const draw = (drawWeight + ALPHA) / smoothedTotal;
    const loss = 1 - win - draw;

    return { win, draw, loss: Math.max(loss, 0) };
  }

  /**
   * _countDrawsInLast5(seq)
   * 统计序列最后5场中平局数量
   */
  function _countDrawsInLast5(seq) {
    const last5 = seq.slice(-5);
    return last5.filter(s => s === 'D').length;
  }

  /**
   * analyze(inputs)
   * inputs = { league, homeSeq (string), awaySeq (string), decay=0.8,
   *            pinnHomeWater=null, pinnAwayWater=null }
   */
  function analyze(inputs) {
    const {
      league,
      homeSeq,
      awaySeq,
      decay = 0.8,
      pinnHomeWater = null,
      pinnAwayWater = null,
    } = inputs;

    // 1. 解析序列
    const home_seq_parsed = parseSequence(homeSeq);
    const away_seq_parsed = parseSequence(awaySeq);

    // 2. 计算各队加权概率
    const pH = _weightedProbs(home_seq_parsed, decay);
    const pA = _weightedProbs(away_seq_parsed, decay);

    // 3. 交叉概率
    // P_home = 主队赢率 * (1 - 客队赢率)
    // P_away = 客队赢率 * (1 - 主队赢率)
    // P_draw = 按实际场次数加权平均（n_home=n_away时与简单平均等价）
    const n_home = home_seq_parsed.length;
    const n_away = away_seq_parsed.length;
    let p_home = pH.win * (1 - pA.win);
    let p_away = pA.win * (1 - pH.win);
    let p_draw = (pH.draw * n_home + pA.draw * n_away) / (n_home + n_away);

    // 4. 归一化 → 原始概率
    let total = p_home + p_draw + p_away;
    if (total > 0) {
      p_home /= total;
      p_draw /= total;
      p_away /= total;
    } else {
      p_home = 1 / 3;
      p_draw = 1 / 3;
      p_away = 1 / 3;
    }

    // 5. 检查平局修正条件 A/B/C（仅作标记，不改变概率数值）
    const correction_conditions_met = [];

    const leagueDrawRate = Config.LEAGUE_DRAW_RATES[league] ?? Config.LEAGUE_DRAW_RATES['其他'];
    if (leagueDrawRate > Config.DRAW_RATE_THRESHOLD) {
      correction_conditions_met.push('A');
    }

    const homeDraws5 = _countDrawsInLast5(home_seq_parsed);
    const awayDraws5 = _countDrawsInLast5(away_seq_parsed);
    if (homeDraws5 + awayDraws5 >= Config.DRAW_COUNT_THRESHOLD) {
      correction_conditions_met.push('B');
    }

    if (pinnHomeWater !== null && pinnAwayWater !== null) {
      const diff = Math.abs(pinnHomeWater - pinnAwayWater);
      if (diff < Config.WATER_DIFF_DRAW) {
        correction_conditions_met.push('C');
      }
    }

    const draw_correction_triggered = correction_conditions_met.length >= 2;

    // 6. 直接返回原始概率（未校准）
    return {
      p_home,
      p_draw,
      p_away,
      draw_correction_triggered,
      correction_conditions_met,
      home_seq_parsed,
      away_seq_parsed,
    };
  }

  return { analyze, parseSequence };
})();
