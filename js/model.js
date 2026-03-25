/**
 * model.js — Football Prediction Model
 * Elo Rating System + Dixon-Coles Poisson Model
 */

const Model = (() => {
  const HOME_ADV_ELO = 100;       // Elo home advantage offset
  const HOME_ADV_GOALS = 1.25;    // Goal expectation multiplier for home
  const LEAGUE_AVG = 1.35;        // League average goals per team per game
  const MAX_GOALS = 8;            // Max goals to sum in Poisson
  const RHO = -0.1;               // Dixon-Coles low-score correction
  const K_LEAGUE = 20;            // Elo K-factor for league
  const K_CUP = 10;               // Elo K-factor for cup/friendly
  const ELO_WEIGHT = 0.3;         // Elo blend weight (0.3 = 30% Elo, 70% form)

  // ── Maths helpers ──────────────────────────────────────────

  const _logFact = [0];
  function logFactorial(n) {
    while (_logFact.length <= n) {
      _logFact.push(_logFact[_logFact.length - 1] + Math.log(_logFact.length));
    }
    return _logFact[n];
  }

  function poissonPMF(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
  }

  // Dixon-Coles low-score correction factor (τ)
  function dcTau(i, j, mu1, mu2, rho) {
    if (i === 0 && j === 0) return 1 - mu1 * mu2 * rho;
    if (i === 1 && j === 0) return 1 + mu2 * rho;
    if (i === 0 && j === 1) return 1 + mu1 * rho;
    if (i === 1 && j === 1) return 1 - rho;
    return 1;
  }

  // Elo win expectation for team A vs B
  function eloExpected(eloA, eloB) {
    return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
  }

  // ── Expected goals from form data ──────────────────────────

  function getExpectedGoals(homeForm, awayForm, injuriesDiff = 0) {
    const homeGFpg = homeForm.gf / 5;
    const homeGApg = homeForm.ga / 5;
    const awayGFpg = awayForm.gf / 5;
    const awayGApg = awayForm.ga / 5;

    // Relative attack/defense strength vs league average
    const safeDiv = (a, b) => b > 0 ? a / b : 1;
    const homeAtt  = safeDiv(homeGFpg, LEAGUE_AVG);
    const homeDef  = safeDiv(homeGApg, LEAGUE_AVG);
    const awayAtt  = safeDiv(awayGFpg, LEAGUE_AVG);
    const awayDef  = safeDiv(awayGApg, LEAGUE_AVG);

    let muHome = homeAtt * awayDef * LEAGUE_AVG * HOME_ADV_GOALS;
    let muAway = awayAtt * homeDef * LEAGUE_AVG;

    // Injury penalty (each injury reduces expected goals by ~4%)
    muHome *= Math.max(0.75, 1 - injuriesDiff * 0.04);

    return {
      muHome: Math.max(0.25, Math.min(5, muHome)),
      muAway: Math.max(0.25, Math.min(5, muAway)),
    };
  }

  // ── Poisson + DC probability matrix ────────────────────────

  function calcScoreMatrix(muHome, muAway) {
    const matrix = [];
    for (let i = 0; i <= MAX_GOALS; i++) {
      matrix[i] = [];
      for (let j = 0; j <= MAX_GOALS; j++) {
        matrix[i][j] =
          poissonPMF(i, muHome) *
          poissonPMF(j, muAway) *
          dcTau(i, j, muHome, muAway, RHO);
      }
    }
    return matrix;
  }

  function matrixToProbs(matrix) {
    let pHome = 0, pDraw = 0, pAway = 0;
    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        const p = matrix[i][j];
        if (i > j) pHome += p;
        else if (i === j) pDraw += p;
        else pAway += p;
      }
    }
    const total = pHome + pDraw + pAway;
    return { home: pHome / total, draw: pDraw / total, away: pAway / total };
  }

  // Most likely score from matrix
  function mostLikelyScore(matrix) {
    let bestP = -1, bI = 1, bJ = 0;
    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        if (matrix[i][j] > bestP) { bestP = matrix[i][j]; bI = i; bJ = j; }
      }
    }
    return { home: bI, away: bJ };
  }

  // ── Odds-based probability (closing line) ──────────────────

  function oddsToProb(homeOdds, drawOdds, awayOdds) {
    if (!homeOdds || !drawOdds || !awayOdds) return null;
    const raw = [1 / homeOdds, 1 / drawOdds, 1 / awayOdds];
    const sum = raw.reduce((a, b) => a + b, 0);
    return { home: raw[0] / sum, draw: raw[1] / sum, away: raw[2] / sum };
  }

  // Detect steam move: closing odds shorter than opening → money on that side
  function steamAnalysis(openHome, openDraw, openAway, closeHome, closeDraw, closeAway) {
    if (!openHome || !closeHome) return null;
    // Lower odds = more money on that side
    const moves = [];
    if (closeHome < openHome - 0.05) moves.push('home');
    if (closeDraw < openDraw - 0.05) moves.push('draw');
    if (closeAway < openAway - 0.05) moves.push('away');
    return moves.length ? moves : null;
  }

  // ── Confidence judgment ─────────────────────────────────────

  function getConfidence(probs) {
    const sorted = [probs.home, probs.draw, probs.away].sort((a, b) => b - a);
    const maxP = sorted[0], secondP = sorted[1];
    const diff = maxP - secondP;
    if (maxP > 0.55 && diff > 0.15) return 'high';
    if (maxP > 0.44 && diff > 0.08) return 'medium';
    return 'low';
  }

  function getRecommendation(probs) {
    if (probs.home >= probs.draw && probs.home >= probs.away) return 'home';
    if (probs.away >= probs.draw && probs.away >= probs.home) return 'away';
    return 'draw';
  }

  // ── Main predict function ───────────────────────────────────

  /**
   * @param {object} homeTeam  { elo }
   * @param {object} awayTeam  { elo }
   * @param {object} homeForm  { w, d, l, gf, ga }  (last 5 games)
   * @param {object} awayForm  { w, d, l, gf, ga }
   * @param {object} [odds]    { openHome, openDraw, openAway, closeHome, closeDraw, closeAway }
   * @param {number} [homeInjuries]
   */
  function predict(homeTeam, awayTeam, homeForm, awayForm, odds = {}, homeInjuries = 0) {
    const injDiff = homeInjuries;
    const { muHome, muAway } = getExpectedGoals(homeForm, awayForm, injDiff);
    const matrix = calcScoreMatrix(muHome, muAway);
    const formProbs = matrixToProbs(matrix);
    const predScore = mostLikelyScore(matrix);

    // Elo blend
    const homeEloAdj = homeTeam.elo + HOME_ADV_ELO;
    const eloExp = eloExpected(homeEloAdj, awayTeam.elo);
    const DRAW_RATE = 0.27;
    const eloProbs = {
      home: eloExp * (1 - DRAW_RATE),
      draw: DRAW_RATE,
      away: (1 - eloExp) * (1 - DRAW_RATE),
    };

    let blended = {
      home: (1 - ELO_WEIGHT) * formProbs.home + ELO_WEIGHT * eloProbs.home,
      draw: (1 - ELO_WEIGHT) * formProbs.draw + ELO_WEIGHT * eloProbs.draw,
      away: (1 - ELO_WEIGHT) * formProbs.away + ELO_WEIGHT * eloProbs.away,
    };

    // Closing odds blend (if provided, 20% weight)
    const closeProb = oddsToProb(odds.closeHome, odds.closeDraw, odds.closeAway);
    if (closeProb) {
      const OW = 0.2;
      blended = {
        home: (1 - OW) * blended.home + OW * closeProb.home,
        draw: (1 - OW) * blended.draw + OW * closeProb.draw,
        away: (1 - OW) * blended.away + OW * closeProb.away,
      };
    }

    // Normalize
    const tot = blended.home + blended.draw + blended.away;
    const probs = {
      home: blended.home / tot,
      draw: blended.draw / tot,
      away: blended.away / tot,
    };

    // Steam move detection
    const steam = steamAnalysis(
      odds.openHome, odds.openDraw, odds.openAway,
      odds.closeHome, odds.closeDraw, odds.closeAway
    );

    // EV calculation (if closing odds provided)
    let ev = null;
    const rec = getRecommendation(probs);
    if (closeProb) {
      const recOdds = rec === 'home' ? odds.closeHome : rec === 'draw' ? odds.closeDraw : odds.closeAway;
      const recProb = probs[rec];
      ev = calcEV(recProb, recOdds);
    }

    return {
      homeProb: probs.home,
      drawProb: probs.draw,
      awayProb: probs.away,
      predScoreHome: predScore.home,
      predScoreAway: predScore.away,
      recommendation: rec,
      confidence: getConfidence(probs),
      muHome: Math.round(muHome * 100) / 100,
      muAway: Math.round(muAway * 100) / 100,
      steam,
      ev: ev !== null ? Math.round(ev * 1000) / 1000 : null,
    };
  }

  // ── Elo update after result ─────────────────────────────────

  function updateElo(homeElo, awayElo, homeGoals, awayGoals, isCup = false) {
    const K = isCup ? K_CUP : K_LEAGUE;
    const homeEloAdj = homeElo + HOME_ADV_ELO;
    const expected = eloExpected(homeEloAdj, awayElo);
    const actual = homeGoals > awayGoals ? 1 : homeGoals === awayGoals ? 0.5 : 0;
    const delta = Math.round(K * (actual - expected));
    return {
      newHomeElo: homeElo + delta,
      newAwayElo: awayElo - delta,
      delta,
    };
  }

  // ── EV helper ───────────────────────────────────────────────

  function calcEV(prob, odds) {
    // EV per unit staked; positive = value bet
    return prob * (odds - 1) - (1 - prob);
  }

  return { predict, updateElo, calcEV, oddsToProb };
})();
