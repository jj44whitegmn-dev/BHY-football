const Decision = (() => {

  // 方向映射：英文 key → 中文
  const sideMap = {
    home: '主胜',
    draw: '平局',
    away: '客胜',
  };

  /**
   * _formatDetail(evResult, side, asianTotal)
   * 生成决策详情字符串
   * 示例："EV=1.12 / 概率差=+8.3% / 亚盘评分=+3"
   */
  function _formatDetail(evResult, side, asianTotal) {
    const evVal = side ? evResult.ev[side].toFixed(2) : '—';
    const gapVal = side
      ? (evResult.gap[side] >= 0 ? '+' : '') + (evResult.gap[side] * 100).toFixed(1) + '%'
      : '—';
    const asianStr = (asianTotal >= 0 ? '+' : '') + asianTotal;
    return `EV=${evVal} / 概率差=${gapVal} / 亚盘评分=${asianStr}`;
  }

  /**
   * decide(evResult, asianTotal)
   *
   * evResult — 来自 EV.analyze() 的结果
   * asianTotal — 亚盘总分（整数，-5 到 +5）
   *
   * 返回：{ level, text, recommend, detail }
   *   level:     '★★★' | '★★' | '❌' | '⚠️' | '—'
   *   recommend: '主胜' | '平局' | '客胜' | null
   *   text:      简短描述
   *   detail:    详情字符串
   */
  function decide(evResult, asianTotal) {
    const { judgments, bestSide } = evResult;

    // ── 平局专项 ─────────────────────────────────────────────────────
    // 仅当 bestSide === 'draw' 且平局判断为 valid 或 weak 时进入此分支
    if (bestSide === 'draw' && (judgments.draw === 'valid' || judgments.draw === 'weak')) {
      const absAsian = Math.abs(asianTotal);

      if (judgments.draw === 'valid') {
        if (absAsian <= Config.DRAW_ASIAN_STRONG) {
          return {
            level: '★★★',
            recommend: '平局',
            text: '强烈建议：平局',
            detail: _formatDetail(evResult, 'draw', asianTotal),
          };
        }
        if (absAsian <= Config.DRAW_ASIAN_WEAK) {
          return {
            level: '★★',
            recommend: '平局',
            text: '建议考虑：平局',
            detail: _formatDetail(evResult, 'draw', asianTotal),
          };
        }
        // absAsian > DRAW_ASIAN_WEAK
        return {
          level: '❌',
          recommend: null,
          text: '平局有价值，但市场明显偏向一方',
          detail: _formatDetail(evResult, 'draw', asianTotal),
        };
      }

      // judgments.draw === 'weak'
      if (absAsian <= Config.DRAW_ASIAN_WEAK) {
        return {
          level: '★★',
          recommend: '平局',
          text: '建议考虑：平局（弱价值）',
          detail: _formatDetail(evResult, 'draw', asianTotal),
        };
      }
      return {
        level: '❌',
        recommend: null,
        text: '平局弱价值，亚盘方向明显偏向一方',
        detail: _formatDetail(evResult, 'draw', asianTotal),
      };
    }

    // ── 主胜 / 客胜 ──────────────────────────────────────────────────
    // 找出第一个 valid 方向（非平局）
    const validSide = ['home', 'away'].find(s => judgments[s] === 'valid') || null;
    // 找出第一个 weak 方向（非平局，且没有 valid 时才使用）
    const weakSide = ['home', 'away'].find(s => judgments[s] === 'weak') || null;

    /**
     * _directionMatch(side, asianTotal)
     * 检查亚盘方向是否与推荐方向一致
     * home 需要 asianTotal >= ASIAN_WEAK（正值偏主）
     * away 需要 asianTotal <= -ASIAN_WEAK（负值偏客）
     */
    function _directionMatch(side) {
      if (side === 'home') return asianTotal >= Config.ASIAN_WEAK;
      if (side === 'away') return asianTotal <= -Config.ASIAN_WEAK;
      return false;
    }

    if (validSide) {
      const sideCN = sideMap[validSide];
      if (!_directionMatch(validSide)) {
        return {
          level: '❌',
          recommend: null,
          text: `模型看好${sideCN}，但亚盘方向相反`,
          detail: _formatDetail(evResult, validSide, asianTotal),
        };
      }
      if (Math.abs(asianTotal) >= Config.ASIAN_STRONG) {
        return {
          level: '★★★',
          recommend: sideCN,
          text: `强烈建议：${sideCN}`,
          detail: _formatDetail(evResult, validSide, asianTotal),
        };
      }
      // Math.abs(asianTotal) === ASIAN_WEAK（方向匹配已保证 >= ASIAN_WEAK）
      return {
        level: '★★',
        recommend: sideCN,
        text: `建议考虑：${sideCN}`,
        detail: _formatDetail(evResult, validSide, asianTotal),
      };
    }

    if (weakSide) {
      const sideCN = sideMap[weakSide];
      if (!_directionMatch(weakSide)) {
        return {
          level: '❌',
          recommend: null,
          text: `模型看好${sideCN}，但亚盘方向相反`,
          detail: _formatDetail(evResult, weakSide, asianTotal),
        };
      }
      return {
        level: '★★',
        recommend: sideCN,
        text: `建议考虑：${sideCN}（弱价值，轻仓）`,
        detail: _formatDetail(evResult, weakSide, asianTotal),
      };
    }

    // ── 无 valid/weak 方向 ───────────────────────────────────────────
    if (Math.abs(asianTotal) >= Config.ASIAN_ONLY) {
      return {
        level: '⚠️',
        recommend: null,
        text: `无数学价值，亚盘信号强（${(asianTotal >= 0 ? '+' : '') + asianTotal}分）`,
        detail: _formatDetail(evResult, null, asianTotal),
      };
    }

    return {
      level: '—',
      recommend: null,
      text: '本场无有效信号，跳过',
      detail: _formatDetail(evResult, null, asianTotal),
    };
  }

  return { decide };
})();
