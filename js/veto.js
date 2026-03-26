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
    if (n === 0) return { win: 0, draw: 0, loss: 0 };

    let totalWeight = 0;
    let winWeight = 0;
    let drawWeight = 0;
    let lossWeight = 0;

    for (let i = 0; i < n; i++) {
      const w = Math.pow(decay, n - 1 - i);
      totalWeight += w;
      if (seq[i] === 'W') winWeight += w;
      else if (seq[i] === 'D') drawWeight += w;
      else if (seq[i] === 'L') lossWeight += w;
    }

    if (totalWeight === 0) return { win: 0, draw: 0, loss: 0 };
    return {
      win:  winWeight  / totalWeight,
      draw: drawWeight / totalWeight,
      loss: lossWeight / totalWeight,
    };
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
    // P_draw = (主队平率 + 客队平率) / 2
    let p_home = pH.win * (1 - pA.win);
    let p_away = pA.win * (1 - pH.win);
    let p_draw = (pH.draw + pA.draw) / 2;

    // 4. 归一化
    let total = p_home + p_draw + p_away;
    if (total > 0) {
      p_home /= total;
      p_draw /= total;
      p_away /= total;
    } else {
      // 没有有效数据时均匀分布
      p_home = 1 / 3;
      p_draw = 1 / 3;
      p_away = 1 / 3;
    }

    // 5. 检查平局修正条件 A/B/C
    const correction_conditions_met = [];

    // 条件 A：联赛平局率高于阈值
    const leagueDrawRate = Config.LEAGUE_DRAW_RATES[league] ?? Config.LEAGUE_DRAW_RATES['其他'];
    if (leagueDrawRate > Config.DRAW_RATE_THRESHOLD) {
      correction_conditions_met.push('A');
    }

    // 条件 B：主客队最近5场平局数合计 >= 阈值
    const homeDraws5 = _countDrawsInLast5(home_seq_parsed);
    const awayDraws5 = _countDrawsInLast5(away_seq_parsed);
    if (homeDraws5 + awayDraws5 >= Config.DRAW_COUNT_THRESHOLD) {
      correction_conditions_met.push('B');
    }

    // 条件 C：平博主客水位差 < 平局水位差阈值
    if (pinnHomeWater !== null && pinnAwayWater !== null) {
      const diff = Math.abs(pinnHomeWater - pinnAwayWater);
      if (diff < Config.WATER_DIFF_DRAW) {
        correction_conditions_met.push('C');
      }
    }

    // 6. 满足 >=2 个条件时应用平局修正
    let draw_correction_triggered = false;
    if (correction_conditions_met.length >= 2) {
      p_draw *= Config.DRAW_CORRECTION_FACTOR;
      // 重新归一化
      const total2 = p_home + p_draw + p_away;
      if (total2 > 0) {
        p_home /= total2;
        p_draw /= total2;
        p_away /= total2;
      }
      draw_correction_triggered = true;
    }

    // 7. 返回结果
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
