const Config = {
  LEAGUE_DRAW_RATES: {
    // 欧洲联赛
    'J联赛': 0.30, '意甲': 0.28, '荷甲': 0.27,
    '英超': 0.25, '西甲': 0.25, '德甲': 0.24, '法甲': 0.25, '葡超': 0.25,
    // 亚洲/大洋洲
    '中超': 0.24, '澳超': 0.22, '韩K联赛': 0.26,
    // 国家队赛事
    '国家赛': 0.22,
    // 世预赛（各大洲平局率差异显著，国家队比赛整体低于联赛）
    '世预赛（欧洲区）': 0.25,   // UEFA：强弱分化大，平局率接近五大联赛
    '世预赛（亚洲区）': 0.21,   // AFC：强队碾压多，平局率偏低
    '世预赛（南美区）': 0.24,   // CONMEBOL：竞争激烈，平局常见
    '世预赛（北中美区）': 0.22, // CONCACAF
    '世预赛（非洲区）': 0.21,   // CAF：弱队多，平局率低
    '其他': 0.25,
  },
  LEAGUES: [
    '英超','西甲','德甲','意甲','法甲','荷甲','葡超','中超','J联赛','澳超','韩K联赛',
    '国家赛',
    '世预赛（欧洲区）','世预赛（亚洲区）','世预赛（南美区）','世预赛（北中美区）','世预赛（非洲区）',
    '其他',
  ],
  EV_THRESHOLD: 1.05,
  GAP_STRONG: 0.06,
  GAP_WEAK: 0.03,
  WATER_DIFF_S1: 0.03,
  WATER_DIFF_S2: 0.10,
  WATER_DIFF_S3: 0.08,
  WATER_DIFF_DRAW: 0.05,
  DRAW_RATE_THRESHOLD: 0.28,
  DRAW_COUNT_THRESHOLD: 4,
  DRAW_CORRECTION_FACTOR: 1.15,
  ASIAN_STRONG: 2,
  ASIAN_WEAK: 1,
  ASIAN_ONLY: 3,
  DRAW_ASIAN_STRONG: 1,
  DRAW_ASIAN_WEAK: 2,
  MODEL_VERSION: 'v3',
};
