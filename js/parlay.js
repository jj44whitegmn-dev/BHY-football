/**
 * parlay.js — Chinese Sports Lottery Parlay Calculator
 * Supports: 2串1, 3串1, 4串1, 5串1, 6串1
 * Rule: All selections must win (single accumulator per n-parlay)
 */

const Parlay = (() => {

  /**
   * Calculate total odds for a list of selections.
   * @param {Array<{odds: number}>} selections
   */
  function totalOdds(selections) {
    return +selections.reduce((acc, s) => acc * s.odds, 1).toFixed(4);
  }

  /**
   * Potential payout (stake × totalOdds), includes returned stake.
   */
  function potentialWin(stake, tOdds) {
    return +(stake * tOdds).toFixed(2);
  }

  /**
   * Net profit (payout − stake).
   */
  function netProfit(stake, tOdds) {
    return +(stake * tOdds - stake).toFixed(2);
  }

  /**
   * Theoretical win probability (product of individual probabilities).
   * @param {Array<{matchId: string, selection: string}>} selections
   * @param {Array} matches  — from Storage.Matches.all()
   */
  function winProbability(selections, matches) {
    return selections.reduce((p, sel) => {
      const m = matches.find(m => m.id === sel.matchId);
      if (!m) return p * 0.33;
      const prob =
        sel.selection === 'home' ? m.predHomeProb :
        sel.selection === 'draw' ? m.predDrawProb :
        m.predAwayProb;
      return p * (prob || 0.33);
    }, 1);
  }

  /**
   * Expected Value per unit staked for the parlay.
   * EV = winProb × totalOdds - 1
   * Positive EV means the parlay has positive expected return.
   */
  function parlayEV(stake, tOdds, winProb) {
    return +(winProb * tOdds - 1).toFixed(4);
  }

  /**
   * Build a complete parlay summary object.
   * @param {Array<{matchId, selection, odds, matchLabel}>} selections
   * @param {number} stake
   * @param {Array} allMatches
   */
  function buildSummary(selections, stake, allMatches) {
    const n      = selections.length;
    const tOdds  = totalOdds(selections);
    const pWin   = potentialWin(stake, tOdds);
    const profit = netProfit(stake, tOdds);
    const winP   = winProbability(selections, allMatches);
    const ev     = parlayEV(stake, tOdds, winP);
    return {
      type:         `${n}串1`,
      count:        n,
      totalOdds:    tOdds,
      stake,
      potentialWin: pWin,
      netProfit:    profit,
      winProbability: +winP.toFixed(4),
      ev,
      evLabel:      ev >= 0 ? '正期望值 ✓' : '负期望值',
      isPositiveEV: ev >= 0,
    };
  }

  /**
   * Validate parlay selections.
   * Returns { valid: bool, error: string|null }
   */
  function validate(selections, stake) {
    if (selections.length < 2)
      return { valid: false, error: '串关至少需要2场比赛' };
    if (selections.length > 8)
      return { valid: false, error: '串关最多8场比赛' };
    if (!stake || stake < 2)
      return { valid: false, error: '最低投注金额为2元' };
    if (stake % 2 !== 0 && stake < 2)
      return { valid: false, error: '投注金额须为整数元' };
    const ids = selections.map(s => s.matchId);
    if (new Set(ids).size !== ids.length)
      return { valid: false, error: '同一场比赛不能重复选择' };
    for (const s of selections) {
      if (!s.odds || s.odds < 1.01)
        return { valid: false, error: `赔率数据不完整，请检查所选比赛` };
    }
    return { valid: true, error: null };
  }

  /**
   * Get odds for a selection from a match.
   * Uses closing odds if available, else opening odds.
   * @param {object} match
   * @param {string} selection 'home'|'draw'|'away'
   */
  function getMatchOdds(match, selection) {
    const map = {
      home: ['closeHome', 'openHome'],
      draw: ['closeDraw', 'openDraw'],
      away: ['closeAway', 'openAway'],
    };
    for (const key of (map[selection] || [])) {
      if (match[key] && match[key] > 1) return match[key];
    }
    return null;
  }

  return {
    totalOdds,
    potentialWin,
    netProfit,
    winProbability,
    parlayEV,
    buildSummary,
    validate,
    getMatchOdds,
  };
})();
