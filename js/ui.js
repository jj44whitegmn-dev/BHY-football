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
    step4: {},   // 亚盘信号值 {s1,s2,s3,s4,s5}
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

    // 步骤2：输入变化时实时计算否决模型
    ['s2-home-seq','s2-away-seq','s2-n','s2-decay','s2-pinn-home','s2-pinn-away'].forEach(id => {
      $(id) && $(id).addEventListener('input', computeVeto);
    });

    // 步骤2：新增盘口/水位字段监听
    ['s2-pinn-ol','s2-pinn-oh','s2-pinn-oa','s2-pinn-cl','s2-will-oh','s2-will-oa'].forEach(id => {
      $(id) && $(id).addEventListener('input', () => {
        updateLineLabels();
        updateAutoSignalPreview();
      });
    });
    // 终盘水位字段也触发自动信号预览
    ['s2-pinn-home','s2-pinn-away'].forEach(id => {
      $(id) && $(id).addEventListener('input', updateAutoSignalPreview);
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

    // 如果到步骤4，自动填入可自动计算的信号
    if (n === 4) autoFillSignals();
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
        will_open_home: gn('s2-will-oh'),
        will_open_away: gn('s2-will-oa'),
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
        ? `<span class="font-semibold text-indigo-700">已触发平局修正（条件${r.correction_conditions_met.join('+')}）</span>`
        : `<span class="text-gray-500">未触发平局修正</span>`;

      $('s2-veto-preview').innerHTML = `
        <div class="font-semibold text-indigo-800 mb-2 text-xs">否决模型预览</div>
        <div class="grid grid-cols-3 gap-2 text-center mb-2">
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
        <div class="text-xs text-center">${corrText}</div>
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
        <div class="text-xs text-gray-500 mb-2">抽水率：约 <strong>${r.overround.toFixed(1)}%</strong>（竞彩官方返奖约68%）</div>
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
    Asian.SIGNALS.forEach(sig => {
      const card = document.createElement('div');
      card.className = 'signal-card bg-white';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="text-sm font-semibold text-gray-800">
              ${sig.name}
              ${sig.hasAuto ? '<span class="signal-auto-badge">可自动</span>' : ''}
            </div>
            <div class="text-xs text-gray-500 mt-1">${sig.desc}</div>
          </div>
          <div id="${sig.id}-val-display" class="signal-value-display sv-neu flex-shrink-0 mt-1">—</div>
        </div>
        <div class="signal-btns" id="${sig.id}-btns">
          <button class="signal-btn" data-sig="${sig.id}" data-val="1">+1 偏主</button>
          <button class="signal-btn" data-sig="${sig.id}" data-val="0">0 中性</button>
          <button class="signal-btn" data-sig="${sig.id}" data-val="-1">-1 偏客</button>
        </div>`;
      container.appendChild(card);
    });

    // 绑定点击
    container.querySelectorAll('.signal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sig = btn.dataset.sig;
        const val = parseInt(btn.dataset.val);
        setSignal(sig, val);
        updateAsianTotal();
      });
    });
  }

  function setSignal(sigId, val) {
    analysis.step4[sigId] = val;
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
    disp.textContent = val > 0 ? `+${val}` : String(val);
    disp.className = `signal-value-display ${val > 0 ? 'sv-pos' : val < 0 ? 'sv-neg' : 'sv-neu'}`;
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
    });

    const keys = Object.keys(autoResult);
    if (keys.length === 0) {
      container.innerHTML = '<span class="text-gray-400 text-xs">输入数据后自动计算</span>';
      return;
    }

    const sigNames = { s1:'S1重心', s2:'S2分歧', s3:'S3绝对差', s4:'S4背离' };
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
    });
    // 自动填入尚未手动设置的信号
    ['s1','s2','s3','s4'].forEach(k => {
      if (auto[k] !== undefined && analysis.step4[k] === undefined) {
        setSignal(k, auto[k]);
      }
    });
    updateAsianTotal();
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
      return `<div class="flex items-center justify-between py-1.5 border-b border-gray-50">
        <span class="text-sm text-gray-700">${s.name.replace(/^S\d /,'')}</span>
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
        <div class="result-block-header">否决模型</div>
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
            ? `<p class="text-xs text-center text-indigo-600 mt-2">✦ 已触发平局修正（条件 ${vr.correction_conditions_met.join('+')}）</p>`
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
        <div class="result-block-header">亚盘五层信号</div>
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
        s1: analysis.step4.s1 || 0,
        s2: analysis.step4.s2 || 0,
        s3: analysis.step4.s3 || 0,
        s4: analysis.step4.s4 || 0,
        s5: analysis.step4.s5 || 0,
        total: asianTotal,
      },
      decision:      `${dec.level} ${dec.text}`,
      recommend:     dec.recommend,
      model_version: Config.MODEL_VERSION,
      actual_result: '',
      is_correct:    null,
      notes:         '',
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
    // 重建信号卡片（清空选中状态）
    analysis.step4 = {};
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

    const sigMap = { s1:'S1 平博重心', s2:'S2 公司分歧', s3:'S3 水位差值', s4:'S4 盘口背离', s5:'S5 降盘异常' };
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
          <div class="result-block-header">亚盘五层信号 · 总分 ${total>=0?'+'+total:total}</div>
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

        <button class="btn btn-danger w-full mt-2" onclick="App.deleteRecord(${id})">删除此记录</button>
      </div>`;
    openModal();
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
    const total     = Storage.Records.getAll().length;
    const container = $('review-content');

    if (!Stats.isUnlocked()) {
      const pct = Math.round(completed / Config.STATS_UNLOCK_COUNT * 100);
      container.innerHTML = `
        <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center">
          <div class="text-4xl mb-3">📊</div>
          <p class="text-base font-semibold text-gray-800 mb-1">统计分析尚未解锁</p>
          <p class="text-sm text-gray-500 mb-4">需要 <strong>100</strong> 条含实际结果的记录</p>
          <div class="progress-bar-wrap mb-2">
            <div class="progress-bar-fill" style="width:${pct}%"></div>
          </div>
          <p class="text-sm text-gray-500">当前：<strong>${completed}</strong> / 100 条</p>
          <p class="text-xs text-gray-400 mt-2">共 ${total} 条记录，其中 ${total - completed} 条待回填</p>
        </div>`;
      return;
    }

    const s = Stats.compute();
    if (!s) { container.innerHTML = '<p class="text-gray-400">数据不足</p>'; return; }

    const level3 = s.levelStats['★★★'] || {};
    const level2 = s.levelStats['★★']  || {};

    container.innerHTML = `
      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="stat-card">
          <div class="stat-num">${(s.accuracy * 100).toFixed(1)}%</div>
          <div class="stat-label">总体命中率</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${s.total}</div>
          <div class="stat-label">已复盘场次</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${((level3.accuracy||0)*100).toFixed(1)}%</div>
          <div class="stat-label">★★★命中率</div>
        </div>
      </div>

      <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h3 class="text-sm font-semibold text-gray-700 mb-3">各等级命中率</h3>
        ${['★★★','★★'].map(lv => {
          const st = s.levelStats[lv] || {};
          return `<div class="flex items-center justify-between mb-2">
            <span class="text-sm text-gray-600">${lv} （${st.count||0}场）</span>
            <span class="text-sm font-bold ${(st.accuracy||0)>=0.5?'text-green-600':'text-red-500'}">${((st.accuracy||0)*100).toFixed(1)}%</span>
          </div>`;
        }).join('')}
      </div>

      <div class="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h3 class="text-sm font-semibold text-gray-700 mb-3">亚盘信号准确率</h3>
        ${Object.keys(s.signalStats).map(k => {
          const st = s.signalStats[k];
          const names = { s1:'S1 平博重心', s2:'S2 公司分歧', s3:'S3 水位差值', s4:'S4 盘口背离', s5:'S5 降盘异常' };
          return `<div class="flex items-center justify-between mb-2">
            <span class="text-sm text-gray-600">${names[k]||k} （${st.count}场）</span>
            <span class="text-sm font-bold ${st.accuracy>=0.5?'text-green-600':'text-red-500'}">${(st.accuracy*100).toFixed(1)}%</span>
          </div>`;
        }).join('')}
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
    list.innerHTML = bets.map(b => `
      <div class="finance-card mb-3">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs text-gray-400">${b.date || ''}</span>
          <span class="text-sm font-bold ${(b.profit||0)>=0?'text-green-600':'text-red-500'}">${(b.profit||0)>=0?'+':''}¥${(b.profit||0).toFixed(0)}</span>
        </div>
        <div class="text-sm text-gray-800">${b.match || '未知比赛'} · ${b.side || ''}</div>
        <div class="text-xs text-gray-500 mt-1">投入 ¥${b.stake||0} · 赔率 ${b.odds||0} · ${b.result==='win'?'中奖':'未中'}</div>
      </div>`).join('');
  }

  function initFinance() {
    $('btn-add-bet').addEventListener('click', openAddBet);
  }

  function openAddBet() {
    $('modal-title').textContent = '添加下注记录';
    $('modal-content').innerHTML = `
      <div class="space-y-3">
        <div>
          <label class="form-label">比赛描述</label>
          <input id="bet-match" type="text" class="form-input" placeholder="如：曼城 vs 阿森纳">
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="form-label">日期</label>
            <input id="bet-date" type="date" class="form-input" value="${new Date().toISOString().slice(0,10)}">
          </div>
          <div>
            <label class="form-label">下注方向</label>
            <select id="bet-side" class="form-input">
              <option>主胜</option><option>平局</option><option>客胜</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="form-label">投注金额 ¥</label>
            <input id="bet-stake" type="number" class="form-input" min="1" step="1">
          </div>
          <div>
            <label class="form-label">成交赔率</label>
            <input id="bet-odds" type="number" class="form-input" min="1" step="0.01">
          </div>
        </div>
        <div>
          <label class="form-label">结果</label>
          <div class="grid grid-cols-2 gap-3">
            <button id="bet-win" class="btn btn-ghost" onclick="document.getElementById('bet-win').classList.add('btn-primary');document.getElementById('bet-win').classList.remove('btn-ghost');document.getElementById('bet-lose').classList.remove('btn-primary');document.getElementById('bet-lose').classList.add('btn-ghost');window._betResult='win'">✓ 中奖</button>
            <button id="bet-lose" class="btn btn-ghost" onclick="document.getElementById('bet-lose').classList.add('btn-primary');document.getElementById('bet-lose').classList.remove('btn-ghost');document.getElementById('bet-win').classList.remove('btn-primary');document.getElementById('bet-win').classList.add('btn-ghost');window._betResult='lose'">✗ 未中</button>
          </div>
        </div>
        <button class="btn btn-primary w-full mt-2" onclick="App.saveBet()">保存</button>
      </div>`;
    window._betResult = null;
    openModal();
  }

  function saveBet() {
    const stake  = parseFloat($('bet-stake')?.value) || 0;
    const odds   = parseFloat($('bet-odds')?.value)  || 0;
    const result = window._betResult;
    if (!stake || !odds) { toast('请填写金额和赔率', 'error'); return; }
    if (!result) { toast('请选择中奖/未中', 'error'); return; }
    const profit = result === 'win' ? stake * (odds - 1) : -stake;
    Storage.Bets.add({
      date:   $('bet-date')?.value || '',
      match:  $('bet-match')?.value || '',
      side:   $('bet-side')?.value || '',
      stake, odds, result, profit,
    });
    closeModal();
    toast('已保存', 'success');
    renderFinance();
  }

  // ── 设置页渲染 ─────────────────────────────────────────────
  function renderSettings() {
    const saved = Storage.Settings.get();
    const ev   = saved.EV_THRESHOLD   || Config.EV_THRESHOLD;
    const gs   = saved.GAP_STRONG     || Config.GAP_STRONG;
    const gw   = saved.GAP_WEAK       || Config.GAP_WEAK;

    $('settings-content').innerHTML = `
      <div class="space-y-4">
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
    Storage.Settings.save({ EV_THRESHOLD: ev, GAP_STRONG: gs, GAP_WEAK: gw });
    // 更新运行时 Config
    Config.EV_THRESHOLD = ev; Config.GAP_STRONG = gs; Config.GAP_WEAK = gw;
    toast('设置已保存', 'success');
  }

  function resetSettings() {
    Storage.Settings.save({});
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
    deleteRecord,
    saveBet,
    saveSettings,
    resetSettings,
    exportData,
    clearData,
  };

})();
