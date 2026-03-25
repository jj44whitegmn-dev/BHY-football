/**
 * engine.js — 规则引擎
 * 职责：只做分析，输入比赛原始数据，输出完整 analysis 对象。
 * 不依赖 storage.js / ui.js / model.js。
 */

const Engine = (() => {

  // ── 工具函数 ───────────────────────────────────────────────────

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  // 三项赔率去水概率
  function noVig(h, d, a) {
    if (!h || !d || !a || h <= 1 || d <= 1 || a <= 1) return null;
    const raw = [1/h, 1/d, 1/a];
    const total = raw[0] + raw[1] + raw[2];
    return { home: raw[0]/total, draw: raw[1]/total, away: raw[2]/total };
  }

  // 欧赔变化幅度（正值=压低=市场强化该方向）
  function oddsChange(open, close) {
    if (!open || !close || open <= 1 || close <= 1) return 0;
    return (open - close) / open;
  }

  function oddsDirection(change, cfg) {
    if (change > cfg.欧赔变化_轻微) return '压低';
    if (change < -cfg.欧赔变化_轻微) return '抬高';
    return '稳定';
  }

  // ── 亚盘方向封装函数 ────────────────────────────────────────────

  // 根据盘口线判断热门方（负=主让=主队热门，正=主受让=客队热门）
  function ahFavorite(line) {
    if (line === null || line === undefined) return null;
    if (line < 0) return '主队';
    if (line > 0) return '客队';
    return '平手';
  }

  // 主队热门程度变化（盘口越负=主队让越多=主队越强）
  function homeStrengthChange(openLine, closeLine) {
    if (openLine === null || closeLine === null) return '稳定';
    const delta = closeLine - openLine; // 负值=主队升盘
    if (Math.abs(delta) < 0.01) return '稳定';
    // 主队让更多（delta更负）→ 增强；让更少 → 减弱
    return delta < 0 ? '增强' : '减弱';
  }

  // 构建亚盘单点分析对象
  function buildAhPointAnalysis(line, homeOdds, awayOdds) {
    if (line === null || line === undefined) return null;
    const fav = ahFavorite(line);
    let waterBalance = '持平';
    if (homeOdds && awayOdds) {
      const diff = homeOdds - awayOdds;
      if (diff < -0.05) waterBalance = '主队降水';  // 主队赔率更低
      else if (diff > 0.05) waterBalance = '客队降水';
    }
    return { favorite: fav, line, homeOdds, awayOdds, waterBalance };
  }

  // 构建亚盘变化分析
  function buildAhChange(openLine, closeLine, openHOdds, closeHOdds) {
    const lineDelta = (closeLine !== null && openLine !== null)
      ? closeLine - openLine : null;
    const favoritChanged = lineDelta !== null
      && ahFavorite(openLine) !== ahFavorite(closeLine)
      && ahFavorite(openLine) !== '平手'
      && ahFavorite(closeLine) !== '平手';
    const homeStrength = (openLine !== null && closeLine !== null)
      ? homeStrengthChange(openLine, closeLine) : '稳定';
    const awayStrength = homeStrength === '增强' ? '减弱'
      : homeStrength === '减弱' ? '增强' : '稳定';

    // 人类可读解释
    let interpretation = '亚盘无明显变化';
    if (lineDelta !== null && Math.abs(lineDelta) >= 0.01) {
      const dir = lineDelta < 0 ? `升盘${Math.abs(lineDelta)}球` : `降盘${Math.abs(lineDelta)}球`;
      const who = homeStrength === '增强' ? '主队' : '客队';
      interpretation = `主队${dir}，${who}热门程度${homeStrength}`;
      if (favoritChanged) interpretation += '（热门换边）';
    }

    return { lineDelta, favoriteChanged: favoritChanged, homeStrength, awayStrength, interpretation };
  }

  // 构建中盘试探分析
  function buildAhMidAnalysis(openLine, midLine, closeLine, midHomeOdds, closeHomeOdds) {
    const hasData = midLine !== null && midLine !== undefined;
    if (!hasData) return { hasData: false, probeUpThenBack: false, lateConfirm: false };

    // 试探后回撤：中盘相对初盘有明显变化，但终盘回到初盘附近
    const midDelta = midLine - openLine;
    const closeDelta = closeLine - openLine;
    const probeUpThenBack = Math.abs(midDelta) >= 0.25 && Math.abs(closeDelta) < 0.15;

    // 临场确认：终盘相对中盘进一步同向
    const lateConfirm = hasData && !probeUpThenBack
      && Math.sign(midDelta) === Math.sign(closeDelta - midDelta)
      && Math.abs(closeDelta - midDelta) >= 0.15;

    return { hasData, probeUpThenBack, lateConfirm };
  }

  // ── 体彩让球分析 ────────────────────────────────────────────────

  function buildCtfHdcAnalysis(ctfHdcLine, ctfHdcH, ctfHdcD, ctfHdcA,
                                 ahCloseLine, euCloseH, euCloseA) {
    const ctfFav = ahFavorite(ctfHdcLine);
    const ahFav  = ahFavorite(ahCloseLine);
    const dirConsistent = ctfFav === ahFav;

    // 赢球不穿盘风险：欧赔或亚盘支持某方，但该方让球盘 >= 1球
    // 例如主队让1球，若最终1-0则让球盘算平局
    let coverRisk = false;
    let coverRiskDetail = '';
    if (ctfHdcLine !== null && Math.abs(ctfHdcLine) >= 1) {
      const favSide = ctfHdcLine < 0 ? 'home' : 'away';
      // 欧赔支持热门方但让球较深
      const euSupports = (favSide === 'home' && euCloseH && euCloseH < euCloseA)
                      || (favSide === 'away' && euCloseA && euCloseA < euCloseH);
      if (euSupports) {
        coverRisk = true;
        const who = ctfHdcLine < 0 ? '主队' : '客队';
        coverRiskDetail = `${who}让球${Math.abs(ctfHdcLine)}球以上，若仅赢${Math.abs(ctfHdcLine)}球则让球盘算平局`;
      }
    }

    // 体彩胜平负热门 vs 让球热门是否一致
    let ctf1x2Favorite = null;
    if (ctfHdcH && ctfHdcD && ctfHdcA) {
      // 让球热门方的让球盘赔率最低代表该方向受欢迎
      ctf1x2Favorite = ctfHdcH <= ctfHdcA ? '主队' : '客队';
    }
    const vs1x2Consistent = ctf1x2Favorite === ctfFav;

    return {
      ctfFavorite: ctfFav,
      ahFavorite: ahFav,
      directionConsistent: dirConsistent,
      coverRisk,
      coverRiskDetail,
      ctf1x2VsHdc: {
        consistent: vs1x2Consistent,
        detail: vs1x2Consistent
          ? `体彩让球与赔率热门方向一致（${ctfFav}）`
          : `体彩让球热门方为${ctfFav}，但赔率热门方为${ctf1x2Favorite}`,
      },
    };
  }

  // ── 价值提示（ctf vs eu）────────────────────────────────────────

  function buildValueHint(ctfEuDiff, cfg) {
    // ctf_eu_diff = ctf_nv - eu_close_nv
    // 负值 = 体彩该方向概率更低 = 赔率更高 = 更甜
    const entries = [
      { side: '主胜', diff: ctfEuDiff.home },
      { side: '平局', diff: ctfEuDiff.draw },
      { side: '客胜', diff: ctfEuDiff.away },
    ];
    // 找绝对值最大的负值（体彩最甜的方向）
    const sweetest = entries
      .filter(e => e.diff < 0)
      .sort((a, b) => a.diff - b.diff)[0]; // 最负的

    if (!sweetest || Math.abs(sweetest.diff) < cfg.价值提示_弱) {
      return { side: null, strength: '无' };
    }
    const strength = Math.abs(sweetest.diff) >= cfg.价值提示_强 ? '强' : '弱';
    return { side: sweetest.side, strength };
  }

  // ── 规则引擎（A-K）──────────────────────────────────────────────

  function runRules(data, cfg) {
    const scores = { home: 0, draw: 0, away: 0 };
    const qualityDeltas = [];
    const rulesHit = [];

    function addScore(side, delta, ruleId, ruleName, threshUsed, actualVal, reason) {
      if (side === '主胜') scores.home += delta;
      else if (side === '平局') scores.draw += delta;
      else if (side === '客胜') scores.away += delta;
      rulesHit.push({
        rule_id: ruleId, rule_name: ruleName,
        side, score_delta: delta,
        threshold_used: threshUsed, actual_value: actualVal, reason,
      });
    }

    function addQuality(delta, ruleId, ruleName, detail) {
      qualityDeltas.push({ source: ruleName, delta, detail });
      rulesHit.push({
        rule_id: ruleId, rule_name: ruleName,
        side: '质量分', score_delta: delta,
        threshold_used: null, actual_value: null, reason: detail,
      });
    }

    const {
      ctf_nv, eu_close_nv, eu_change,
      ah_change, ah_close_analysis, ah_mid_analysis,
      ctf_hdc_analysis, ah_path_label, eu_path_label,
      eu_open_home, eu_open_draw, eu_open_away,
      eu_close_home, eu_close_draw, eu_close_away,
    } = data;

    const hasCtf = !!ctf_nv;
    const hasEu  = !!eu_close_nv;
    const hasAh  = !!ah_close_analysis;

    // ── 规则 A：体彩 vs 欧赔价值差异 ──────────────────────────────
    if (hasCtf && hasEu && data.ctf_eu_diff) {
      const diff = data.ctf_eu_diff;
      // 负值=体彩更甜，对该方向有参考价值，加弱分
      if (diff.home < -cfg.概率差_弱) {
        const delta = diff.home < -cfg.概率差_强 ? cfg.体彩欧赔差异 : 1;
        addScore('主胜', delta, 'A1', '体彩主胜赔率偏甜',
          cfg.概率差_弱, Math.abs(diff.home),
          `体彩主胜隐含概率比欧赔低${(Math.abs(diff.home)*100).toFixed(1)}%，体彩赔率相对更高`);
      }
      if (diff.draw < -cfg.概率差_弱) {
        const delta = diff.draw < -cfg.概率差_强 ? cfg.体彩欧赔差异 : 1;
        addScore('平局', delta, 'A2', '体彩平局赔率偏甜',
          cfg.概率差_弱, Math.abs(diff.draw),
          `体彩平局隐含概率比欧赔低${(Math.abs(diff.draw)*100).toFixed(1)}%`);
      }
      if (diff.away < -cfg.概率差_弱) {
        const delta = diff.away < -cfg.概率差_强 ? cfg.体彩欧赔差异 : 1;
        addScore('客胜', delta, 'A3', '体彩客胜赔率偏甜',
          cfg.概率差_弱, Math.abs(diff.away),
          `体彩客胜隐含概率比欧赔低${(Math.abs(diff.away)*100).toFixed(1)}%`);
      }
    }

    // ── 规则 B：欧赔压低 ────────────────────────────────────────────
    if (hasEu && eu_change) {
      const map = [
        { key: 'home', side: '主胜', id: 'B' },
        { key: 'draw', side: '平局', id: 'B' },
        { key: 'away', side: '客胜', id: 'B' },
      ];
      map.forEach(({ key, side, id }) => {
        const chg = eu_change[key];
        if (!chg) return;
        const openOdds  = key === 'home' ? eu_open_home : key === 'draw' ? eu_open_draw : eu_open_away;
        const closeOdds = key === 'home' ? eu_close_home : key === 'draw' ? eu_close_draw : eu_close_away;
        if (chg >= cfg.欧赔变化_显著) {
          addScore(side, cfg.欧赔压低_显著, `${id}1`, `欧赔显著压低${side}`,
            cfg.欧赔变化_显著, chg,
            `${side}欧赔从${openOdds}降至${closeOdds}，变化幅度${(chg*100).toFixed(1)}%，超过显著阈值`);
        } else if (chg >= cfg.欧赔变化_明显) {
          addScore(side, cfg.欧赔压低_明显, `${id}2`, `欧赔明显压低${side}`,
            cfg.欧赔变化_明显, chg,
            `${side}欧赔从${openOdds}降至${closeOdds}，变化幅度${(chg*100).toFixed(1)}%`);
        } else if (chg >= cfg.欧赔变化_轻微) {
          addScore(side, cfg.欧赔压低_轻微, `${id}3`, `欧赔轻微压低${side}`,
            cfg.欧赔变化_轻微, chg,
            `${side}欧赔小幅下调${(chg*100).toFixed(1)}%`);
        }
      });
    }

    // ── 规则 C：亚盘强化 ────────────────────────────────────────────
    if (hasAh && ah_change) {
      const { lineDelta, homeStrength, awayStrength } = ah_change;
      if (lineDelta !== null) {
        if (homeStrength === '增强' && Math.abs(lineDelta) >= cfg.亚盘盘口变化) {
          addScore('主胜', cfg.亚盘盘口变化, 'C1', '亚盘升盘主队',
            cfg.亚盘盘口变化, Math.abs(lineDelta),
            `主队亚盘升盘${Math.abs(lineDelta)}球，主队热门强度增强`);
        } else if (awayStrength === '增强' && Math.abs(lineDelta) >= cfg.亚盘盘口变化) {
          addScore('客胜', cfg.亚盘盘口变化, 'C2', '亚盘升盘客队',
            cfg.亚盘盘口变化, Math.abs(lineDelta),
            `客队亚盘升盘${Math.abs(lineDelta)}球，客队热门强度增强`);
        }
      }
      // 水位变化（弱信号）
      if (ah_close_analysis && ah_close_analysis.waterBalance !== '持平') {
        const waterSide = ah_close_analysis.waterBalance === '主队降水' ? '主胜' : '客胜';
        addScore(waterSide, cfg.亚盘水位变化, 'C3', `亚盘${waterSide}降水`,
          cfg.亚盘水位变化, null,
          `终盘${waterSide.replace('胜','队')}赔率相对较低，资金流向该方向`);
      }
    }

    // ── 规则 D：一致性 ───────────────────────────────────────────────
    // 判断欧赔和亚盘是否支持同一方向
    const euStrongest = data.eu_strongest_move;
    const ahDirection = hasAh && ah_change
      ? (ah_change.homeStrength === '增强' ? '主胜'
        : ah_change.awayStrength === '增强' ? '客胜' : null)
      : null;

    if (euStrongest && ahDirection) {
      if (euStrongest === ahDirection) {
        addScore(euStrongest, cfg.一致性奖励, 'D1', '欧赔亚盘方向一致',
          null, null,
          `欧赔和亚盘均支持${euStrongest}，市场信号一致`);
      } else {
        addQuality(cfg.不一致惩罚, 'D2', '欧赔亚盘方向不一致',
          `欧赔支持${euStrongest}，亚盘支持${ahDirection}，两市场信号相悖`);
      }
    }

    // ── 规则 E：赔率盘口分歧 ────────────────────────────────────────
    // 欧赔有明显方向但亚盘无强化或反向（已由 D 覆盖，补充弱分歧）
    if (euStrongest && ahDirection && euStrongest !== ahDirection) {
      addScore(euStrongest, -2, 'E1', '欧赔盘口分歧减分',
        null, null,
        `${euStrongest}欧赔信号存在，但亚盘方向不一致，可信度下降`);
    }

    // ── 规则 F：热门过热 ────────────────────────────────────────────
    if (hasEu && hasAh) {
      const checkHot = (closeOdds, side) => {
        const absLine = Math.abs(data.ah_close_line || 0);
        if (closeOdds && closeOdds < cfg.热门过热_欧赔上限 && absLine >= cfg.热门过热_亚盘深度) {
          addQuality(cfg.热门过热惩罚, 'F1', `热门过热(${side})`,
            `${side}欧赔仅${closeOdds}（低于${cfg.热门过热_欧赔上限}）且亚盘已深（${absLine}球），赔率价值不足`);
          return true;
        }
        return false;
      };
      checkHot(eu_close_home, '主胜');
      checkHot(eu_close_away, '客胜');
    }

    // ── 规则 G：试探失败 ────────────────────────────────────────────
    const probeLabel = ah_path_label === 'AH_中途试探后回撤';
    const probeMid = ah_mid_analysis && ah_mid_analysis.hasData && ah_mid_analysis.probeUpThenBack;
    if (probeLabel || probeMid) {
      // 判断曾经强化的方向
      const prevStrong = ah_change && ah_change.homeStrength === '增强' ? '主胜' : '客胜';
      addScore(prevStrong, cfg.试探失败惩罚, 'G1', '试探后回撤',
        null, null,
        `亚盘曾向${prevStrong}方向强化，但终盘回撤，试探失败信号`);
      addQuality(-4, 'G2', '试探失败质量扣分', '盘口路径出现试探后回撤，市场意图不明确');
    }

    // ── 规则 H：临场确认 ────────────────────────────────────────────
    const confirmLabel = ah_path_label === 'AH_临场突然强化主队'
                      || ah_path_label === 'AH_临场突然强化客队';
    const confirmMid = ah_mid_analysis && ah_mid_analysis.hasData && ah_mid_analysis.lateConfirm;
    if (confirmLabel || confirmMid) {
      const confirmSide = ah_path_label === 'AH_临场突然强化主队' ? '主胜'
        : ah_path_label === 'AH_临场突然强化客队' ? '客胜'
        : (ahDirection || '主胜');
      // 欧赔同步确认加分更高
      const euConfirms = eu_path_label === 'EU_临场突然压低主胜' || eu_path_label === 'EU_临场突然压低客胜';
      const delta = euConfirms ? cfg.临场确认 + 1 : cfg.临场确认;
      addScore(confirmSide, delta, 'H1', '临场确认',
        null, null,
        `临场前${confirmSide}方向进一步强化${euConfirms ? '，欧赔同步确认' : ''}`);
    }

    // ── 规则 I：来回摇摆/高噪音 ─────────────────────────────────────
    const swingLabel = ah_path_label === 'AH_来回摇摆';
    const noTrend = eu_path_label === 'EU_三项无明显趋势' && ah_path_label === 'AH_基本不动';
    if (swingLabel) {
      addQuality(cfg.噪音惩罚, 'I1', '来回摇摆高噪音',
        '亚盘路径标签为来回摇摆，市场方向混乱');
    }
    if (noTrend) {
      addQuality(Math.floor(cfg.噪音惩罚 / 2), 'I2', '双市场无明显趋势',
        '欧赔和亚盘均无方向性变化，市场无效信息');
    }

    // ── 规则 J：平局增强 ────────────────────────────────────────────
    const drawChange = eu_change ? eu_change.draw : 0;
    const noAhBias = !ahDirection;
    const drawLabel = eu_path_label === 'EU_平赔持续压低';
    if ((drawChange >= cfg.欧赔变化_明显 || drawLabel) && noAhBias) {
      addScore('平局', cfg.平局增强, 'J1', '平局增强',
        cfg.欧赔变化_明显, drawChange,
        `平局赔率下调${drawLabel ? '（路径标签确认）' : `幅度${(drawChange*100).toFixed(1)}%`}，亚盘无明显强化任一方`);
    }

    // ── 规则 K：体彩让球 ────────────────────────────────────────────
    if (ctf_hdc_analysis) {
      const { directionConsistent, coverRisk, coverRiskDetail, ctf1x2VsHdc } = ctf_hdc_analysis;
      if (directionConsistent && ctf_hdc_analysis.ctfFavorite) {
        const confirmSide = ctf_hdc_analysis.ctfFavorite === '主队' ? '主胜' : '客胜';
        addScore(confirmSide, cfg.体彩让球确认, 'K1', '让球与亚盘方向一致',
          null, null,
          `体彩让球热门方（${ctf_hdc_analysis.ctfFavorite}）与亚盘终盘热门方一致`);
      } else if (!directionConsistent && ctf_hdc_analysis.ctfFavorite && ctf_hdc_analysis.ahFavorite) {
        addQuality(cfg.让球不一致惩罚, 'K2', '让球与亚盘方向相悖',
          `体彩让球热门方为${ctf_hdc_analysis.ctfFavorite}，亚盘热门方为${ctf_hdc_analysis.ahFavorite}`);
      }
      if (!ctf1x2VsHdc.consistent) {
        addQuality(-4, 'K3', '体彩胜平负与让球方向不一致',
          ctf1x2VsHdc.detail);
      }
      // coverRisk 不扣分，只标记（在 risk 层处理）
    }

    // ── 路径标签辅助加分 ────────────────────────────────────────────
    // （已在各规则组中处理，此处仅处理未覆盖的标签）
    if (eu_path_label === 'EU_主胜持续压低' && !(scores.home > 0)) {
      addScore('主胜', 2, 'L1', '欧赔路径支持主胜',
        null, null, '欧赔路径标签：主胜持续压低');
    }
    if (eu_path_label === 'EU_客胜持续压低' && !(scores.away > 0)) {
      addScore('客胜', 2, 'L2', '欧赔路径支持客胜',
        null, null, '欧赔路径标签：客胜持续压低');
    }

    return { scores, qualityDeltas, rulesHit };
  }

  // ── 市场类型分类 ────────────────────────────────────────────────

  function classifyMarket(scores, qualityScore, rulesHit, data, cfg) {
    const maxScore = Math.max(scores.home, scores.draw, scores.away);
    const ruleIds = rulesHit.map(r => r.rule_id);
    const secondary = [];

    // 副标签逻辑
    if (data.value_hint_side === '主胜') secondary.push('体彩偏甜主胜');
    if (data.value_hint_side === '平局') secondary.push('体彩偏甜平局');
    if (data.value_hint_side === '客胜') secondary.push('体彩偏甜客胜');
    if (data.ctf_hdc_analysis?.coverRisk) secondary.push('赢球不穿盘风险');
    if (data.ctf_hdc_analysis?.directionConsistent) secondary.push('让球与亚盘一致');
    else if (data.ctf_hdc_analysis?.ctfFavorite) secondary.push('让球与亚盘相悖');
    if (data.eu_path_label === 'EU_早盘动后面不动') secondary.push('欧赔早动后稳');
    if (data.ah_path_label === 'AH_临场突然强化主队') secondary.push('临场资金流入主队');
    if (data.ah_path_label === 'AH_临场突然强化客队') secondary.push('临场资金流入客队');
    if (data.eu_path_label === 'EU_平赔持续压低') secondary.push('平赔持续下调');

    // 主标签（按优先级）
    let primary;
    const hasNoise = ruleIds.includes('I1') || ruleIds.includes('I2');
    const hasProbe = ruleIds.includes('G1');
    const hasHot   = ruleIds.some(id => id.startsWith('F'));
    const hasIncon = ruleIds.includes('D2');
    const hasConfirm = ruleIds.includes('H1');

    if (qualityScore < 30 || (data.ah_path_label === 'AH_来回摇摆')) {
      primary = '高噪音结构';
    } else if (qualityScore < 45 && maxScore < cfg.乙级_得分) {
      primary = '低价值不碰';
    } else if (hasHot) {
      primary = '热门过热';
    } else if (hasIncon) {
      primary = '盘口赔率不一致';
    } else if (hasProbe) {
      primary = '试探失败';
    } else if (hasConfirm && !hasIncon && qualityScore >= 55) {
      primary = '临场确认';
    } else if (scores.draw === maxScore && scores.draw >= cfg.乙级_得分) {
      primary = '平局增强';
    } else if (scores.home === maxScore && scores.home >= cfg.乙级_得分 && qualityScore >= 50) {
      primary = '主队一致强化';
    } else if (scores.away === maxScore && scores.away >= cfg.乙级_得分 && qualityScore >= 50) {
      primary = '客队一致强化';
    } else {
      primary = '低价值不碰';
    }

    return { primary, secondary };
  }

  // ── 风险评分 ────────────────────────────────────────────────────

  function calcRisk(qualityScore, marketPrimary, ctfHdcAnalysis, ahChange, cfg) {
    const breakdown = [];
    let riskScore = 0;

    const add = (delta, source, detail) => {
      breakdown.push({ source, delta, detail });
      riskScore += delta;
    };

    if (qualityScore < 50) add(20, '质量分偏低', `当前质量分${qualityScore}`);
    if (qualityScore < 35) add(15, '质量分很低', `质量分${qualityScore}，分析可信度极低`);
    if (['高噪音结构','试探失败','盘口赔率不一致'].includes(marketPrimary))
      add(20, `市场类型风险:${marketPrimary}`, '此类市场结构不确定性高');
    if (marketPrimary === '热门过热')
      add(15, '热门过热风险', '赔率价值不足，期望值可能为负');
    if (ctfHdcAnalysis?.coverRisk)
      add(10, '赢球不穿盘风险', ctfHdcAnalysis.coverRiskDetail);
    if (ahChange?.favoriteChanged)
      add(10, '亚盘热门换边', '开盘到终盘热门方发生切换，市场出现重大分歧');

    riskScore = clamp(riskScore, 0, 100);
    const level = riskScore <= cfg.风险_低上限 ? '低'
      : riskScore <= cfg.风险_中上限 ? '中' : '高';
    return { riskScore, riskLevel: level, riskBreakdown: breakdown };
  }

  // ── 决策输出 ────────────────────────────────────────────────────

  function makeDecision(scores, qualityScore, marketPrimary, riskLevel, cfg, ahCloseLine, stake) {
    const maxScore = Math.max(scores.home, scores.draw, scores.away);
    const sideMap = [
      { side: '主胜', score: scores.home },
      { side: '平局', score: scores.draw },
      { side: '客胜', score: scores.away },
    ].sort((a, b) => b.score - a.score);
    const top = sideMap[0], second = sideMap[1];
    const gap = top.score - second.score;

    // 方向倾向（即使不建议下注）
    let suggestedSide = null;
    let leanReason = '';
    if (top.score >= cfg.最低得分_展示) {
      suggestedSide = top.side;
      leanReason = `${top.side}综合得分最高（${top.score}分），领先${gap}分`;
    }

    // 强制不建议下注的情况
    const forceNoBet = ['高噪音结构','低价值不碰','热门过热'].includes(marketPrimary)
      || riskLevel === '高';

    let grade = '丙级';
    let whetherToBet = false;
    let noBetReason = '';
    let stakeSuggestion = 0;

    if (forceNoBet) {
      noBetReason = marketPrimary === '热门过热' ? '热门赔率价值不足，期望值为负'
        : marketPrimary === '高噪音结构' ? '市场结构混乱，无法可靠判断方向'
        : riskLevel === '高' ? '风险等级过高，本金保护优先'
        : '综合质量不足';
    } else if (
      top.score >= cfg.甲级_得分 && gap >= cfg.甲级_差距 && qualityScore >= cfg.甲级_质量
    ) {
      grade = '甲级';
      whetherToBet = true;
      stakeSuggestion = Math.round(cfg.本金 * cfg.甲级_仓位比例);
    } else if (
      top.score >= cfg.乙级_得分 && gap >= cfg.乙级_差距 && qualityScore >= cfg.乙级_质量
    ) {
      grade = '乙级';
      whetherToBet = true;
      stakeSuggestion = Math.round(cfg.本金 * cfg.乙级_仓位比例);
    } else {
      noBetReason = maxScore < cfg.乙级_得分
        ? '信号强度不足，无明显市场方向'
        : gap < cfg.乙级_差距
        ? '各方向得分差距过小，建议放弃'
        : '市场质量分不足';
    }

    const suggestionReason = whetherToBet
      ? `${suggestedSide}信号明确（得分${top.score}，质量${qualityScore}），建议按甲/乙级仓位参与`
      : (leanReason ? `市场倾向${suggestedSide}，但${noBetReason}` : noBetReason);

    return {
      suggestedSide,
      leanReason,
      whetherToBet,
      noBetReason,
      confidenceGrade: grade,
      stakeSuggestion,
      suggestionReason,
    };
  }

  // ── 主入口 ──────────────────────────────────────────────────────

  /**
   * analyze(matchData) → analysis 对象
   * matchData 是比赛原始输入字段的平铺对象。
   */
  function analyze(matchData) {
    const cfg = Config.get();
    const snapshotConfig = { ...cfg };
    const snapshotAt = new Date().toISOString();

    // 步骤1：概率层
    const ctf_nv  = noVig(matchData.ctf_home_odds, matchData.ctf_draw_odds, matchData.ctf_away_odds);
    const eu_open_nv = noVig(matchData.eu_open_home, matchData.eu_open_draw, matchData.eu_open_away);
    const eu_close_nv = noVig(matchData.eu_close_home, matchData.eu_close_draw, matchData.eu_close_away);

    // 步骤2：体彩 vs 欧赔差值
    let ctf_eu_diff = null, value_hint_side = null, value_hint_strength = '无';
    if (ctf_nv && eu_close_nv) {
      ctf_eu_diff = {
        home: ctf_nv.home - eu_close_nv.home,
        draw: ctf_nv.draw - eu_close_nv.draw,
        away: ctf_nv.away - eu_close_nv.away,
      };
      const vh = buildValueHint(ctf_eu_diff, cfg);
      value_hint_side = vh.side;
      value_hint_strength = vh.strength;
    }

    // 步骤3：欧赔变化
    const eu_change = {
      home: oddsChange(matchData.eu_open_home, matchData.eu_close_home),
      draw: oddsChange(matchData.eu_open_draw, matchData.eu_close_draw),
      away: oddsChange(matchData.eu_open_away, matchData.eu_close_away),
    };
    const eu_direction = {
      home: oddsDirection(eu_change.home, cfg),
      draw: oddsDirection(eu_change.draw, cfg),
      away: oddsDirection(eu_change.away, cfg),
    };
    const sorted = [
      { side: '主胜', chg: eu_change.home },
      { side: '平局', chg: eu_change.draw },
      { side: '客胜', chg: eu_change.away },
    ].sort((a, b) => b.chg - a.chg);
    const eu_strongest_move = sorted[0].chg >= cfg.欧赔变化_轻微 ? sorted[0].side : null;

    // 步骤4：亚盘分析
    const openLine  = matchData.ah_open_line  ?? null;
    const closeLine = matchData.ah_close_line ?? null;
    const midLine   = matchData.ah_mid_line   ?? null;
    const ah_open_analysis  = buildAhPointAnalysis(openLine,  matchData.ah_open_home_odds,  matchData.ah_open_away_odds);
    const ah_close_analysis = buildAhPointAnalysis(closeLine, matchData.ah_close_home_odds, matchData.ah_close_away_odds);
    const ah_change         = (openLine !== null && closeLine !== null)
      ? buildAhChange(openLine, closeLine, matchData.ah_open_home_odds, matchData.ah_close_home_odds)
      : null;
    const ah_mid_analysis   = buildAhMidAnalysis(
      openLine, midLine, closeLine,
      matchData.ah_mid_home_odds, matchData.ah_close_home_odds
    );

    // 步骤5：体彩让球
    const ctf_hdc_analysis = buildCtfHdcAnalysis(
      matchData.ctf_hdc_line ?? null,
      matchData.ctf_hdc_home_odds, matchData.ctf_hdc_draw_odds, matchData.ctf_hdc_away_odds,
      closeLine,
      matchData.eu_close_home, matchData.eu_close_away
    );

    // 准备传给规则引擎的数据包
    const ruleData = {
      ctf_nv, eu_close_nv, eu_change, eu_direction, eu_strongest_move,
      ah_change, ah_close_analysis, ah_mid_analysis, ctf_hdc_analysis,
      ctf_eu_diff, value_hint_side,
      ah_open_line: openLine, ah_close_line: closeLine,
      ah_path_label: matchData.ah_path_label,
      eu_path_label: matchData.eu_path_label,
      eu_open_home: matchData.eu_open_home, eu_open_draw: matchData.eu_open_draw,
      eu_open_away: matchData.eu_open_away,
      eu_close_home: matchData.eu_close_home, eu_close_draw: matchData.eu_close_draw,
      eu_close_away: matchData.eu_close_away,
    };

    // 步骤6：运行规则 A-K
    const { scores, qualityDeltas, rulesHit } = runRules(ruleData, cfg);

    // 步骤7：质量分
    const qualityScore = clamp(100 + qualityDeltas.reduce((s, x) => s + x.delta, 0), 0, 100);

    // 步骤8：风险分
    const { riskScore, riskLevel, riskBreakdown } = calcRisk(
      qualityScore,
      '占位', // 先占位，市场类型后一步计算
      ctf_hdc_analysis,
      ah_change,
      cfg
    );

    // 步骤9：市场类型
    const { primary, secondary } = classifyMarket(scores, qualityScore, rulesHit, {
      value_hint_side, ctf_hdc_analysis, ah_change, eu_path_label: matchData.eu_path_label,
      ah_path_label: matchData.ah_path_label,
    }, cfg);

    // 重算风险（用真实市场类型）
    const riskFinal = calcRisk(qualityScore, primary, ctf_hdc_analysis, ah_change, cfg);

    // 步骤10：决策
    const decision = makeDecision(
      scores, qualityScore, primary, riskFinal.riskLevel, cfg,
      closeLine, cfg.本金
    );

    return {
      // 快照元数据
      snapshot_version: '3.2',
      snapshot_at: snapshotAt,
      snapshot_config: snapshotConfig,

      // 概率层
      ctf_nv,
      eu_open_nv,
      eu_close_nv,

      // 价值层
      ctf_eu_diff,
      value_hint_side,
      value_hint_strength,

      // 欧赔变化
      eu_change,
      eu_direction,
      eu_strongest_move,

      // 亚盘
      ah_open_analysis,
      ah_close_analysis,
      ah_change,
      ah_mid_analysis,

      // 体彩让球
      ctf_hdc_analysis,

      // 路径特征
      path_features: [matchData.ah_path_label, matchData.eu_path_label].filter(Boolean),

      // 规则命中
      rules_hit: rulesHit,

      // 得分
      home_score: scores.home,
      draw_score: scores.draw,
      away_score: scores.away,

      // 质量
      quality_score: qualityScore,
      quality_breakdown: qualityDeltas,

      // 风险
      risk_score: riskFinal.riskScore,
      risk_level: riskFinal.riskLevel,
      risk_breakdown: riskFinal.riskBreakdown,

      // 市场类型
      market_type_primary: primary,
      market_type_secondary: secondary,

      // 决策（方向倾向与下注建议分离）
      suggested_side:    decision.suggestedSide,
      lean_reason:       decision.leanReason,
      whether_to_bet:    decision.whetherToBet,
      no_bet_reason:     decision.noBetReason,
      confidence_grade:  decision.confidenceGrade,
      stake_suggestion:  decision.stakeSuggestion,
      suggestion_reason: decision.suggestionReason,
    };
  }

  return { analyze };
})();
