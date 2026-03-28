const Stats = (() => {

  /**
   * _completed() — 获取所有已填写赛果的记录
   */
  function _completed() {
    return Storage.Records.getAll().filter(r => r.actual_result && r.actual_result !== '');
  }

  /**
   * isUnlocked() — 有至少1条已完成记录即可查看
   */
  function isUnlocked() {
    return _completed().length >= 1;
  }

  /**
   * getCompletedCount() — 返回已填写赛果的记录数量
   */
  function getCompletedCount() {
    return _completed().length;
  }

  /**
   * compute() — 计算全量统计数据
   * 无记录时返回 null
   */
  function compute() {
    const completed = _completed();
    if (completed.length === 0) return null;

    const total = completed.length;

    // ── 整体准确率 ───────────────────────────────────────────────────
    const withRecommend = completed.filter(r => r.recommend != null);
    const correctCount  = withRecommend.filter(r => r.is_correct === true).length;
    const accuracy = withRecommend.length > 0 ? correctCount / withRecommend.length : null;
    const accuracyCount = withRecommend.length;

    // ── 按等级统计 ───────────────────────────────────────────────────
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
    // 对每个信号，在该信号不为0的记录中计算方向命中率
    const signalStats = {};
    for (const sig of ['s0', 's1', 's2', 's3', 's4', 's5']) {
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

    // ── 亚盘总分与结果相关性 ─────────────────────────────────────────
    // 按 |total| 分组：≥3 / 1-2 / =0
    const tcGroups = {
      high: completed.filter(r => r.asian_signals && Math.abs(r.asian_signals.total || 0) >= 3),
      mid:  completed.filter(r => r.asian_signals && Math.abs(r.asian_signals.total || 0) >= 1 && Math.abs(r.asian_signals.total || 0) <= 2),
      zero: completed.filter(r => !r.asian_signals || (r.asian_signals.total || 0) === 0),
    };
    const totalCorrelation = {};
    for (const [key, arr] of Object.entries(tcGroups)) {
      if (key === 'zero') {
        totalCorrelation[key] = { count: arr.length, accuracy: null };
        continue;
      }
      const correct = arr.filter(r => {
        const t = r.asian_signals.total;
        return (t > 0 && r.actual_result === '主胜') || (t < 0 && r.actual_result === '客胜');
      });
      totalCorrelation[key] = {
        count:    arr.length,
        accuracy: arr.length > 0 ? correct.length / arr.length : null,
      };
    }

    // ── 各联赛命中率 ─────────────────────────────────────────────────
    const leagueMap = {};
    for (const r of completed) {
      const league = r.league || '其他';
      if (!leagueMap[league]) leagueMap[league] = { total: 0, withRecommend: 0, correct: 0 };
      leagueMap[league].total++;
      if (r.recommend != null) {
        leagueMap[league].withRecommend++;
        if (r.is_correct === true) leagueMap[league].correct++;
      }
    }
    const leagueStats = {};
    for (const [league, data] of Object.entries(leagueMap)) {
      leagueStats[league] = {
        total:         data.total,
        withRecommend: data.withRecommend,
        accuracy:      data.withRecommend > 0 ? data.correct / data.withRecommend : null,
      };
    }

    // ── 否决模型方向命中率（所有完成记录，不限是否有推荐）──────────────
    const vetoCorrect = completed.filter(r => {
      const vo = r.veto_output || r.veto_model_output || {};
      const probs = vo.calibrated || vo.raw || vo;
      if (!probs || typeof probs !== 'object') return false;
      const pred = Object.keys(probs).reduce((a, b) => probs[a] > probs[b] ? a : b);
      const map = { home: '主胜', draw: '平局', away: '客胜' };
      return map[pred] === r.actual_result;
    });
    const vetoAccuracy = completed.length > 0 ? vetoCorrect.length / completed.length : null;

    // ── CLV 统计（需赛后补录关盘赔率）────────────────────────────────
    const withClv = completed.filter(r => typeof r.clv === 'number');
    const clvStats = withClv.length > 0 ? {
      count:    withClv.length,
      avgClv:   withClv.reduce((s, r) => s + r.clv, 0) / withClv.length,
      posCount: withClv.filter(r => r.clv > 0).length,
    } : null;

    return {
      total,
      accuracy,
      accuracyCount,
      vetoAccuracy,
      levelStats,
      signalStats,
      totalCorrelation,
      leagueStats,
      clvStats,
    };
  }

  return { isUnlocked, getCompletedCount, compute };
})();
