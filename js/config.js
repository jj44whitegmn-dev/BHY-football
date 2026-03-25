/**
 * config.js — 三层配置
 * 第一层 THRESHOLDS：触发阈值（什么情况下激活规则）
 * 第二层 WEIGHTS：加减分权重（触发后影响多少分）
 * 第三层 GRADING：分级参数（如何把得分转化为决策）
 */

const Config = (() => {

  // ── 第一层：阈值 ──────────────────────────────────────────────
  const DEFAULT_THRESHOLDS = {
    概率差_弱: 0.03,
    概率差_强: 0.06,
    欧赔变化_轻微: 0.03,
    欧赔变化_明显: 0.06,
    欧赔变化_显著: 0.10,
    亚盘盘口变化: 0.25,
    亚盘水位变化: 0.05,
    热门过热_欧赔上限: 1.55,
    热门过热_亚盘深度: 1.25,
    价值提示_弱: 0.03,
    价值提示_强: 0.06,
  };

  // ── 第二层：权重（小整数，单条规则最多 ±6）───────────────────
  const DEFAULT_WEIGHTS = {
    欧赔压低_显著:  5,
    欧赔压低_明显:  3,
    欧赔压低_轻微:  1,
    亚盘盘口变化:   6,
    亚盘水位变化:   2,
    一致性奖励:     4,
    体彩欧赔差异:   2,
    体彩让球确认:   3,
    临场确认:       3,
    平局增强:       4,
    不一致惩罚:    -6,
    试探失败惩罚:  -3,
    噪音惩罚:      -8,
    热门过热惩罚:  -5,
    让球不一致惩罚:-4,
  };

  // ── 第三层：分级 ───────────────────────────────────────────────
  const DEFAULT_GRADING = {
    甲级_得分: 12,
    甲级_差距:  6,
    甲级_质量: 65,
    乙级_得分:  7,
    乙级_差距:  3,
    乙级_质量: 50,
    最低得分_展示: 3,
    本金: 1000,
    甲级_仓位比例: 0.005,
    乙级_仓位比例: 0.002,
    风险_低上限:   25,
    风险_中上限:   50,
  };

  const DEFAULTS = {
    ...DEFAULT_THRESHOLDS,
    ...DEFAULT_WEIGHTS,
    ...DEFAULT_GRADING,
  };

  function get() {
    try {
      const saved = JSON.parse(localStorage.getItem('ftb_config')) || {};
      return { ...DEFAULTS, ...saved };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function save(obj) {
    const current = get();
    localStorage.setItem('ftb_config', JSON.stringify({ ...current, ...obj }));
  }

  function reset() {
    localStorage.removeItem('ftb_config');
  }

  // 返回三层分离的默认值（供设置页展示分组用）
  function getLayered() {
    const c = get();
    const t = {}, w = {}, g = {};
    for (const k of Object.keys(DEFAULT_THRESHOLDS)) t[k] = c[k];
    for (const k of Object.keys(DEFAULT_WEIGHTS))    w[k] = c[k];
    for (const k of Object.keys(DEFAULT_GRADING))    g[k] = c[k];
    return { 阈值: t, 权重: w, 分级: g };
  }

  return { get, save, reset, getLayered, DEFAULTS };
})();

// ── 路径标签枚举（固定，不可自由输入）────────────────────────────

const AH_PATH_LABELS = [
  'AH_单边强化主队',
  'AH_单边强化客队',
  'AH_中途试探后回撤',
  'AH_来回摇摆',
  'AH_临场突然强化主队',
  'AH_临场突然强化客队',
  'AH_基本不动',
];

const EU_PATH_LABELS = [
  'EU_主胜持续压低',
  'EU_客胜持续压低',
  'EU_平赔持续压低',
  'EU_早盘动后面不动',
  'EU_临场突然压低主胜',
  'EU_临场突然压低客胜',
  'EU_三项无明显趋势',
];

// 路径标签展示名（去掉前缀，用于 UI 下拉）
const AH_PATH_LABEL_NAMES = AH_PATH_LABELS.map(l => l.replace('AH_', ''));
const EU_PATH_LABEL_NAMES = EU_PATH_LABELS.map(l => l.replace('EU_', ''));
