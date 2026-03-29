const Storage = (() => {

  const KEYS = {
    records:  'ftb_records',
    bets:     'ftb_bets',
    settings: 'ftb_settings',
  };

  // ── 内部工具 ─────────────────────────────────────────────────────

  function _read(key, fallback) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) : fallback;
    } catch {
      return fallback;
    }
  }

  function _write(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function _nextId(items) {
    if (!items || items.length === 0) return 1;
    return Math.max(...items.map(x => x.id || 0)) + 1;
  }

  function _now() {
    return new Date().toISOString();
  }

  // ── Records ──────────────────────────────────────────────────────

  const Records = {
    /**
     * getAll() — 返回所有记录，无则返回空数组
     */
    getAll() {
      return _read(KEYS.records, []);
    },

    /**
     * add(record) — 分配 id 和 createdAt，追加保存，返回新 id
     */
    add(record) {
      const all = this.getAll();
      const id = _nextId(all);
      const newRecord = {
        ...record,
        id,
        createdAt: _now(),
      };
      all.push(newRecord);
      _write(KEYS.records, all);
      return id;
    },

    /**
     * setResult(id, actualResult) — 录入赛后结果
     * actualResult: '主胜' | '平局' | '客胜'
     * 根据记录中的 recommend 字段判断是否预测正确
     * 返回 is_correct 布尔值（recommend 为 null 时返回 null）
     */
    setResult(id, actualResult) {
      const all = this.getAll();
      const idx = all.findIndex(r => r.id === id);
      if (idx < 0) return undefined;

      const rec = all[idx];
      const is_correct = rec.recommend
        ? rec.recommend === actualResult
        : null;

      all[idx] = {
        ...rec,
        actual_result: actualResult,
        is_correct,
      };
      _write(KEYS.records, all);
      return is_correct;
    },

    /**
     * setClv(id, data) — 补录CLV数据
     * 方式一（主要）：方向验证
     *   data.betSide        = 你的下注方向（主胜/平局/客胜）
     *   data.pinnDirection  = 平博关盘方向（赔率最低项）
     *   → direction_match = betSide === pinnDirection
     * 方式二（可选）：体彩内部赔率追踪
     *   data.tcBuy          = 买入时体彩赔率（押注选项的赔率）
     *   data.tcClose        = 体彩关盘赔率（同选项关盘赔率）
     *   → tc_clv = tcBuy / tcClose（>1表示买到更好的价格）
     */
    setClv(id, { betSide, pinnDirection, tcBuy, tcClose }) {
      const all = this.getAll();
      const idx = all.findIndex(r => r.id === id);
      if (idx < 0) return;

      const direction_match = !!pinnDirection && betSide === pinnDirection;
      const tc_clv = (tcBuy > 1 && tcClose > 1) ? tcBuy / tcClose : null;

      all[idx] = {
        ...all[idx],
        bet_selection: betSide,
        betted: true,
        clv_tracking: {
          bet_side:         betSide,
          pinn_direction:   pinnDirection || null,
          direction_match:  !!pinnDirection ? direction_match : null,
          tc_buy:           tcBuy || null,
          tc_close:         tcClose || null,
          tc_clv,
        },
        clv: tc_clv ? tc_clv - 1 : null,  // 体彩CLV百分比（可null）
      };
      _write(KEYS.records, all);
      return { direction_match, tc_clv };
    },

    /**
     * delete(id) — 删除指定记录
     */
    delete(id) {
      const all = this.getAll().filter(r => r.id !== id);
      _write(KEYS.records, all);
    },

    /**
     * get(id) — 按 id 查询单条记录
     */
    get(id) {
      return this.getAll().find(r => r.id === id) || null;
    },
  };

  // ── Bets ─────────────────────────────────────────────────────────

  const Bets = {
    /**
     * getAll() — 返回所有投注记录，无则返回空数组
     */
    getAll() {
      return _read(KEYS.bets, []);
    },

    /**
     * add(bet) — 分配 id 和 createdAt，追加保存，返回新 id
     */
    add(bet) {
      const all = this.getAll();
      const id = _nextId(all);
      const newBet = {
        ...bet,
        id,
        createdAt: _now(),
      };
      all.push(newBet);
      _write(KEYS.bets, all);
      return id;
    },
  };

  // ── Settings ─────────────────────────────────────────────────────

  const Settings = {
    /**
     * get() — 读取设置，无则返回空对象
     */
    get() {
      return _read(KEYS.settings, {});
    },

    /**
     * save(s) — 保存设置对象
     */
    save(s) {
      _write(KEYS.settings, s);
    },
  };

  // ── 导出 ─────────────────────────────────────────────────────────

  /**
   * exportAll() — 导出所有数据为 JSON 字符串
   */
  function exportAll() {
    return JSON.stringify({
      records: Records.getAll(),
      bets:    Bets.getAll(),
    });
  }

  return {
    Records,
    Bets,
    Settings,
    exportAll,
  };
})();
