/**
 * storage.js — localStorage 数据层
 * 职责：只负责本地存储、迁移、CRUD。
 * 不依赖 engine.js / model.js / ui.js。
 */

const Storage = (() => {
  const K = {
    matches:      'ftb_matches',
    bets:         'ftb_bets',
    autocomplete: 'ftb_autocomplete',
    config:       'ftb_config',
  };

  function _read(key, fallback = []) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }

  function _write(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function _id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function _now() { return new Date().toISOString(); }

  // ── 数据迁移（v1→v3）────────────────────────────────────────────
  // 老格式字段（homeTeamId 等）静默迁移为新格式，保留所有旧记录
  function _migrateMatch(m) {
    if (m.home_team) return m; // 已是新格式
    return {
      id: m.id,
      match_date: m.matchDate || '',
      competition: m.league || '',
      home_team: m.homeTeamId || '',   // 旧格式只有 ID，无法还原名称，原样保留
      away_team: m.awayTeamId || '',
      createdAt: m.createdAt,
      // 旧分析字段映射（仅供展示，不再重算）
      _legacy: true,
      _legacy_data: m,
    };
  }

  // ── 自动补全词库 ────────────────────────────────────────────────
  const Autocomplete = {
    get() {
      return _read(K.autocomplete, { teams: [], competitions: [] });
    },
    addTeam(name) {
      if (!name) return;
      const ac = this.get();
      if (!ac.teams.includes(name)) {
        ac.teams = [name, ...ac.teams].slice(0, 50);
        _write(K.autocomplete, ac);
      }
    },
    addCompetition(name) {
      if (!name) return;
      const ac = this.get();
      if (!ac.competitions.includes(name)) {
        ac.competitions = [name, ...ac.competitions].slice(0, 30);
        _write(K.autocomplete, ac);
      }
    },
  };

  // ── Matches ──────────────────────────────────────────────────────
  const Matches = {
    all() {
      return _read(K.matches)
        .map(m => _migrateMatch(m))
        .sort((a, b) => new Date(b.match_date) - new Date(a.match_date));
    },
    get(id) {
      const raw = _read(K.matches).find(m => m.id === id);
      return raw ? _migrateMatch(raw) : null;
    },
    pending() {
      return this.all().filter(m => !m.result_1x2);
    },
    completed() {
      return this.all().filter(m => !!m.result_1x2);
    },

    // 保存（新建或更新）
    // analysis 字段由 ui.js 调用 engine 后传入，storage 不感知其内容
    save(match) {
      const matches = _read(K.matches);
      if (match.id) {
        const i = matches.findIndex(m => m.id === match.id);
        if (i >= 0) matches[i] = match;
        else matches.push(match);
      } else {
        match.id = _id();
        match.createdAt = _now();
        matches.push(match);
      }
      _write(K.matches, matches);
      // 顺带更新自动补全词库
      Autocomplete.addTeam(match.home_team);
      Autocomplete.addTeam(match.away_team);
      Autocomplete.addCompetition(match.competition);
      return match;
    },

    // 录入赛后结果（只写结果字段，不调用 engine）
    // result_1x2 和 profit_loss 由 ui.js 计算后传入
    setResult(id, homeGoals, awayGoals, result1x2, userBetSide, userBetOdds, userStake, profitLoss) {
      const matches = _read(K.matches);
      const i = matches.findIndex(m => m.id === id);
      if (i < 0) return null;
      matches[i] = {
        ...matches[i],
        result_home_goals: homeGoals,
        result_away_goals: awayGoals,
        result_1x2: result1x2,
        user_bet_side: userBetSide ?? null,
        user_bet_odds: userBetOdds ?? null,
        user_stake: userStake ?? null,
        profit_loss: profitLoss ?? null,
        resultAt: _now(),
      };
      _write(K.matches, matches);
      return matches[i];
    },

    delete(id) {
      _write(K.matches, _read(K.matches).filter(m => m.id !== id));
    },
  };

  // ── Bets ─────────────────────────────────────────────────────────
  const Bets = {
    all() {
      return _read(K.bets).sort((a, b) => new Date(b.betDate) - new Date(a.betDate));
    },
    get(id) {
      return _read(K.bets).find(b => b.id === id) || null;
    },
    save(bet) {
      const bets = _read(K.bets);
      if (bet.id) {
        const i = bets.findIndex(b => b.id === bet.id);
        if (i >= 0) bets[i] = bet;
        else bets.push(bet);
      } else {
        bet.id = _id();
        bet.createdAt = _now();
        bets.push(bet);
      }
      _write(K.bets, bets);
      return bet;
    },
    // 结算（只更新状态字段，盈亏由 ui.js 计算后传入）
    settle(id, status, actualWin) {
      const bets = _read(K.bets);
      const i = bets.findIndex(b => b.id === id);
      if (i < 0 || bets[i].status !== '待结算') return null;
      bets[i].status    = status;
      bets[i].actualWin = actualWin;
      bets[i].settledAt = _now();
      _write(K.bets, bets);
      return bets[i];
    },
    delete(id) {
      _write(K.bets, _read(K.bets).filter(b => b.id !== id));
    },
    summary() {
      const settled = this.all().filter(b => b.status !== '待结算');
      const totalStake  = settled.reduce((s, b) => s + (b.stake || 0), 0);
      const totalReturn = settled.reduce((s, b) => s + (b.actualWin || 0), 0);
      const profit = totalReturn - totalStake;
      const roi    = totalStake > 0 ? (profit / totalStake) * 100 : 0;
      const won    = settled.filter(b => b.status === '已中奖').length;
      const lost   = settled.filter(b => b.status === '未中奖').length;
      return { totalStake, totalReturn, profit, roi, won, lost, total: settled.length };
    },
  };

  // ── 导出 / 导入 ─────────────────────────────────────────────────
  function exportAll() {
    return JSON.stringify({
      version: 3,
      exportedAt: _now(),
      matches:      _read(K.matches),
      bets:         _read(K.bets),
      autocomplete: _read(K.autocomplete, {}),
      config:       _read(K.config, {}),
    }, null, 2);
  }

  function importAll(jsonStr) {
    const d = JSON.parse(jsonStr);
    if (d.matches)      _write(K.matches,      d.matches);
    if (d.bets)         _write(K.bets,          d.bets);
    if (d.autocomplete) _write(K.autocomplete,  d.autocomplete);
    if (d.config)       _write(K.config,        d.config);
  }

  // ── 复盘统计（纯数据聚合，不含分析逻辑）──────────────────────────
  function reviewStats() {
    const done = Matches.completed();
    if (!done.length) return null;

    const total = done.length;
    // 系统推荐视角
    const sysRec = done.filter(m => m.analysis?.whether_to_bet);
    const sysRecCorrect = sysRec.filter(m =>
      m.analysis?.suggested_side === m.result_1x2
    );
    // 实际下注视角
    const actualBet = done.filter(m => m.user_bet_side && m.user_stake > 0);
    const actualWon = actualBet.filter(m => m.user_bet_side === m.result_1x2);
    const actualStake  = actualBet.reduce((s, m) => s + (m.user_stake || 0), 0);
    const actualReturn = actualWon.reduce((s, m) =>
      s + (m.user_stake || 0) * (m.user_bet_odds || 1), 0);

    // 按等级
    const byGrade = {};
    for (const m of done) {
      const g = m.analysis?.confidence_grade || '丙级';
      if (!byGrade[g]) byGrade[g] = { total: 0, sysBet: 0, sysCorrect: 0 };
      byGrade[g].total++;
      if (m.analysis?.whether_to_bet) {
        byGrade[g].sysBet++;
        if (m.analysis.suggested_side === m.result_1x2) byGrade[g].sysCorrect++;
      }
    }

    // 按市场类型
    const byMarket = {};
    for (const m of done) {
      const mt = m.analysis?.market_type_primary || '未知';
      if (!byMarket[mt]) byMarket[mt] = { total: 0, correct: 0 };
      byMarket[mt].total++;
      if (m.analysis?.suggested_side === m.result_1x2) byMarket[mt].correct++;
    }

    // 按规则命中
    const byRule = {};
    for (const m of done) {
      for (const r of (m.analysis?.rules_hit || [])) {
        const key = r.rule_id;
        if (!byRule[key]) byRule[key] = { name: r.rule_name, total: 0, correct: 0 };
        byRule[key].total++;
        if (m.analysis?.suggested_side === m.result_1x2) byRule[key].correct++;
      }
    }

    // 月度财务
    const monthly = {};
    for (const m of done) {
      if (!m.user_stake) continue;
      const month = (m.resultAt || m.match_date || '').slice(0, 7);
      if (!month) continue;
      if (!monthly[month]) monthly[month] = { stake: 0, profit: 0 };
      monthly[month].stake  += m.user_stake;
      monthly[month].profit += (m.profit_loss || 0);
    }
    const monthlyArr = Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v }));

    // 最大回撤（累计资金曲线）
    let peak = 0, maxDD = 0, cumulative = 0;
    for (const m of done.sort((a, b) => new Date(a.match_date) - new Date(b.match_date))) {
      cumulative += (m.profit_loss || 0);
      if (cumulative > peak) peak = cumulative;
      const dd = peak - cumulative;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      total,
      abandonRate: total > 0 ? 1 - actualBet.length / total : 1,
      // 系统推荐视角
      sys: {
        betCount: sysRec.length,
        correctCount: sysRecCorrect.length,
        rate: sysRec.length > 0 ? sysRecCorrect.length / sysRec.length : null,
      },
      // 实际下注视角
      actual: {
        betCount: actualBet.length,
        wonCount: actualWon.length,
        rate: actualBet.length > 0 ? actualWon.length / actualBet.length : null,
        totalStake: actualStake,
        totalReturn: actualReturn,
        profit: actualReturn - actualStake,
        roi: actualStake > 0 ? (actualReturn - actualStake) / actualStake * 100 : null,
        maxDrawdown: maxDD,
      },
      byGrade,
      byMarket,
      byRule,
      monthly: monthlyArr,
    };
  }

  return {
    Matches, Bets, Autocomplete,
    exportAll, importAll,
    reviewStats,
  };
})();
