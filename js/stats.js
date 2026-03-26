const Stats = (() => {

  /**
   * _completed() — 获取所有已填写赛果的记录
   */
  function _completed() {
    return Storage.Records.getAll().filter(r => r.actual_result && r.actual_result !== '');
  }

  /**
   * isUnlocked() — 统计功能是否解锁（需要 >= STATS_UNLOCK_COUNT 条已完成记录）
   */
  function isUnlocked() {
    return _completed().length >= Config.STATS_UNLOCK_COUNT;
  }

  /**
   * getCompletedCount() — 返回已填写赛果的记录数量
   */
  function getCompletedCount() {
    return _completed().length;
  }

  /**
   * compute() — 计算全量统计数据
   * 记录数不足时返回 null
   */
  function compute() {
    const completed = _completed();
    if (completed.length < Config.STATS_UNLOCK_COUNT) return null;

    const total = completed.length;

    // ── 整体准确率 ───────────────────────────────────────────────────
    // 只计算有推荐方向的记录
    const withRecommend = completed.filter(r => r.recommend != null);
    const correctCount  = withRecommend.filter(r => r.is_correct === true).length;
    const accuracy = withRecommend.length > 0
      ? correctCount / withRecommend.length
      : null;

    // ── 按等级统计 ───────────────────────────────────────────────────
    // 只统计 ★★★ 和 ★★ 两个等级，且有推荐方向的记录
    const levelStats = {};
    for (const levelPrefix of ['★★★', '★★']) {
      const inLevel = completed.filter(r =>
        r.recommend != null &&
        typeof r.decision === 'string' &&
        r.decision.startsWith(levelPrefix)
      );
      const correctInLevel = inLevel.filter(r => r.is_correct === true).length;
      levelStats[levelPrefix] = {
        count:    inLevel.length,
        accuracy: inLevel.length > 0 ? correctInLevel / inLevel.length : null,
      };
    }

    // ── 信号统计（S1~S5）────────────────────────────────────────────
    // 对每个信号，在该信号不为 0 的记录中，计算方向判断正确率
    // signal > 0（偏主）且 actual_result === '主胜' → 正确
    // signal < 0（偏客）且 actual_result === '客胜' → 正确
    const signalStats = {};
    for (const sig of ['s1', 's2', 's3', 's4', 's5']) {
      const relevant = completed.filter(r =>
        r.asian_signals &&
        r.asian_signals[sig] !== undefined &&
        r.asian_signals[sig] !== 0
      );
      const correct = relevant.filter(r => {
        const val = r.asian_signals[sig];
        return (val > 0 && r.actual_result === '主胜') ||
               (val < 0 && r.actual_result === '客胜');
      });
      signalStats[sig] = {
        total:    relevant.length,
        accuracy: relevant.length > 0 ? correct.length / relevant.length : null,
      };
    }

    // ── 联赛统计 ─────────────────────────────────────────────────────
    const leagueMap = {};
    for (const r of completed) {
      const league = r.league || '其他';
      if (!leagueMap[league]) {
        leagueMap[league] = { total: 0, drawCount: 0, drawProbSum: 0 };
      }
      leagueMap[league].total++;
      if (r.actual_result === '平局') leagueMap[league].drawCount++;
      // model_avg_draw_prob：记录中保存的模型平局概率（来自 Veto）
      if (typeof r.p_draw === 'number') {
        leagueMap[league].drawProbSum += r.p_draw;
      }
    }
    const leagueStats = {};
    for (const [league, data] of Object.entries(leagueMap)) {
      leagueStats[league] = {
        total:               data.total,
        actual_draw_rate:    data.total > 0 ? data.drawCount / data.total : null,
        model_avg_draw_prob: data.total > 0 ? data.drawProbSum / data.total : null,
      };
    }

    // ── 平局修正统计 ─────────────────────────────────────────────────
    // 对比启用/未启用平局修正时的实际平局率
    const withCorrection    = completed.filter(r => r.draw_correction_triggered === true);
    const withoutCorrection = completed.filter(r => r.draw_correction_triggered === false ||
                                                     r.draw_correction_triggered == null);

    function _drawRate(arr) {
      if (arr.length === 0) return null;
      return arr.filter(r => r.actual_result === '平局').length / arr.length;
    }

    const drawCorrectionStats = {
      with_correction: {
        total:             withCorrection.length,
        actual_draw_rate:  _drawRate(withCorrection),
      },
      without_correction: {
        total:             withoutCorrection.length,
        actual_draw_rate:  _drawRate(withoutCorrection),
      },
    };

    return {
      total,
      accuracy,
      levelStats,
      signalStats,
      leagueStats,
      drawCorrectionStats,
    };
  }

  return { isUnlocked, getCompletedCount, compute };
})();
