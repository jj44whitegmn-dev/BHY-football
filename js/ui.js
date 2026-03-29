/* ============================================================
   ui.js — 调度层：页面渲染、表单交互、模块调度
   依赖：config.js, veto.js, ev.js, asian.js, decision.js,
         storage.js, stats.js（均已在 index.html 中先行加载）
   ============================================================ */

const App = (() => {

  // ── 全局状态 ──────────────────────────────────────────────
  let currentPage  = 'analysis';
  let currentStep  = 1;
  let recordsFilter = 'all';

  // 分析向导：各步骤收集到的数据
  const analysis = {
    step1: {},   // 基本信息
    step2: {},   // 战绩 + 水位 → vetoResult
    step3: {},   // 赔率 → evResult
    step4: {},          // 亚盘信号值 {s0,s1,s2,s3,s4,s5}
    step4Sources: {},   // 信号来源：'ai'|'auto'|'manual'|undefined
    result: {},  // 最终决策对象
  };

  // ── 工具函数 ───────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const gv = id => ($( id ) ? $( id ).value.trim() : '');
  const gn = id => { const v = parseFloat(gv(id)); return isNaN(v) ? null : v; };
  const pct = v  => (v * 100).toFixed(1) + '%';
  const sign = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';

  function toast(msg, type = '', ms = 2400) {
    const el = $('toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast hidden'; }, ms);
  }

  // ── 页面导航 ───────────────────────────────────────────────
  function initNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        showPage(page);
      });
    });
  }

  function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    $('page-' + page).classList.add('active');
    document.querySelector(`.nav-btn[data-page="${page}"]`).classList.add('active');
    currentPage = page;

    if (page === 'records')  renderRecords();
    if (page === 'review')   renderReview();
    if (page === 'finance')  renderFinance();
    if (page === 'settings') renderSettings();

    // 在非分析页显示"新分析"按钮
    $('btn-new-analysis').classList.toggle('hidden', page === 'analysis');
  }

  // ── 时间窗口检查 ───────────────────────────────────────────
  let _noiseZone = false;  // 全局：当前是否处于噪音区

  function _checkTimeWindow() {
    const date = gv('s1-date');
    const time = gv('s1-time');
    if (!date || !time) return null;
    const kickoff = new Date(`${date}T${time}:00`);
    if (isNaN(kickoff)) return null;
    const hours = (kickoff - Date.now()) / 3600000;
    if (hours < 0)   return { code: 'started', autoZero: true,  label: '比赛已开始或结束',                                              cls: 'bg-red-50 text-red-700 border border-red-200' };
    if (hours < 2)   return { code: 'noise',   autoZero: true,  label: `噪音区（距开球 ${hours.toFixed(1)} 小时）· S4/S5 自动置 0`,     cls: 'bg-red-50 text-red-700 border border-red-200' };
    if (hours < 4)   return { code: 'usable',  autoZero: false, label: `可用窗口（距开球 ${hours.toFixed(1)} 小时）`,                    cls: 'bg-yellow-50 text-yellow-700 border border-yellow-200' };
    if (hours <= 12) return { code: 'optimal', autoZero: false, label: `最优窗口（距开球 ${hours.toFixed(1)} 小时）`,                    cls: 'bg-green-50 text-green-700 border border-green-200' };
    return               { code: 'early',   autoZero: false, label: `过早（距开球 ${hours.toFixed(1)} 小时，平博盘口可能尚未稳定）`,  cls: 'bg-yellow-50 text-yellow-700 border border-yellow-200' };
  }

  function _updateWindowStatus() {
    const el = $('s1-window-status');
    if (!el) return;
    const w = _checkTimeWindow();
    if (!w) { el.className = 'hidden'; el.textContent = ''; return; }
    el.className = `text-xs px-3 py-2 rounded-lg mt-1 ${w.cls}`;
    el.textContent = w.label;
  }

  // ── 分析向导：初始化 ───────────────────────────────────────
  function initAnalysis() {
    // 填充联赛下拉
    const sel = $('s1-league');
    Config.LEAGUES.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l; opt.textContent = l;
      sel.appendChild(opt);
    });

    // 设置今天日期为默认
    $('s1-date').value = new Date().toISOString().slice(0, 10);

    // 步骤导航
    $('btn-next').addEventListener('click', () => nextStep());
    $('btn-prev').addEventListener('click', () => prevStep());
    $('btn-save-record').addEventListener('click', saveRecord);
    $('btn-restart').addEventListener('click', restartAnalysis);
    $('btn-new-analysis').addEventListener('click', () => { showPage('analysis'); restartAnalysis(); });

    // 实时更新时间窗口状态
    $('s1-date') && $('s1-date').addEventListener('change', _updateWindowStatus);
    $('s1-time') && $('s1-time').addEventListener('change', _updateWindowStatus);

    // 步骤2：输入变化时实时计算否决模型
    ['s2-home-seq','s2-away-seq','s2-n','s2-decay','s2-pinn-home','s2-pinn-away'].forEach(id => {
      $(id) && $(id).addEventListener('input', computeVeto);
    });

    // 步骤2：新增盘口/水位字段监听
    ['s2-pinn-ol','s2-pinn-oh','s2-pinn-oa','s2-pinn-cl','s2-will-oh','s2-will-oa','s2-will-cl'].forEach(id => {
      $(id) && $(id).addEventListener('input', () => {
        updateLineLabels();
        updateAutoSignalPreview();
      });
    });
    // 终盘水位字段也触发自动信号预览（平博终盘 + 威廉最新盘）
    ['s2-pinn-home','s2-pinn-away','s2-will-ch','s2-will-ca'].forEach(id => {
      $(id) && $(id).addEventListener('input', updateAutoSignalPreview);
    });

    // 步骤2：截图识别按钮（平博开盘/临盘 + 威廉希尔开盘）
    const visionBtns = [
      { btn: 'btn-vision-pinn-open',  input: 'vision-file-pinn-open',  company: 'pinnacle',      type: 'open'  },
      { btn: 'btn-vision-pinn-close', input: 'vision-file-pinn-close', company: 'pinnacle',      type: 'close' },
      { btn: 'btn-vision-will-open',  input: 'vision-file-will-open',  company: 'william_hill',  type: 'open'  },
    ];
    visionBtns.forEach(({ btn, input, company, type }) => {
      const btnEl = $(btn);
      const inputEl = $(input);
      if (!btnEl || !inputEl) return;
      btnEl.addEventListener('click', e => { e.preventDefault(); inputEl.value = ''; inputEl.click(); });
      inputEl.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) processVisionImage(file, company, type);
      });
    });

    // 步骤3：输入变化时实时计算
    ['s3-o-home','s3-o-draw','s3-o-away'].forEach(id => {
      $(id) && $(id).addEventListener('input', computeEV);
    });

    // 初始化亚盘信号卡片
    buildSignalCards();

    goToStep(1);
  }

  // ── 步骤跳转 ───────────────────────────────────────────────
  const STEP_TITLES = [
    '', '基本信息', '近期战绩', '体彩赔率', '亚盘信号', '分析结果'
  ];

  function goToStep(n) {
    // 隐藏所有步骤内容
    for (let i = 1; i <= 5; i++) {
      $('step-' + i).classList.toggle('hidden', i !== n);
    }
    currentStep = n;

    // 更新步骤指示器
    for (let i = 1; i <= 5; i++) {
      const dot = $('dot-' + i);
      dot.classList.remove('active', 'done');
      if (i < n)  dot.classList.add('done');
      if (i === n) dot.classList.add('active');
    }
    for (let i = 1; i <= 4; i++) {
      $('line-' + i + '-' + (i+1)).classList.toggle('done', i < n);
    }

    // 标题
    $('step-title').textContent = `步骤 ${n} / 5  ·  ${STEP_TITLES[n]}`;

    // 按钮显示
    const prev = $('btn-prev'), next = $('btn-next'), nav = $('step-nav');
    prev.classList.toggle('hidden', n === 1);
    // 步骤5时隐藏导航按钮（改为用步骤5内的保存/重新分析按钮）
    nav.classList.toggle('hidden', n === 5);
    if (n < 5) { next.textContent = '下一步 →'; }

    // 如果到步骤4，自动填入可自动计算的信号，并展示市场解读
    if (n === 4) {
      // 检查时间窗口，决定是否噪音区
      const win = _checkTimeWindow();
      _noiseZone = win ? win.autoZero : false;

      // 更新步骤4顶部的时间窗口警告
      const warnEl = $('s4-window-warning');
      if (warnEl) {
        if (win) {
          warnEl.className = `rounded-xl p-3 text-xs leading-relaxed ${win.cls}`;
          if (win.code === 'noise' || win.code === 'started') {
            warnEl.innerHTML = `<strong>时间窗口：${win.label}</strong><br>S4 盘口背离、S5 降盘异常两项信号已自动置 0，无法手动修改。`;
          } else if (win.code === 'early') {
            warnEl.innerHTML = `<strong>时间窗口：${win.label}</strong><br>建议等盘口稳定后（开球前 4-12 小时）再分析 S4/S5 信号。`;
          } else {
            warnEl.innerHTML = `<strong>时间窗口：${win.label}</strong>`;
          }
          warnEl.classList.remove('hidden');
        } else {
          warnEl.classList.add('hidden');
        }
      }

      autoFillSignals();
      if (analysis.step2.market_summary) {
        const el = $('s4-market-summary');
        if (el) {
          el.innerHTML = `<span class="font-semibold text-amber-700 block mb-1">市场解读参考</span>${analysis.step2.market_summary}`;
          el.classList.remove('hidden');
        }
      }
    }
    // 如果到步骤5，生成结果
    if (n === 5) buildResult();
  }

  function nextStep() {
    if (!validateStep(currentStep)) return;
    collectStep(currentStep);
    if (currentStep < 5) goToStep(currentStep + 1);
  }

  function prevStep() {
    if (currentStep > 1) goToStep(currentStep - 1);
  }

  // ── 步骤验证 ───────────────────────────────────────────────
  function validateStep(n) {
    if (n === 1) {
      if (!gv('s1-home'))  { toast('请输入主队名称', 'error'); return false; }
      if (!gv('s1-away'))  { toast('请输入客队名称', 'error'); return false; }
      if (!gv('s1-date'))  { toast('请选择比赛日期', 'error'); return false; }
    }
    if (n === 2) {
      const hs = Veto.parseSequence(gv('s2-home-seq'));
      const as = Veto.parseSequence(gv('s2-away-seq'));
      if (hs.length < 3) { toast('主队战绩至少3场', 'error'); return false; }
      if (as.length < 3) { toast('客队战绩至少3场', 'error'); return false; }
    }
    if (n === 3) {
      const oh = gn('s3-o-home'), od = gn('s3-o-draw'), oa = gn('s3-o-away');
      if (!oh || !od || !oa || oh < 1 || od < 1 || oa < 1) {
        toast('请输入有效的三项赔率（均须 > 1）', 'error'); return false;
      }
    }
    if (n === 4) {
      const missing = Asian.SIGNALS.some(s => analysis.step4[s.id] === undefined);
      if (missing) { toast('请为所有五个信号打分', 'error'); return false; }
    }
    return true;
  }

  // ── 步骤数据收集 ───────────────────────────────────────────
  function collectStep(n) {
    if (n === 1) {
      analysis.step1 = {
        league:    gv('s1-league'),
        home_team: gv('s1-home'),
        away_team: gv('s1-away'),
        date:      gv('s1-date'),
        time:      gv('s1-time'),
      };
    }
    if (n === 2) {
      analysis.step2 = {
        home_seq:       gv('s2-home-seq'),
        away_seq:       gv('s2-away-seq'),
        n:              parseInt(gv('s2-n')) || 10,
        decay:          parseFloat(gv('s2-decay')) || 0.8,
        pinn_open_line: gn('s2-pinn-ol'),
        pinn_open_home: gn('s2-pinn-oh'),
        pinn_open_away: gn('s2-pinn-oa'),
        pinn_close_line: gn('s2-pinn-cl'),
        pinn_home:      gn('s2-pinn-home'),
        pinn_away:      gn('s2-pinn-away'),
        will_open_home:  gn('s2-will-oh'),
        will_open_away:  gn('s2-will-oa'),
        will_close_home: gn('s2-will-ch'),
        will_close_away: gn('s2-will-ca'),
        will_close_line: gn('s2-will-cl'),
        vetoResult: analysis.step2.vetoResult,
      };
    }
    if (n === 3) {
      analysis.step3 = {
        o_home: gn('s3-o-home'),
        o_draw: gn('s3-o-draw'),
        o_away: gn('s3-o-away'),
        evResult: analysis.step3.evResult,
      };
    }
    // step4 is collected in signal button clicks
  }

  // ── 步骤2：实时计算否决模型 ───────────────────────────────
  function computeVeto() {
    const hs = gv('s2-home-seq');
    const as = gv('s2-away-seq');
    if (!hs || !as) { $('s2-veto-preview').classList.add('hidden'); return; }

    const parsed = {
      league:         gv('s1-league') || '其他',
      homeSeq:        hs,
      awaySeq:        as,
      decay:          parseFloat(gv('s2-decay')) || 0.8,
      pinnHomeWater:  gn('s2-pinn-home'),
      pinnAwayWater:  gn('s2-pinn-away'),
    };

    try {
      const r = Veto.analyze(parsed);
      analysis.step2.vetoResult = r;

      // 更新序列长度标签
      $('s2-home-label').textContent = r.home_seq_parsed.length ? `（${r.home_seq_parsed.length}场）` : '';
      $('s2-away-label').textContent = r.away_seq_parsed.length ? `（${r.away_seq_parsed.length}场）` : '';

      const corrText = r.draw_correction_triggered
        ? `<span class="font-semibold text-indigo-700">⚑ 平局关注标记（条件 ${r.correction_conditions_met.join('+')}）</span>`
        : `<span class="text-gray-400">未触发平局关注</span>`;

      $('s2-veto-preview').innerHTML = `
        <div class="font-semibold text-indigo-800 mb-2 text-xs">原始否决模型预览 <span class="text-gray-400 font-normal">（未校准）</span></div>
        <div class="grid grid-cols-3 gap-2 text-center mb-1">
          <div class="bg-white rounded-lg p-2 border border-indigo-100">
            <div class="text-xs text-green-700 font-medium">主胜</div>
            <div class="text-lg font-bold text-green-700">${pct(r.p_home)}</div>
          </div>
          <div class="bg-white rounded-lg p-2 border border-indigo-100">
            <div class="text-xs text-yellow-600 font-medium">平局</div>
            <div class="text-lg font-bold text-yellow-600">${pct(r.p_draw)}</div>
          </div>
          <div class="bg-white rounded-lg p-2 border border-indigo-100">
            <div class="text-xs text-red-600 font-medium">客胜</div>
            <div class="text-lg font-bold text-red-600">${pct(r.p_away)}</div>
          </div>
        </div>
        <div class="text-xs text-center mt-1">${corrText}</div>
      `;
      $('s2-veto-preview').classList.remove('hidden');
    } catch(e) {
      $('s2-veto-preview').classList.add('hidden');
    }
  }

  // ── 步骤3：实时计算EV ─────────────────────────────────────
  function computeEV() {
    const oh = gn('s3-o-home'), od = gn('s3-o-draw'), oa = gn('s3-o-away');
    if (!oh || !od || !oa || oh < 1 || od < 1 || oa < 1) {
      $('s3-ev-preview').classList.add('hidden'); return;
    }

    const veto = analysis.step2.vetoResult;
    if (!veto) { $('s3-ev-preview').classList.add('hidden'); return; }

    const r = EV.analyze({ home: veto.p_home, draw: veto.p_draw, away: veto.p_away }, oh, od, oa);
    analysis.step3.evResult = r;

    const jMap = { valid: { cls:'ev-valid', txt:'✓ 有效价值' }, weak: { cls:'ev-weak', txt:'△ 弱价值' }, none: { cls:'ev-none', txt:'✗' } };

    const rows = [
      { side:'主胜', col:'home', clr:'text-green-700' },
      { side:'平局', col:'draw', clr:'text-yellow-600' },
      { side:'客胜', col:'away', clr:'text-red-600' },
    ].map(({ side, col, clr }) => {
      const j = jMap[r.judgments[col]];
      return `<tr>
        <td class="font-medium ${clr}">${side}</td>
        <td>${pct(veto['p_' + col])}</td>
        <td>${pct(r.implied[col])}</td>
        <td class="${r.gap[col] >= 0 ? 'text-green-600' : 'text-red-500'}">${sign(r.gap[col])}</td>
        <td>${r.ev[col].toFixed(3)}</td>
        <td><span class="ev-tag ${j.cls}">${j.txt}</span></td>
      </tr>`;
    }).join('');

    $('s3-ev-preview').innerHTML = `
      <div class="bg-white rounded-xl border border-gray-100 p-3">
        <div class="text-xs text-gray-500 mb-2">抽水率：约 <strong>${r.overround.toFixed(1)}%</strong>（竞彩官方返奖约69%，抽水约31%）</div>
        <div class="overflow-x-auto">
          <table class="ev-table w-full">
            <thead><tr>
              <th>选项</th><th>真实概率</th><th>隐含概率</th><th>差值</th><th>EV</th><th>判断</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    $('s3-ev-preview').classList.remove('hidden');
  }

  // ── 步骤4：信号卡片构建 ───────────────────────────────────
  function buildSignalCards() {
    const container = $('s4-signals');
    container.innerHTML = '';
    analysis.step4Sources = {};

    Asian.SIGNALS.forEach(sig => {
      const isTimeSensitive = sig.id === 's4' || sig.id === 's5';
      const disabled = isTimeSensitive && _noiseZone;
      const card = document.createElement('div');
      card.className = `signal-card bg-white${disabled ? ' opacity-50' : ''}`;
      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="text-sm font-semibold text-gray-800">
              ${sig.name}
              ${sig.hasAuto ? '<span class="signal-auto-badge">可自动</span>' : ''}
              ${disabled ? '<span class="text-xs text-red-500 ml-1">（噪音区自动置0）</span>' : ''}
            </div>
            <div class="text-xs text-gray-500 mt-1">${sig.desc}</div>
          </div>
          <div class="flex flex-col items-center flex-shrink-0 mt-1 gap-0.5">
            <div id="${sig.id}-val-display" class="signal-value-display ${disabled ? 'sv-neu' : 'sv-pending'}">${disabled ? '0' : '?'}</div>
            <span id="${sig.id}-src-badge" class="signal-source-badge ${disabled ? 'badge-auto' : 'badge-pending'}">${disabled ? '自动' : '待输入'}</span>
          </div>
        </div>
        <div class="signal-btns${disabled ? '' : ' signal-btns-pending'}" id="${sig.id}-btns">
          <button class="signal-btn${disabled ? ' disabled-btn' : ''}" data-sig="${sig.id}" data-val="1" ${disabled ? 'disabled' : ''}>+1 偏主</button>
          <button class="signal-btn${disabled ? ' disabled-btn' : ''}" data-sig="${sig.id}" data-val="0" ${disabled ? 'disabled' : ''}>0 中性</button>
          <button class="signal-btn${disabled ? ' disabled-btn' : ''}" data-sig="${sig.id}" data-val="-1" ${disabled ? 'disabled' : ''}>-1 偏客</button>
        </div>`;
      container.appendChild(card);

      // 噪音区直接自动置0
      if (disabled) {
        analysis.step4[sig.id] = 0;
        analysis.step4Sources[sig.id] = 'auto';
      }
    });

    // 绑定点击（只对非禁用按钮生效）
    container.querySelectorAll('.signal-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const sig = btn.dataset.sig;
        const val = parseInt(btn.dataset.val);
        setSignal(sig, val, 'manual');
        updateAsianTotal();
      });
    });
  }

  function setSignal(sigId, val, source = 'manual') {
    analysis.step4[sigId] = val;
    if (!analysis.step4Sources) analysis.step4Sources = {};
    analysis.step4Sources[sigId] = source;

    // 更新按钮状态
    document.querySelectorAll(`[data-sig="${sigId}"]`).forEach(btn => {
      const bv = parseInt(btn.dataset.val);
      btn.classList.remove('selected-pos','selected-neu','selected-neg');
      if (bv === val) {
        btn.classList.add(val > 0 ? 'selected-pos' : val < 0 ? 'selected-neg' : 'selected-neu');
      }
    });
    // 更新数值圆圈
    const disp = $(`${sigId}-val-display`);
    if (disp) {
      disp.textContent = val > 0 ? `+${val}` : String(val);
      disp.className = `signal-value-display ${val > 0 ? 'sv-pos' : val < 0 ? 'sv-neg' : 'sv-neu'}`;
    }
    // 更新来源角标
    const badge = $(`${sigId}-src-badge`);
    if (badge) {
      const badgeMap = {
        ai:     { cls: 'badge-ai',     text: 'AI✓' },
        auto:   { cls: 'badge-auto',   text: '自动' },
        manual: { cls: 'badge-manual', text: '手动' },
      };
      const b = badgeMap[source] || badgeMap.manual;
      badge.className = `signal-source-badge ${b.cls}`;
      badge.textContent = b.text;
    }
    // 移除待输入高亮（已有值了）
    const btnsEl = $(`${sigId}-btns`);
    if (btnsEl) btnsEl.classList.remove('signal-btns-pending');
  }

  // ── 市场解读展示 ──────────────────────────────────────────
  function showMarketSummary(text) {
    const el = $('s2-market-summary');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
  }

  // ── 步骤2：更新盘口标签显示 ──────────────────────────────
  function updateLineLabels() {
    const olv = gn('s2-pinn-ol');
    const clv = gn('s2-pinn-cl');
    const olLabel = $('s2-ol-label');
    const clLabel = $('s2-cl-label');
    if (olLabel) olLabel.textContent = olv !== null ? Asian.lineToLabel(olv) : '';
    if (clLabel) clLabel.textContent = clv !== null ? Asian.lineToLabel(clv) : '';
  }

  // ── 步骤2：实时显示自动信号预览 ──────────────────────────
  function updateAutoSignalPreview() {
    const container = $('s2-auto-signals');
    if (!container) return;

    const autoResult = Asian.autoCalc({
      pinnOpenLine:  gn('s2-pinn-ol'),
      pinnOpenHome:  gn('s2-pinn-oh'),
      pinnOpenAway:  gn('s2-pinn-oa'),
      pinnCloseLine: gn('s2-pinn-cl'),
      pinnCloseHome: gn('s2-pinn-home'),
      pinnCloseAway: gn('s2-pinn-away'),
      willOpenHome:  gn('s2-will-oh'),
      willOpenAway:  gn('s2-will-oa'),
      willCloseHome: gn('s2-will-ch'),
      willCloseAway: gn('s2-will-ca'),
    });

    const keys = Object.keys(autoResult);
    if (keys.length === 0) {
      container.innerHTML = '<span class="text-gray-400">输入数据后自动计算信号预览</span>';
      return;
    }

    const sigNames = { s0:'S0 CLV', s1:'S1重心', s2:'S2分歧', s3:'S3绝对差', s4:'S4背离' };
    const items = keys.map(k => {
      const v = autoResult[k];
      const cls = v > 0 ? 'text-green-600' : v < 0 ? 'text-red-500' : 'text-gray-500';
      const label = v > 0 ? '偏主' : v < 0 ? '偏客' : '中性';
      return `<span class="inline-flex items-center gap-1 mr-3 text-xs">
        <span class="text-gray-600">${sigNames[k] || k}：</span>
        <span class="font-bold ${cls}">${v >= 0 ? '+'+v : v} ${label}</span>
      </span>`;
    }).join('');
    container.innerHTML = items;
  }

  function autoFillSignals() {
    const s2 = analysis.step2;
    const auto = Asian.autoCalc({
      pinnOpenLine:  s2.pinn_open_line  ?? gn('s2-pinn-ol'),
      pinnOpenHome:  s2.pinn_open_home  ?? gn('s2-pinn-oh'),
      pinnOpenAway:  s2.pinn_open_away  ?? gn('s2-pinn-oa'),
      pinnCloseLine: s2.pinn_close_line ?? gn('s2-pinn-cl'),
      pinnCloseHome: s2.pinn_home       ?? gn('s2-pinn-home'),
      pinnCloseAway: s2.pinn_away       ?? gn('s2-pinn-away'),
      willOpenHome:  s2.will_open_home  ?? gn('s2-will-oh'),
      willOpenAway:  s2.will_open_away  ?? gn('s2-will-oa'),
      willCloseHome: s2.will_close_home ?? gn('s2-will-ch'),
      willCloseAway: s2.will_close_away ?? gn('s2-will-ca'),
    });
    // 自动填入尚未手动设置的信号
    ['s0','s1','s2','s3','s4'].forEach(k => {
      if (auto[k] !== undefined && analysis.step4[k] === undefined) {
        setSignal(k, auto[k], 'auto');
      }
    });
    updateAsianTotal();
  }

  // ── 截图识别处理 ──────────────────────────────────────────
  async function processVisionImage(file, company, type) {
    const btnId = company === 'pinnacle'
      ? (type === 'open' ? 'btn-vision-pinn-open' : 'btn-vision-pinn-close')
      : 'btn-vision-will-open';
    const btn = $(btnId);
    const origHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.classList.add('loading'); btn.textContent = '识别中…'; }

    try {
      // 路由：平博开盘→recognizeOpening；平博临盘→recognizeClosing（传初盘结果供S4）；威廉→recognizeWilliamTimeline（传初盘结果供S2）
      const pinnOpenResult = analysis.step2 ? analysis.step2.pinnOpenResult || null : null;

      let r;
      if (company === 'william_hill') {
        r = await Vision.recognizeWilliamTimeline(file, pinnOpenResult);
      } else if (type === 'open') {
        r = await Vision.recognizeOpening(file);
        // 保存初盘结果，供后续临盘/威廉调用
        if (analysis.step2) analysis.step2.pinnOpenResult = r;
      } else {
        r = await Vision.recognizeClosing(file, pinnOpenResult);
      }

      // 盘口值校验：必须是0.25的倍数且绝对值≤3，否则是列错位
      const isValidLine = v => v == null || (Math.abs(v) <= 3 && Math.abs(Math.round(v * 4) - v * 4) < 0.01);

      // 盘口识别错误时清空并警告
      ['open_line','close_line','wh_close_line'].forEach(k => {
        if (r[k] != null && !isValidLine(r[k])) {
          toast(`盘口识别异常（值${r[k]}不是有效盘口），请手动填写`, 'error', 4000);
          r[k] = null;
        }
      });

      // 数值字段映射表（填入输入框）
      const fieldMap = {
        open_line:     's2-pinn-ol',
        open_home:     's2-pinn-oh',
        open_away:     's2-pinn-oa',
        close_line:    's2-pinn-cl',
        close_home:    's2-pinn-home',
        close_away:    's2-pinn-away',
        wh_open_home:  's2-will-oh',
        wh_open_away:  's2-will-oa',
        wh_close_line: 's2-will-cl',
        wh_close_home: 's2-will-ch',
        wh_close_away: 's2-will-ca',
      };

      let filled = 0;
      Object.entries(fieldMap).forEach(([key, elId]) => {
        if (!elId || r[key] == null) return;
        const el = $(elId);
        if (el) { el.value = r[key]; el.dispatchEvent(new Event('input')); filled++; }
      });

      computeVeto();
      updateLineLabels();
      updateAutoSignalPreview();

      // AI直接计算的信号值：直接设置，来源标记为'ai'
      // S5：来自平博开盘（噪音区时_noiseZone已处理）
      if (r.s5 != null) {
        const s5val = _noiseZone ? 0 : r.s5;
        setSignal('s5', s5val, 'ai');
        filled++;
      }
      // S1/S3/S4：来自平博临盘
      for (const sig of ['s1', 's3', 's4']) {
        if (r[sig] != null) { setSignal(sig, r[sig], 'ai'); filled++; }
      }
      // S2：来自威廉希尔时间轴
      if (r.s2 != null) { setSignal('s2', r.s2, 'ai'); filled++; }

      updateAsianTotal();

      // 噪音区提示（AI识别到）
      if (r.in_noise_zone === 1 && !_noiseZone) {
        toast('AI检测到当前处于噪音区（赛前2小时内），S4已自动置0', 'warning', 3000);
      }

      // 市场解读（平博临盘截图识别结果）
      if (r.market_summary) {
        analysis.step2.market_summary = r.market_summary;
        showMarketSummary(r.market_summary);
      }

      const typeLabel = company === 'william_hill' ? '威廉时间轴' : type === 'open' ? '平博开盘' : '平博临盘';
      toast(`${typeLabel}识别完成，已填入 ${filled} 项数据`, 'success');

    } catch (err) {
      toast(err.message || '识别失败，请重试', 'error', 3500);
    } finally {
      if (btn) { btn.classList.remove('loading'); btn.innerHTML = origHTML; }
    }
  }

  function updateAsianTotal() {
    const sigs = analysis.step4;
    const vals = Asian.SIGNALS.map(s => sigs[s.id] !== undefined ? sigs[s.id] : null);
    const filled = vals.filter(v => v !== null).length;
    if (filled === 0) { $('s4-total-box').classList.add('hidden'); return; }
    const total = vals.filter(v => v !== null).reduce((a, b) => a + b, 0);
    $('s4-total-num').textContent = total >= 0 ? `+${total}` : String(total);
    $('s4-total-num').className = `text-2xl font-bold ${total > 0 ? 'text-green-600' : total < 0 ? 'text-red-500' : 'text-gray-600'}`;
    $('s4-total-interp').textContent = Asian.interpret(total);
    $('s4-total-box').classList.remove('hidden');
  }

  // ── 步骤5：生成最终结果 ───────────────────────────────────
  function buildResult() {
    const vr = analysis.step2.vetoResult;
    const er = analysis.step3.evResult;
    const sigs = analysis.step4;
    if (!vr || !er) return;

    const total = Asian.SIGNALS.reduce((sum, s) => sum + (sigs[s.id] || 0), 0);
    const dec   = Decision.decide(er, total);

    analysis.result = {
      vetoResult:   vr,
      evResult:     er,
      asianTotal:   total,
      decision:     dec,
    };

    $('s5-result').innerHTML = buildResultHTML(analysis.step1, vr, er, sigs, total, dec);
  }

  function buildResultHTML(info, vr, er, sigs, total, dec) {
    const jMap = { valid:'ev-valid', weak:'ev-weak', none:'ev-none' };
    const jTxt = { valid:'✓ 有效价值', weak:'△ 弱价值', none:'✗' };

    // 各信号行
    const sigRows = Asian.SIGNALS.map(s => {
      const v = sigs[s.id] !== undefined ? sigs[s.id] : 0;
      const cls = v > 0 ? 'sv-pos' : v < 0 ? 'sv-neg' : 'sv-neu';
      const dirLabel = v > 0 ? '偏主' : v < 0 ? '偏客' : '中性';
      const overlapNote = s.id === 's1'
        ? '<span class="text-xs text-amber-600 ml-1">⚠️ 与否决模型存在信息重叠，仅供参考</span>'
        : '';
      return `<div class="flex items-center justify-between py-1.5 border-b border-gray-50 flex-wrap gap-y-0.5">
        <span class="text-sm text-gray-700">${s.name.replace(/^S\d+ /,'')}${overlapNote}</span>
        <div class="flex items-center gap-2">
          <span class="signal-value-display ${cls}">${v >= 0 ? '+'+v : v}</span>
          <span class="text-xs text-gray-500">${dirLabel}</span>
        </div>
      </div>`;
    }).join('');

    // EV 表格行
    const sides = [{side:'主胜',col:'home',clr:'text-green-700'},{side:'平局',col:'draw',clr:'text-yellow-600'},{side:'客胜',col:'away',clr:'text-red-600'}];
    const evRows = sides.map(({ side, col, clr }) => `
      <tr>
        <td class="font-medium ${clr} py-1.5">${side}</td>
        <td class="text-center">${pct(vr['p_'+col])}</td>
        <td class="text-center">${pct(er.implied[col])}</td>
        <td class="text-center ${er.gap[col]>=0?'text-green-600':'text-red-500'}">${sign(er.gap[col])}</td>
        <td class="text-center">${er.ev[col].toFixed(3)}</td>
        <td class="text-center"><span class="ev-tag ${jMap[er.judgments[col]]}">${jTxt[er.judgments[col]]}</span></td>
      </tr>`).join('');

    // 决策样式
    const levelCls = {
      '★★★': 'level-sss', '★★': 'level-ss',
      '❌': 'level-no', '⚠️': 'level-warn', '—': 'level-skip'
    };

    return `
      <!-- 比赛信息 -->
      <div class="result-block">
        <div class="result-block-header">${info.league} · ${info.date} ${info.time}</div>
        <div class="result-block-body">
          <div class="text-center text-lg font-bold text-gray-800">${info.home_team} <span class="text-gray-400 font-normal">vs</span> ${info.away_team}</div>
        </div>
      </div>

      <!-- 否决模型 -->
      <div class="result-block">
        <div class="result-block-header">原始否决模型（未校准）</div>
        <div class="result-block-body">
          <div class="prob-row">
            <div class="prob-cell bg-green-50">
              <div class="prob-label">主胜</div>
              <div class="prob-val text-green-700">${pct(vr.p_home)}</div>
            </div>
            <div class="prob-cell bg-yellow-50">
              <div class="prob-label">平局</div>
              <div class="prob-val text-yellow-600">${pct(vr.p_draw)}</div>
            </div>
            <div class="prob-cell bg-red-50">
              <div class="prob-label">客胜</div>
              <div class="prob-val text-red-600">${pct(vr.p_away)}</div>
            </div>
          </div>
          ${vr.draw_correction_triggered
            ? `<p class="text-xs text-center text-indigo-600 mt-2">⚑ 平局关注标记（条件 ${vr.correction_conditions_met.join('+')}）</p>`
            : ''}
        </div>
      </div>

      <!-- 体彩欧赔 EV -->
      <div class="result-block">
        <div class="result-block-header">体彩欧赔分析 · 抽水约 ${er.overround.toFixed(1)}%</div>
        <div class="result-block-body overflow-x-auto">
          <table class="ev-table w-full text-sm">
            <thead><tr class="text-gray-400">
              <th class="text-left py-1">选项</th>
              <th class="text-center">真实</th>
              <th class="text-center">隐含</th>
              <th class="text-center">差值</th>
              <th class="text-center">EV</th>
              <th class="text-center">判断</th>
            </tr></thead>
            <tbody>${evRows}</tbody>
          </table>
        </div>
      </div>

      <!-- 亚盘信号 -->
      <div class="result-block">
        <div class="result-block-header">亚盘六层信号</div>
        <div class="result-block-body">
          ${sigRows}
          <div class="flex items-center justify-between mt-2 pt-2">
            <span class="text-sm font-semibold text-gray-700">总评分</span>
            <div class="flex items-center gap-2">
              <span class="text-xl font-bold ${total>0?'text-green-600':total<0?'text-red-500':'text-gray-600'}">${total>=0?'+'+total:total}</span>
              <span class="text-xs text-gray-500">${Asian.interpret(total)}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 最终决策 -->
      <div class="decision-box ${levelCls[dec.level] || 'level-skip'}">
        <div class="decision-level">${dec.level}</div>
        <div class="decision-text">${dec.text}</div>
        ${dec.detail ? `<div class="decision-detail">${dec.detail}</div>` : ''}
      </div>

      ${(() => {
        // 联赛可信度警告
        const tier = Config.LEAGUE_TIERS;
        const isHigh   = tier.HIGH.includes(info.league);
        const isMedium = tier.MEDIUM.includes(info.league);
        const leagueTierHtml = (!isHigh && !isMedium)
          ? `<div class="mt-3 px-3 py-2 bg-orange-50 border border-orange-300 rounded-xl text-xs text-orange-800">
              ⚠️ 低级别/非主流联赛，否决模型未经专项校准，建议以市场定价为主
            </div>`
          : '';

        // 模型与市场严重背离警告（任一gap绝对值>20%）
        const maxGap = Math.max(Math.abs(er.gap.home), Math.abs(er.gap.draw), Math.abs(er.gap.away));
        const divergenceHtml = maxGap > 0.20
          ? `<div class="mt-3 px-3 py-2 bg-red-50 border border-red-400 rounded-xl text-xs text-red-800 font-medium">
              🔴 模型与市场严重背离（最大差值${(maxGap*100).toFixed(0)}%），建议跳过此场
            </div>`
          : '';

        return leagueTierHtml + divergenceHtml;
      })()}

      <!-- CLV提醒 -->
      <div class="mt-3 px-3 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
        <div class="font-semibold mb-1">赛后请补录平博关盘赔率（在记录页编辑）</div>
        <div class="text-amber-700">CLV追踪是验证你是否有真实edge的唯一指标</div>
      </div>`;
  }

  // ── 保存记录 ───────────────────────────────────────────────
  function saveRecord() {
    const { vetoResult: vr, evResult: er, asianTotal, decision: dec } = analysis.result;
    const s1 = analysis.step1, s2 = analysis.step2, s3 = analysis.step3;

    const record = {
      date:       s1.date,
      time:       s1.time,
      league:     s1.league,
      home_team:  s1.home_team,
      away_team:  s1.away_team,
      veto_inputs: {
        home_sequence:               s2.home_seq,
        away_sequence:               s2.away_seq,
        n:                           s2.n,
        decay_factor:                s2.decay,
        draw_correction_triggered:   vr.draw_correction_triggered,
        correction_conditions_met:   vr.correction_conditions_met,
        pinnacle_home_water:         s2.pinn_home || null,
        pinnacle_away_water:         s2.pinn_away || null,
      },
      veto_output:  { p_home: vr.p_home, p_draw: vr.p_draw, p_away: vr.p_away },
      odds_input:   { home: s3.o_home, draw: s3.o_draw, away: s3.o_away },
      implied_prob: er.implied,
      overround:    er.overround,
      ev:           er.ev,
      gap:          er.gap,
      asian_signals: {
        s0: analysis.step4.s0 || 0,
        s1: analysis.step4.s1 || 0,
        s2: analysis.step4.s2 || 0,
        s3: analysis.step4.s3 || 0,
        s4: analysis.step4.s4 || 0,
        s5: analysis.step4.s5 || 0,
        total:        asianTotal,
        window_valid: !_noiseZone,   // S4/S5是否处于有效时间窗口
      },
      decision:        `${dec.level} ${dec.text}`,
      recommend:       dec.recommend,
      analysis_window: (() => { const w = _checkTimeWindow(); return w ? w.code : 'unknown'; })(),
      model_version:   Config.MODEL_VERSION,
      clv_tracking:    null,     // 赛后补录：{ bet_side, buy_odds, close_odds, clv }
      betted:          false,    // 是否实际下注
      bet_selection:   null,     // 下注选项
      actual_result:   '',
      is_correct:      null,
      notes:           '',
    };

    Storage.Records.add(record);
    toast('记录已保存 ✓', 'success');
    setTimeout(() => { showPage('records'); }, 800);
  }

  // ── 重置分析 ───────────────────────────────────────────────
  function restartAnalysis() {
    // 清空状态
    Object.keys(analysis).forEach(k => { analysis[k] = {}; });
    // 清空表单
    ['s1-home','s1-away','s2-home-seq','s2-away-seq','s2-pinn-home','s2-pinn-away',
     's3-o-home','s3-o-draw','s3-o-away'].forEach(id => { if ($(id)) $(id).value = ''; });
    $('s2-n').value = '10'; $('s2-decay').value = '0.8';
    $('s1-date').value = new Date().toISOString().slice(0,10);
    $('s1-time').value = '';
    $('s2-veto-preview').classList.add('hidden');
    $('s3-ev-preview').classList.add('hidden');
    $('s4-total-box').classList.add('hidden');
    const wsEl = $('s1-window-status');
    if (wsEl) { wsEl.className = 'hidden'; wsEl.textContent = ''; }
    const wwEl = $('s4-window-warning');
    if (wwEl) wwEl.classList.add('hidden');
    _noiseZone = false;
    // 重建信号卡片（清空选中状态和来源）
    analysis.step4 = {};
    analysis.step4Sources = {};
    buildSignalCards();
    goToStep(1);
  }

  // ── 记录页渲染 ─────────────────────────────────────────────
  function renderRecords() {
    let records = Storage.Records.getAll().slice().reverse();
    if (recordsFilter === 'pending') records = records.filter(r => !r.actual_result);

    const container = $('records-list');
    if (records.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">${recordsFilter === 'pending' ? '没有待回填的记录' : '还没有记录，完成一次分析后保存'}</div></div>`;
      return;
    }

    container.innerHTML = records.map(rec => {
      const decLevel  = getDecisionLevel(rec.decision || '');
      const miniCls   = { '★★★':'sss','★★':'ss','❌':'no','⚠️':'warn','—':'skip' }[decLevel] || 'skip';
      const resultBadge = rec.actual_result
        ? `<span class="badge ${rec.is_correct === true ? 'badge-correct' : rec.is_correct === false ? 'badge-wrong' : 'badge-gray'}">${rec.actual_result}${rec.is_correct === true ? ' ✓' : rec.is_correct === false ? ' ✗' : ''}</span>`
        : `<span class="badge badge-pending">待回填</span>`;
      return `
        <div class="record-card" onclick="App.openRecord(${rec.id})">
          <div class="record-header">
            <span class="record-date">${rec.date || ''} ${rec.time || ''}</span>
            ${resultBadge}
          </div>
          <div class="record-teams">${rec.home_team} <span class="text-gray-400 font-normal text-sm">vs</span> ${rec.away_team}</div>
          <div class="record-meta">
            <span class="badge badge-league">${rec.league || ''}</span>
            <span class="decision-mini ${miniCls}">${rec.decision || '—'}</span>
          </div>
        </div>`;
    }).join('');

    // 过滤按钮
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === recordsFilter);
      btn.onclick = () => { recordsFilter = btn.dataset.filter; renderRecords(); };
    });
  }

  function getDecisionLevel(text) {
    if (text.startsWith('★★★')) return '★★★';
    if (text.startsWith('★★'))  return '★★';
    if (text.startsWith('❌'))   return '❌';
    if (text.startsWith('⚠️'))  return '⚠️';
    return '—';
  }

  // ── 记录详情 Modal ─────────────────────────────────────────
  function openRecord(id) {
    const rec = Storage.Records.get(id);
    if (!rec) return;

    const vr = rec.veto_output || {};
    const er = { ev: rec.ev || {}, gap: rec.gap || {}, implied: rec.implied_prob || {}, overround: rec.overround || 0, judgments: {} };
    // Reconstruct judgments
    ['home','draw','away'].forEach(s => {
      const ev = er.ev[s] || 0, gap = er.gap[s] || 0;
      er.judgments[s] = (ev > Config.EV_THRESHOLD && gap > Config.GAP_STRONG) ? 'valid'
                       : (ev > Config.EV_THRESHOLD || gap > Config.GAP_WEAK)  ? 'weak' : 'none';
    });
    const sigs  = rec.asian_signals || {};
    const total = sigs.total || 0;
    const decLevel = getDecisionLevel(rec.decision || '');
    const levelCls = {'★★★':'level-sss','★★':'level-ss','❌':'level-no','⚠️':'level-warn','—':'level-skip'};

    let resultSection = '';
    if (!rec.actual_result) {
      resultSection = `
        <div class="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mt-4">
          <p class="text-sm font-medium text-yellow-800 mb-3">回填实际比赛结果</p>
          <div class="grid grid-cols-3 gap-2">
            <button class="btn btn-ghost" onclick="App.fillResult(${id},'主胜')">主胜</button>
            <button class="btn btn-ghost" onclick="App.fillResult(${id},'平局')">平局</button>
            <button class="btn btn-ghost" onclick="App.fillResult(${id},'客胜')">客胜</button>
          </div>
        </div>`;
    } else {
      const correctText = rec.is_correct === true ? '✓ 预测正确' : rec.is_correct === false ? '✗ 预测错误' : '（无推荐方向）';
      const correctCls  = rec.is_correct === true ? 'text-green-600' : rec.is_correct === false ? 'text-red-500' : 'text-gray-500';
      resultSection = `
        <div class="bg-gray-50 border border-gray-200 rounded-xl p-4 mt-4 flex items-center justify-between">
          <span class="text-sm text-gray-600">实际结果：<strong>${rec.actual_result}</strong></span>
          <span class="text-sm font-semibold ${correctCls}">${correctText}</span>
        </div>`;
    }

    const info = { league: rec.league, date: rec.date, time: rec.time, home_team: rec.home_team, away_team: rec.away_team };
    const dec  = { level: decLevel, text: (rec.decision || '').replace(/^[★❌⚠️—]+ ?/,''), detail: '' };

    const sigMap = { s0:'S0 CLV方向', s1:'S1 平博重心', s2:'S2 公司分歧', s3:'S3 水位差值', s4:'S4 盘口背离', s5:'S5 降盘异常' };
    const sigRows = Object.keys(sigMap).map(k => {
      const v = sigs[k] || 0;
      const cls = v > 0 ? 'sv-pos' : v < 0 ? 'sv-neg' : 'sv-neu';
      return `<div class="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
        <span class="text-sm text-gray-700">${sigMap[k]}</span>
        <span class="signal-value-display ${cls} text-xs w-6 h-6">${v >= 0 ? '+'+v : v}</span>
      </div>`;
    }).join('');

    // EV rows
    const jMap2 = { valid:'ev-valid', weak:'ev-weak', none:'ev-none' };
    const jTxt2 = { valid:'✓ 有效', weak:'△ 弱', none:'✗' };
    const evSides = [{side:'主胜',col:'home',clr:'text-green-700'},{side:'平局',col:'draw',clr:'text-yellow-600'},{side:'客胜',col:'away',clr:'text-red-600'}];
    const evRows2 = evSides.map(({ side, col, clr }) => `
      <tr>
        <td class="font-medium ${clr} py-1.5">${side}</td>
        <td class="text-center">${pct((vr['p_'+col] || 0))}</td>
        <td class="text-center">${pct((er.implied[col] || 0))}</td>
        <td class="text-center ${(er.gap[col]||0)>=0?'text-green-600':'text-red-500'}">${sign(er.gap[col]||0)}</td>
        <td class="text-center">${(er.ev[col]||0).toFixed(3)}</td>
        <td class="text-center"><span class="ev-tag ${jMap2[er.judgments[col]]||'ev-none'}">${jTxt2[er.judgments[col]]||'✗'}</span></td>
      </tr>`).join('');

    $('modal-title').textContent = `${rec.home_team} vs ${rec.away_team}`;
    $('modal-content').innerHTML = `
      <div class="space-y-3">
        <div class="text-xs text-gray-400 text-center">${rec.league} · ${rec.date} ${rec.time}</div>

        <!-- 否决模型 -->
        <div class="result-block">
          <div class="result-block-header">否决模型</div>
          <div class="result-block-body">
            <div class="prob-row">
              <div class="prob-cell bg-green-50"><div class="prob-label">主胜</div><div class="prob-val text-green-700">${pct(vr.p_home||0)}</div></div>
              <div class="prob-cell bg-yellow-50"><div class="prob-label">平局</div><div class="prob-val text-yellow-600">${pct(vr.p_draw||0)}</div></div>
              <div class="prob-cell bg-red-50"><div class="prob-label">客胜</div><div class="prob-val text-red-600">${pct(vr.p_away||0)}</div></div>
            </div>
            ${(rec.veto_inputs||{}).draw_correction_triggered ? '<p class="text-xs text-center text-indigo-600 mt-2">✦ 已触发平局修正</p>' : ''}
          </div>
        </div>

        <!-- EV -->
        <div class="result-block">
          <div class="result-block-header">体彩欧赔 · 抽水约 ${(er.overround||0).toFixed(1)}%</div>
          <div class="result-block-body overflow-x-auto">
            <table class="ev-table w-full text-sm">
              <thead><tr class="text-gray-400">
                <th class="text-left py-1">选项</th><th class="text-center">真实</th><th class="text-center">隐含</th>
                <th class="text-center">差值</th><th class="text-center">EV</th><th class="text-center">判断</th>
              </tr></thead>
              <tbody>${evRows2}</tbody>
            </table>
          </div>
        </div>

        <!-- 亚盘 -->
        <div class="result-block">
          <div class="result-block-header">亚盘六层信号 · 总分 ${total>=0?'+'+total:total}</div>
          <div class="result-block-body">
            ${sigRows}
            <p class="text-xs text-gray-500 mt-2 text-center">${Asian.interpret(total)}</p>
          </div>
        </div>

        <!-- 决策 -->
        <div class="decision-box ${levelCls[decLevel]||'level-skip'}">
          <div class="decision-level">${decLevel}</div>
          <div class="decision-text">${dec.text || rec.decision || ''}</div>
        </div>

        ${resultSection}

        <!-- CLV补录 -->
        ${rec.clv_tracking
          ? `<div class="bg-green-50 border border-green-200 rounded-xl p-3 mt-3">
              <div class="text-xs font-semibold text-green-700 mb-1">CLV已补录</div>
              <div class="flex justify-between text-xs text-gray-600">
                <span>投注：${rec.clv_tracking.bet_side} @ ${rec.clv_tracking.buy_odds.toFixed(3)}</span>
                <span>平博关盘：${rec.clv_tracking.close_odds.toFixed(3)}</span>
              </div>
              <div class="text-center mt-1 font-bold ${rec.clv >= 0 ? 'text-green-600' : 'text-red-500'}">
                CLV ${rec.clv >= 0 ? '+' : ''}${(rec.clv * 100).toFixed(1)}%
                <span class="text-xs font-normal text-gray-500 ml-1">${rec.clv >= 0 ? '跑赢关盘线' : '跑输关盘线'}</span>
              </div>
            </div>`
          : `<div class="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3">
              <div class="text-xs font-semibold text-amber-700 mb-2">补录CLV（赛后填写）</div>
              <div class="grid grid-cols-3 gap-1.5 mb-2">
                <select id="clv-side-${id}" class="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                  <option value="">投注选项</option>
                  <option value="主胜">主胜</option>
                  <option value="平局">平局</option>
                  <option value="客胜">客胜</option>
                </select>
                <input id="clv-buy-${id}" type="number" step="0.01" placeholder="买入赔率" class="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
                <input id="clv-close-${id}" type="number" step="0.01" placeholder="平博关盘赔率" class="col-span-3 border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              </div>
              <button onclick="App.saveClv(${id})" class="btn btn-primary w-full text-sm">计算并保存CLV</button>
            </div>`
        }

        <button class="btn btn-danger w-full mt-2" onclick="App.deleteRecord(${id})">删除此记录</button>
      </div>`;
    openModal();
  }

  function saveClv(id) {
    const side  = (document.getElementById(`clv-side-${id}`) || {}).value;
    const buy   = parseFloat((document.getElementById(`clv-buy-${id}`) || {}).value);
    const close = parseFloat((document.getElementById(`clv-close-${id}`) || {}).value);
    if (!side)         { toast('请选择投注选项', 'error'); return; }
    if (!(buy > 1))    { toast('买入赔率无效（需>1）', 'error'); return; }
    if (!(close > 1))  { toast('关盘赔率无效（需>1）', 'error'); return; }
    const clv = Storage.Records.setClv(id, side, buy, close);
    closeModal();
    const pct = ((clv - 1) * 100).toFixed(1);
    toast(`CLV已保存：${clv >= 1 ? '+' : ''}${pct}%`, clv >= 1 ? 'success' : '');
    renderRecords();
  }

  function fillResult(id, result) {
    Storage.Records.setResult(id, result);
    closeModal();
    toast(`已回填：${result}`, 'success');
    renderRecords();
  }

  function deleteRecord(id) {
    if (!confirm('确认删除此记录？')) return;
    Storage.Records.delete(id);
    closeModal();
    toast('已删除', '');
    renderRecords();
  }

  // ── Modal 控制 ─────────────────────────────────────────────
  function openModal() {
    $('modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
  }
  function initModal() {
    $('modal-close').addEventListener('click', closeModal);
    $('modal-overlay').addEventListener('click', e => {
      if (e.target === $('modal-overlay')) closeModal();
    });
  }

  // ── 复盘页渲染 ─────────────────────────────────────────────
  function renderReview() {
    const completed = Stats.getCompletedCount();
    const container = $('review-content');

    if (completed === 0) {
      container.innerHTML = `
        <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
          <div class="text-4xl mb-3">📊</div>
          <p class="text-base font-semibold text-gray-800 mb-1">暂无数据</p>
          <p class="text-sm text-gray-500">完成第一场分析并回填赛果后即可查看统计</p>
        </div>`;
      return;
    }

    const s = Stats.compute();
    if (!s) { container.innerHTML = '<p class="text-gray-400 text-center py-8">暂无数据</p>'; return; }

    const MIN_SAMPLE = 3;

    // 信号行：样本不足时显示"样本不足（N场）"
    function sigRow(label, st) {
      if (!st || st.total === 0) return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-xs text-gray-400">暂无数据</span></div>`;
      if (st.total < MIN_SAMPLE) return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-xs text-gray-400">样本不足（${st.total}场）</span></div>`;
      const acc = (st.accuracy * 100).toFixed(1);
      return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-sm font-bold ${st.accuracy >= 0.5 ? 'text-green-600' : 'text-red-500'}">${acc}%（${st.total}场）</span></div>`;
    }

    // 亚盘总分相关性行
    function corrRow(label, data) {
      if (!data || data.count === 0) return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-xs text-gray-400">暂无数据</span></div>`;
      if (data.accuracy === null) return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-xs text-gray-400">${data.count}场（无方向信号）</span></div>`;
      if (data.count < MIN_SAMPLE) return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-xs text-gray-400">样本不足（${data.count}场）</span></div>`;
      const acc = (data.accuracy * 100).toFixed(1);
      return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-sm font-bold ${data.accuracy >= 0.5 ? 'text-green-600' : 'text-red-500'}">${acc}%（${data.count}场）</span></div>`;
    }

    const accDisplay = s.accuracy !== null ? `${(s.accuracy * 100).toFixed(1)}%` : '—';
    const correctN   = s.accuracy !== null ? Math.round(s.accuracy * s.accuracyCount) : 0;
    const accDetail  = s.accuracyCount > 0 ? `${correctN}/${s.accuracyCount}场` : '暂无推荐记录';

    const leagueHtml = Object.entries(s.leagueStats)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([lg, data]) => {
        if (data.withRecommend === 0) return `<div class="flex items-center justify-between mb-2">
          <span class="text-sm text-gray-600">${lg}</span>
          <span class="text-xs text-gray-400">${data.total}场，无推荐记录</span></div>`;
        if (data.withRecommend < MIN_SAMPLE) return `<div class="flex items-center justify-between mb-2">
          <span class="text-sm text-gray-600">${lg}</span>
          <span class="text-xs text-gray-400">样本不足（${data.withRecommend}场）</span></div>`;
        const acc = (data.accuracy * 100).toFixed(1);
        return `<div class="flex items-center justify-between mb-2">
          <span class="text-sm text-gray-600">${lg}</span>
          <span class="text-sm font-bold ${data.accuracy >= 0.5 ? 'text-green-600' : 'text-red-500'}">${data.withRecommend}场，${acc}%</span></div>`;
      }).join('');

    const clvHtml = s.clvStats
      ? `<div class="flex items-center justify-between mb-2">
          <span class="text-sm text-gray-600">平均CLV</span>
          <span class="text-sm font-bold ${s.clvStats.avgClv >= 0 ? 'text-green-600' : 'text-red-500'}">${s.clvStats.avgClv >= 0 ? '+' : ''}${(s.clvStats.avgClv * 100).toFixed(1)}%</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm text-gray-600">正CLV场次</span>
          <span class="text-sm font-bold text-green-600">${(s.clvStats.posCount / s.clvStats.count * 100).toFixed(1)}%（${s.clvStats.count}场）</span>
        </div>`
      : `<p class="text-xs text-gray-400">暂无CLV数据（需赛后补录平博关盘赔率）</p>`;

    const MIN_SAMPLE_S45 = 20;
    function sigRowS45(label, st) {
      if (!st || st.total === 0) return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-xs text-gray-400">暂无数据</span></div>`;
      if (st.total < MIN_SAMPLE_S45) return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-xs text-gray-400">样本不足（${st.total}场，建议≥20场）</span></div>`;
      const acc = (st.accuracy * 100).toFixed(1);
      return `<div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">${label}</span>
        <span class="text-sm font-bold ${st.accuracy >= 0.5 ? 'text-green-600' : 'text-red-500'}">${acc}%（${st.total}场）</span></div>`;
    }

    const vetoAccDisplay = s.vetoAccuracy !== null ? `${(s.vetoAccuracy * 100).toFixed(1)}%` : '—';

    container.innerHTML = `
      <!-- ① CLV统计（最优先） -->
      <div class="bg-white rounded-2xl border border-green-100 shadow-sm p-4 mb-4">
        <h3 class="text-sm font-semibold text-green-700 mb-1">CLV 统计 <span class="text-xs font-normal text-gray-400 ml-1">核心指标 · 长期正CLV = 有真实edge</span></h3>
        <p class="text-xs text-gray-400 mb-3">赛后补录平博关盘赔率后自动计算</p>
        ${clvHtml}
      </div>

      <!-- ② S4/S5信号 + 亚盘总分≥3 -->
      <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h3 class="text-sm font-semibold text-gray-700 mb-3">关键信号命中率</h3>
        ${sigRowS45('S4 盘口水位背离', s.signalStats.s4)}
        ${sigRowS45('S5 降盘异常反转', s.signalStats.s5)}
        ${corrRow('亚盘总分 |≥3| 命中率', s.totalCorrelation.high)}
      </div>

      <!-- ③ 参考指标 -->
      <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h3 class="text-sm font-semibold text-gray-700 mb-1">参考指标 <span class="text-xs font-normal text-gray-400 ml-1">供参考，不作为主要判断依据</span></h3>
        <div class="flex items-center justify-between mb-2 mt-2">
          <span class="text-sm text-gray-600">整体命中率（有推荐记录）</span>
          <span class="text-sm font-bold ${s.accuracy !== null && s.accuracy >= 0.33 ? 'text-green-600' : 'text-gray-600'}">${accDisplay}（${accDetail}）</span>
        </div>
        <div class="flex items-center justify-between mb-3">
          <span class="text-sm text-gray-600">否决模型方向命中率</span>
          <span class="text-sm font-bold ${s.vetoAccuracy !== null && s.vetoAccuracy >= 0.33 ? 'text-green-600' : 'text-gray-600'}">${vetoAccDisplay}（${s.total}场）</span>
        </div>
        <div class="border-t border-gray-100 pt-3">
          ${sigRow('S0 CLV方向信号', s.signalStats.s0)}
          ${sigRow('S1 平博重心方向', s.signalStats.s1)}
          ${sigRow('S2 公司分歧信号', s.signalStats.s2)}
          ${sigRow('S3 水位绝对差值', s.signalStats.s3)}
          ${corrRow('亚盘总分 1-2 命中率', s.totalCorrelation.mid)}
        </div>
      </div>

      <!-- 各联赛命中率 -->
      <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h3 class="text-sm font-semibold text-gray-700 mb-3">各联赛命中率</h3>
        ${leagueHtml || '<p class="text-xs text-gray-400">暂无数据</p>'}
      </div>`;
  }

  // ── 账单页渲染 ─────────────────────────────────────────────
  function renderFinance() {
    const bets = Storage.Bets.getAll().slice().reverse();
    const total_stake  = bets.reduce((s, b) => s + (b.stake || 0), 0);
    const total_profit = bets.reduce((s, b) => s + (b.profit || 0), 0);
    const roi = total_stake ? (total_profit / total_stake * 100) : 0;

    $('finance-summary').innerHTML = `
      <div class="stat-card">
        <div class="stat-num text-lg">¥${total_stake.toFixed(0)}</div>
        <div class="stat-label">总投入</div>
      </div>
      <div class="stat-card">
        <div class="stat-num text-lg ${total_profit>=0?'text-green-600':'text-red-500'}">¥${total_profit.toFixed(0)}</div>
        <div class="stat-label">总盈亏</div>
      </div>
      <div class="stat-card">
        <div class="stat-num text-lg ${roi>=0?'text-green-600':'text-red-500'}">${roi.toFixed(1)}%</div>
        <div class="stat-label">ROI</div>
      </div>`;

    const list = $('bets-list');
    if (bets.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">💰</div><div class="empty-text">还没有下注记录</div></div>';
      return;
    }
    list.innerHTML = bets.map(b => {
      const isParlay = Array.isArray(b.legs);
      const legsHtml = isParlay
        ? b.legs.map(l => `<div class="text-xs text-gray-600">${l.match || '未知比赛'} · ${l.betType === '让球胜平负' ? '让球 ' : ''}${l.side || ''} @ ${parseFloat(l.odds).toFixed(2)}</div>`).join('')
        : `<div class="text-sm text-gray-800">${b.match || '未知比赛'} · ${b.side || ''}</div>`;
      const oddsLabel = isParlay
        ? `${b.legs.length}串1 · 总赔率 ${(b.totalOdds||0).toFixed(3)}`
        : `赔率 ${b.odds||0}`;
      return `
      <div class="finance-card mb-3">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs text-gray-400">${b.date || ''}${isParlay && b.legs.length > 1 ? ' · 串关' : ''}</span>
          <span class="text-sm font-bold ${(b.profit||0)>=0?'text-green-600':'text-red-500'}">${(b.profit||0)>=0?'+':''}¥${(b.profit||0).toFixed(0)}</span>
        </div>
        ${legsHtml}
        <div class="text-xs text-gray-500 mt-1">投入 ¥${b.stake||0} · ${oddsLabel} · ${b.result==='win'?'全中':'未中'}</div>
      </div>`;
    }).join('');
  }

  function initFinance() {
    $('btn-add-bet').addEventListener('click', openAddBet);
  }

  function openAddBet() {
    window._betLegs = [{ match: '', betType: '胜平负', side: '主胜', odds: '' }];
    window._betResult = null;
    $('modal-title').textContent = '添加投注记录';
    _renderBetForm();
    openModal();
  }

  function _renderBetForm() {
    const legs = window._betLegs;
    const legRows = legs.map((leg, i) => {
      const sideOpts = (leg.betType === '让球胜平负'
        ? ['让主胜','让平','让客胜']
        : ['主胜','平局','客胜']
      ).map(s => `<option ${leg.side === s ? 'selected' : ''}>${s}</option>`).join('');
      return `
        <div class="bg-gray-50 rounded-xl p-3 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-gray-500">第${i + 1}场</span>
            ${legs.length > 1 ? `<button onclick="App.removeBetLeg(${i})" class="text-red-400 text-xs">删除</button>` : ''}
          </div>
          <input class="form-input text-sm" placeholder="比赛描述（如：曼城 vs 阿森纳）"
            data-leg="${i}" data-field="match" value="${leg.match}">
          <div class="grid grid-cols-2 gap-2">
            <select class="form-input text-sm" data-leg="${i}" data-field="betType"
              onchange="App.switchBetType(${i}, this.value)">
              <option ${leg.betType === '胜平负' ? 'selected' : ''}>胜平负</option>
              <option ${leg.betType === '让球胜平负' ? 'selected' : ''}>让球胜平负</option>
            </select>
            <select class="form-input text-sm" data-leg="${i}" data-field="side">${sideOpts}</select>
          </div>
          <input type="number" class="form-input text-sm" min="1" step="0.01"
            placeholder="赔率（如 1.85）" data-leg="${i}" data-field="odds" value="${leg.odds}">
        </div>`;
    }).join('');

    const allHaveOdds = legs.every(l => parseFloat(l.odds) > 1);
    const totalOdds = allHaveOdds ? legs.reduce((p, l) => p * parseFloat(l.odds), 1) : null;
    const parlayLabel = legs.length === 1 ? '单关' : `${legs.length} 串 1`;

    $('modal-content').innerHTML = `
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="form-label">日期</label>
            <input id="bet-date" type="date" class="form-input" value="${new Date().toISOString().slice(0, 10)}">
          </div>
          <div>
            <label class="form-label">投注金额 ¥</label>
            <input id="bet-stake" type="number" class="form-input" min="1" step="1">
          </div>
        </div>
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="form-label mb-0">场次（${parlayLabel}）</label>
            ${legs.length < 8 ? `<button onclick="App.addBetLeg()" class="btn btn-ghost btn-sm text-xs">＋ 添加场次</button>` : ''}
          </div>
          <div class="space-y-2">${legRows}</div>
        </div>
        ${totalOdds !== null ? `
        <div class="bg-blue-50 rounded-xl p-3 text-center text-sm text-blue-700">
          总赔率：<strong>${totalOdds.toFixed(3)}</strong>（${parlayLabel}）
        </div>` : ''}
        <div>
          <label class="form-label">结果</label>
          <div class="grid grid-cols-2 gap-3">
            <button class="btn ${window._betResult === 'win' ? 'btn-primary' : 'btn-ghost'}"
              onclick="App.setBetResult('win')">✓ 全中</button>
            <button class="btn ${window._betResult === 'lose' ? 'btn-primary' : 'btn-ghost'}"
              onclick="App.setBetResult('lose')">✗ 未中</button>
          </div>
        </div>
        <button class="btn btn-primary w-full mt-2" onclick="App.saveBet()">保存</button>
      </div>`;
  }

  function _collectLegsFromDom() {
    window._betLegs.forEach((leg, i) => {
      const get = (field) => document.querySelector(`[data-leg="${i}"][data-field="${field}"]`);
      const matchEl = get('match'), oddsEl = get('odds');
      if (matchEl) leg.match = matchEl.value;
      if (oddsEl)  leg.odds  = oddsEl.value;
    });
  }

  function addBetLeg() {
    _collectLegsFromDom();
    window._betLegs.push({ match: '', betType: '胜平负', side: '主胜', odds: '' });
    _renderBetForm();
  }

  function removeBetLeg(i) {
    _collectLegsFromDom();
    window._betLegs.splice(i, 1);
    _renderBetForm();
  }

  function switchBetType(i, betType) {
    _collectLegsFromDom();
    window._betLegs[i].betType = betType;
    window._betLegs[i].side = betType === '让球胜平负' ? '让主胜' : '主胜';
    _renderBetForm();
  }

  function setBetResult(result) {
    _collectLegsFromDom();
    window._betResult = result;
    _renderBetForm();
  }

  function saveBet() {
    _collectLegsFromDom();
    const stake  = parseFloat($('bet-stake')?.value) || 0;
    const date   = $('bet-date')?.value || '';
    const result = window._betResult;
    const legs   = window._betLegs;

    if (!stake) { toast('请填写投注金额', 'error'); return; }
    if (!result) { toast('请选择全中/未中', 'error'); return; }
    if (!legs.every(l => parseFloat(l.odds) > 1)) {
      toast('请完善所有场次的赔率', 'error'); return;
    }

    const totalOdds = legs.reduce((p, l) => p * parseFloat(l.odds), 1);
    const profit = result === 'win' ? stake * (totalOdds - 1) : -stake;

    Storage.Bets.add({ date, type: 'parlay', legs, stake, totalOdds, result, profit });
    closeModal();
    toast('已保存', 'success');
    renderFinance();
  }

  // ── 设置页渲染 ─────────────────────────────────────────────
  function renderSettings() {
    const saved   = Storage.Settings.get();
    const ev      = saved.EV_THRESHOLD   || Config.EV_THRESHOLD;
    const gs      = saved.GAP_STRONG     || Config.GAP_STRONG;
    const gw      = saved.GAP_WEAK       || Config.GAP_WEAK;
    const apiKey  = saved.claude_api_key || '';
    const maskedKey = apiKey ? apiKey.slice(0, 16) + '…' + apiKey.slice(-4) : '';

    $('settings-content').innerHTML = `
      <div class="space-y-4">

        <!-- Claude API Key -->
        <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <h3 class="text-sm font-semibold text-gray-700">截图识别（Claude API）</h3>
          <p class="text-xs text-gray-400">填入后可在步骤二点击「截图识别」按钮，自动从澳客截图中提取盘口和水位数据。</p>
          <div>
            <label class="form-label">Claude API Key</label>
            <input id="cfg-api-key" type="password" class="form-input font-mono text-sm"
              placeholder="sk-ant-api03-…" autocomplete="off" value="${apiKey}">
            ${maskedKey ? `<p class="text-xs text-green-600 mt-1">已设置：${maskedKey}</p>` : ''}
          </div>
          <button class="btn btn-primary w-full" onclick="App.saveApiKey()">保存 API Key</button>
          ${apiKey ? `<button class="btn btn-danger w-full" onclick="App.clearApiKey()">清除 API Key</button>` : ''}
          <p class="text-xs text-gray-400">Key 仅保存在本设备浏览器中，不会上传任何服务器。</p>
        </div>

        <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <h3 class="text-sm font-semibold text-gray-700">EV 与概率差阈值</h3>
          <div>
            <label class="form-label">EV 门槛（默认 1.05）</label>
            <input id="cfg-ev" type="number" class="form-input" value="${ev}" step="0.01" min="1">
          </div>
          <div>
            <label class="form-label">概率差强条件（默认 0.06 = 6%）</label>
            <input id="cfg-gs" type="number" class="form-input" value="${gs}" step="0.01" min="0">
          </div>
          <div>
            <label class="form-label">概率差弱条件（默认 0.03 = 3%）</label>
            <input id="cfg-gw" type="number" class="form-input" value="${gw}" step="0.01" min="0">
          </div>
          <button class="btn btn-primary w-full" onclick="App.saveSettings()">保存设置</button>
          <button class="btn btn-ghost w-full" onclick="App.resetSettings()">恢复默认</button>
        </div>

        <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <h3 class="text-sm font-semibold text-gray-700">联赛平均平局率（内置参考）</h3>
          ${Object.entries(Config.LEAGUE_DRAW_RATES).map(([k,v]) =>
            `<div class="flex justify-between text-sm text-gray-600">
               <span>${k}</span><span>${(v*100).toFixed(0)}%</span>
             </div>`).join('')}
        </div>

        <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 class="text-sm font-semibold text-gray-700 mb-3">数据管理</h3>
          <button class="btn btn-ghost w-full mb-2" onclick="App.exportData()">导出所有数据（JSON）</button>
          <button class="btn btn-danger w-full" onclick="App.clearData()">清空所有记录</button>
        </div>

        <p class="text-xs text-center text-gray-400 pb-4">足彩分析助手 v3 · 模型版本 ${Config.MODEL_VERSION}</p>
      </div>`;
  }

  function saveSettings() {
    const ev = parseFloat($('cfg-ev')?.value);
    const gs = parseFloat($('cfg-gs')?.value);
    const gw = parseFloat($('cfg-gw')?.value);
    if (isNaN(ev) || isNaN(gs) || isNaN(gw)) { toast('请填写有效数值', 'error'); return; }
    const existing = Storage.Settings.get();
    Storage.Settings.save({ ...existing, EV_THRESHOLD: ev, GAP_STRONG: gs, GAP_WEAK: gw });
    Config.EV_THRESHOLD = ev; Config.GAP_STRONG = gs; Config.GAP_WEAK = gw;
    toast('设置已保存', 'success');
  }

  function saveApiKey() {
    const key = ($('cfg-api-key')?.value || '').trim();
    if (!key) { toast('请输入 API Key', 'error'); return; }
    if (!key.startsWith('sk-ant-')) { toast('Key 格式不正确，应以 sk-ant- 开头', 'error'); return; }
    const existing = Storage.Settings.get();
    Storage.Settings.save({ ...existing, claude_api_key: key });
    toast('API Key 已保存', 'success');
    renderSettings();
  }

  function clearApiKey() {
    const existing = Storage.Settings.get();
    delete existing.claude_api_key;
    Storage.Settings.save(existing);
    toast('API Key 已清除', '');
    renderSettings();
  }

  function resetSettings() {
    const existing = Storage.Settings.get();
    const key = existing.claude_api_key; // 保留 API Key
    Storage.Settings.save(key ? { claude_api_key: key } : {});
    Config.EV_THRESHOLD = 1.05; Config.GAP_STRONG = 0.06; Config.GAP_WEAK = 0.03;
    renderSettings();
    toast('已恢复默认设置', '');
  }

  function exportData() {
    const data  = Storage.exportAll();
    const blob  = new Blob([data], { type: 'application/json' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href = url; a.download = `ftb-data-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  function clearData() {
    if (!confirm('确认清空所有记录和下注数据？此操作不可撤销！')) return;
    localStorage.removeItem('ftb_records');
    localStorage.removeItem('ftb_bets');
    toast('已清空所有数据', '');
    renderRecords(); renderFinance(); renderReview();
  }

  // ── PWA 注册 ───────────────────────────────────────────────
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // ── 应用初始化 ─────────────────────────────────────────────
  function init() {
    // 应用已保存的设置到 Config
    const saved = Storage.Settings.get();
    if (saved.EV_THRESHOLD) Config.EV_THRESHOLD = saved.EV_THRESHOLD;
    if (saved.GAP_STRONG)   Config.GAP_STRONG   = saved.GAP_STRONG;
    if (saved.GAP_WEAK)     Config.GAP_WEAK     = saved.GAP_WEAK;

    initNav();
    initAnalysis();
    initModal();
    initFinance();
    registerSW();
  }

  document.addEventListener('DOMContentLoaded', init);

  // 公开给 inline onclick 使用的函数
  return {
    openRecord,
    fillResult,
    saveClv,
    deleteRecord,
    saveBet,
    addBetLeg,
    removeBetLeg,
    switchBetType,
    setBetResult,
    saveSettings,
    saveApiKey,
    clearApiKey,
    resetSettings,
    exportData,
    clearData,
  };

})();
