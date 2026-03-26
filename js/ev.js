const EV = (() => {

  /**
   * analyze(pModel, oHome, oDraw, oAway)
   *
   * pModel = { home, draw, away } — 来自 Veto.analyze() 的概率
   * oHome, oDraw, oAway — 赔率（欧赔格式，例如 2.10）
   *
   * 返回：{ implied, ev, gap, overround, judgments, bestSide }
   */
  function analyze(pModel, oHome, oDraw, oAway) {

    // 超额比率（超出 1 的部分为庄家水钱，以百分比表示）
    const overround = (1 / oHome + 1 / oDraw + 1 / oAway - 1) * 100;

    // mu：去水后归一化因子
    const mu = 1 / (1 / oHome + 1 / oDraw + 1 / oAway);

    // implied：去水后市场隐含概率
    const implied = {
      home: mu / oHome,
      draw: mu / oDraw,
      away: mu / oAway,
    };

    // ev：期望价值 = 模型概率 × 赔率
    const ev = {
      home: pModel.home * oHome,
      draw: pModel.draw * oDraw,
      away: pModel.away * oAway,
    };

    // gap：模型概率与市场隐含概率的差值（正值 = 模型认为该方向被低估）
    const gap = {
      home: pModel.home - implied.home,
      draw: pModel.draw - implied.draw,
      away: pModel.away - implied.away,
    };

    // judgments：对每个方向的价值判断
    // 'valid'：EV > 阈值 且 gap > 强阈值
    // 'weak'：EV > 阈值 或 gap > 弱阈值（但不满足 valid）
    // 'none'：其余情况
    function _judge(side) {
      const e = ev[side];
      const g = gap[side];
      if (e > Config.EV_THRESHOLD && g > Config.GAP_STRONG) return 'valid';
      if (e > Config.EV_THRESHOLD || g > Config.GAP_WEAK) return 'weak';
      return 'none';
    }

    const judgments = {
      home: _judge('home'),
      draw: _judge('draw'),
      away: _judge('away'),
    };

    // bestSide：EV 最高的方向
    const bestSide = ev.home >= ev.draw && ev.home >= ev.away
      ? 'home'
      : ev.draw >= ev.away
        ? 'draw'
        : 'away';

    return {
      implied,
      ev,
      gap,
      overround,
      judgments,
      bestSide,
    };
  }

  return { analyze };
})();
