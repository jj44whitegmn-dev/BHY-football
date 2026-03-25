/**
 * ui.js — 调度层
 * 职责：调用 engine + storage，处理所有跨模块协调，渲染页面。
 * 所有用户可见文字使用中文。
 */

const App = (() => {

  // ── 应用状态 ────────────────────────────────────────────────────
  let currentPage = 'analysis';
  let parlaySelections = [];
  let charts = {};
  let reviewView = 'system'; // 'system' | 'actual'

  // ── 常量映射 ────────────────────────────────────────────────────
  const SIDE_CN   = { home: '主胜', draw: '平局', away: '客胜' };
  const GRADE_COLOR = { '甲级': 'text-green-400', '乙级': 'text-yellow-400', '丙级': 'text-slate-500' };
  const RISK_COLOR  = { '低': 'text-green-400', '中': 'text-yellow-400', '高': 'text-red-400' };
  const MARKET_COLOR = {
    '主队一致强化': 'bg-green-900 text-green-300',
    '客队一致强化': 'bg-red-900 text-red-300',
    '平局增强':     'bg-yellow-900 text-yellow-300',
    '热门过热':     'bg-orange-900 text-orange-300',
    '盘口赔率不一致':'bg-purple-900 text-purple-300',
    '试探失败':     'bg-pink-900 text-pink-300',
    '临场确认':     'bg-cyan-900 text-cyan-300',
    '高噪音结构':   'bg-slate-700 text-slate-400',
    '低价值不碰':   'bg-slate-800 text-slate-500',
  };

  // ── Toast ────────────────────────────────────────────────────────
  function toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // ── 导航 ─────────────────────────────────────────────────────────
  function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`page-${name}`).classList.add('active');
    document.getElementById(`nav-${name}`).classList.add('active');
    currentPage = name;
    const renders = {
      analysis: renderAnalysisPage,
      parlay:   renderParlayPage,
      records:  renderRecordsPage,
      finance:  renderFinancePage,
      review:   renderReviewPage,
    };
    renders[name]?.();
  }

  // ── 工具 ─────────────────────────────────────────────────────────
  function pct(v)    { return v != null ? (v * 100).toFixed(1) + '%' : '--'; }
  function fmt2(v)   { return v != null ? (+v).toFixed(2) : '--'; }
  function fmtSign(v){ return v != null ? (v >= 0 ? '+' : '') + v.toFixed(2) : '--'; }

  function marketBadge(type) {
    const cls = MARKET_COLOR[type] || 'bg-slate-700 text-slate-400';
    return `<span class="text-xs px-2 py-0.5 rounded-full font-semibold ${cls}">${type || '未分析'}</span>`;
  }

  function gradeBadge(grade) {
    const map = { '甲级': 'badge-high', '乙级': 'badge-medium', '丙级': 'badge-low' };
    return `<span class="${map[grade] || 'badge-low'} text-xs px-2 py-0.5 rounded-full font-semibold">${grade || '丙级'}</span>`;
  }

  function riskBadge(level) {
    const map = { '低': 'badge-won', '中': 'badge-medium', '高': 'badge-lost' };
    return `<span class="${map[level] || 'badge-low'} text-xs px-2 py-0.5 rounded-full font-semibold">风险${level || '?'}</span>`;
  }

  function emptyState(title, sub) {
    return `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
      </svg>
      <div><p class="font-semibold text-slate-300">${title}</p><p>${sub}</p></div>
    </div>`;
  }

  function calcResult(homeGoals, awayGoals) {
    if (homeGoals > awayGoals) return '主胜';
    if (homeGoals < awayGoals) return '客胜';
    return '平局';
  }

  // ── 分析页 ──────────────────────────────────────────────────────
  function renderAnalysisPage() {
    const all      = Storage.Matches.all();
    const pending  = all.filter(m => !m.result_1x2);
    const done     = all.filter(m => !!m.result_1x2).slice(0, 30);
    const cont     = document.getElementById('analysis-content');

    if (!all.length) {
      cont.innerHTML = emptyState('暂无比赛记录', '点击右下角 ＋ 添加第一场比赛');
      return;
    }

    let html = '';
    if (pending.length) {
      html += `<div class="section-header">待比赛（${pending.length}场）</div>`;
      html += pending.map(m => matchCard(m)).join('');
    }
    if (done.length) {
      html += `<div class="section-header">已完成</div>`;
      html += done.map(m => matchCard(m)).join('');
    }
    cont.innerHTML = html;
    bindAnalysisEvents(cont);
  }

  function matchCard(m) {
    const a = m.analysis || {};
    const isPending = !m.result_1x2;
    const grade   = a.confidence_grade || '丙级';
    const market  = a.market_type_primary || '';
    const risk    = a.risk_level || '';
    const side    = a.suggested_side || '';
    const bet     = a.whether_to_bet;

    // 得分展示
    const hs = a.home_score ?? '--', ds = a.draw_score ?? '--', as = a.away_score ?? '--';
    const scoreColor = s => s > 0 ? 'text-green-400' : s < 0 ? 'text-red-400' : 'text-slate-400';

    // 结果展示
    let resultHtml = '';
    if (!isPending) {
      const correct = a.suggested_side && a.suggested_side === m.result_1x2;
      const sysColor = correct ? 'text-green-400' : 'text-red-400';
      resultHtml = `
      <div class="flex items-center justify-between pt-2 border-t border-slate-700 mt-2 text-xs">
        <span class="text-slate-400">实际：${m.result_home_goals}-${m.result_away_goals}（${m.result_1x2}）</span>
        ${a.suggested_side ? `<span class="${sysColor} font-semibold">系统${correct?'✓ 正确':'✗ 错误'}</span>` : ''}
        ${m.user_bet_side ? `<span class="${m.user_bet_side===m.result_1x2?'text-green-400':'text-red-400'}">
          实投：${m.user_bet_side} ${fmtSign(m.profit_loss)}元</span>` : ''}
      </div>`;
    } else {
      resultHtml = `
      <div class="flex gap-2 mt-3">
        <button class="btn btn-sm btn-ghost flex-1 btn-enter-result" data-id="${m.id}">录入结果</button>
        <button class="btn btn-sm btn-ghost btn-add-parlay" data-id="${m.id}" title="加入串关">＋串关</button>
      </div>`;
    }

    const betHint = bet
      ? `<span class="text-green-400 text-xs font-semibold">● 建议参与</span>`
      : (side ? `<span class="text-slate-500 text-xs">倾向${side}，不建议下注</span>` : '');

    return `
    <div class="card match-card" data-id="${m.id}">
      <div class="flex justify-between items-start mb-2">
        <div class="text-xs text-slate-400">${m.competition || ''} · ${m.match_date || ''}</div>
        <div class="flex items-center gap-1 flex-wrap justify-end">
          ${marketBadge(market)}
          ${isPending ? gradeBadge(grade) : ''}
          <button class="text-slate-500 hover:text-red-400 text-lg leading-none btn-delete-match ml-1" data-id="${m.id}">×</button>
        </div>
      </div>
      <div class="flex items-center justify-between mb-2">
        <span class="font-semibold">${m.home_team || '主队'}</span>
        <span class="text-slate-500 text-sm">vs</span>
        <span class="font-semibold">${m.away_team || '客队'}</span>
      </div>
      ${a.home_score != null ? `
      <div class="flex justify-between text-sm mb-1">
        <span class="${scoreColor(a.home_score)}">主胜 ${hs > 0 ? '+' : ''}${hs}</span>
        <span class="${scoreColor(a.draw_score)}">平局 ${ds > 0 ? '+' : ''}${ds}</span>
        <span class="${scoreColor(a.away_score)}">客胜 ${as > 0 ? '+' : ''}${as}</span>
      </div>` : ''}
      <div class="flex items-center justify-between text-xs mt-1">
        <div class="flex items-center gap-2">
          ${risk ? riskBadge(risk) : ''}
          ${betHint}
        </div>
        ${isPending ? `<button class="text-slate-400 hover:text-sky-400 text-xs btn-show-detail" data-id="${m.id}">详情 ›</button>` : ''}
      </div>
      ${resultHtml}
    </div>`;
  }

  function bindAnalysisEvents(cont) {
    cont.querySelectorAll('.btn-enter-result').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); showEnterResultModal(btn.dataset.id); });
    });
    cont.querySelectorAll('.btn-delete-match').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (confirm('确认删除此比赛记录？')) {
          Storage.Matches.delete(btn.dataset.id);
          renderAnalysisPage();
          toast('已删除', 'info');
        }
      });
    });
    cont.querySelectorAll('.btn-add-parlay').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); addToParlayFromCard(btn.dataset.id); });
    });
    cont.querySelectorAll('.btn-show-detail').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); showAnalysisDetail(btn.dataset.id); });
    });
  }

  // ── 分析详情 Modal ──────────────────────────────────────────────
  function showAnalysisDetail(matchId) {
    const m = Storage.Matches.get(matchId);
    if (!m) return;
    const a = m.analysis;
    if (!a) { toast('此比赛暂无分析结果', 'info'); return; }

    // 概率表格
    const probRow = (label, nv) => nv
      ? `<tr><td class="text-slate-400 pr-3">${label}</td>
         <td class="text-green-400">${pct(nv.home)}</td>
         <td class="text-yellow-400">${pct(nv.draw)}</td>
         <td class="text-red-400">${pct(nv.away)}</td></tr>` : '';

    // 规则命中
    const ruleRows = (a.rules_hit || []).map(r => `
      <div class="text-xs border-b border-slate-700 py-1.5">
        <div class="flex justify-between">
          <span class="text-slate-300 font-semibold">[${r.rule_id}] ${r.rule_name}</span>
          <span class="${r.score_delta > 0 ? 'text-green-400' : r.score_delta < 0 ? 'text-red-400' : 'text-slate-400'} font-bold">
            ${r.side}：${r.score_delta > 0 ? '+' : ''}${r.score_delta}
          </span>
        </div>
        <div class="text-slate-500 mt-0.5">${r.reason}</div>
      </div>`).join('');

    // 亚盘解读
    const ahText = a.ah_change?.interpretation || '无亚盘数据';

    // 质量分扣减
    const qRows = (a.quality_breakdown || []).map(q =>
      `<div class="text-xs text-slate-400 flex justify-between">
        <span>${q.source}</span><span class="text-red-400">${q.delta}</span>
       </div>`).join('');

    // 风险分组成
    const rRows = (a.risk_breakdown || []).map(r =>
      `<div class="text-xs text-slate-400 flex justify-between">
        <span>${r.source}</span><span class="text-orange-400">+${r.delta}</span>
       </div>`).join('');

    // 副标签
    const secTags = (a.market_type_secondary || []).map(t =>
      `<span class="tag">${t}</span>`).join('');

    const html = `
    <div class="modal-handle"></div>
    <h2 class="text-base font-bold mb-1">分析详情</h2>
    <p class="text-slate-400 text-sm mb-3">${m.home_team} vs ${m.away_team} · ${m.match_date}</p>

    <div class="flex flex-wrap gap-1 mb-3">
      ${marketBadge(a.market_type_primary)}
      ${gradeBadge(a.confidence_grade)}
      ${riskBadge(a.risk_level)}
    </div>
    ${secTags ? `<div class="tag-scroll mb-3">${secTags}</div>` : ''}

    <div class="section-header">去水概率对比</div>
    <div class="card mb-3 overflow-x-auto">
      <table class="w-full text-sm">
        <thead><tr class="text-slate-500 text-xs">
          <td></td><td class="text-green-500">主胜</td><td class="text-yellow-500">平局</td><td class="text-red-500">客胜</td>
        </tr></thead>
        <tbody>
          ${probRow('体彩', a.ctf_nv)}
          ${probRow('欧赔初', a.eu_open_nv)}
          ${probRow('欧赔终', a.eu_close_nv)}
        </tbody>
      </table>
    </div>

    ${a.value_hint_side ? `
    <div class="card mb-3 text-sm">
      <span class="text-slate-400">体彩价值提示：</span>
      <span class="text-cyan-400 font-semibold">${a.value_hint_side}赔率偏甜（${a.value_hint_strength}）</span>
      <div class="text-xs text-slate-500 mt-1">体彩去水概率低于欧赔，体彩赔率相对更高</div>
    </div>` : ''}

    <div class="section-header">亚盘解读</div>
    <div class="card mb-3 text-sm text-slate-300">${ahText}</div>

    ${a.ctf_hdc_analysis?.coverRisk ? `
    <div class="card mb-3 border-orange-800 text-sm">
      <span class="text-orange-400 font-semibold">⚠ 赢球不穿盘风险</span>
      <div class="text-slate-400 text-xs mt-1">${a.ctf_hdc_analysis.coverRiskDetail}</div>
    </div>` : ''}

    <div class="section-header">方向得分</div>
    <div class="card mb-3">
      <div class="flex justify-around text-center">
        <div><div class="text-xl font-bold ${a.home_score>0?'text-green-400':a.home_score<0?'text-red-400':'text-slate-400'}">${a.home_score??'--'}</div><div class="text-xs text-slate-500 mt-1">主胜</div></div>
        <div><div class="text-xl font-bold ${a.draw_score>0?'text-green-400':a.draw_score<0?'text-red-400':'text-slate-400'}">${a.draw_score??'--'}</div><div class="text-xs text-slate-500 mt-1">平局</div></div>
        <div><div class="text-xl font-bold ${a.away_score>0?'text-green-400':a.away_score<0?'text-red-400':'text-slate-400'}">${a.away_score??'--'}</div><div class="text-xs text-slate-500 mt-1">客胜</div></div>
      </div>
    </div>

    <div class="section-header">质量分（${a.quality_score ?? '--'}分）</div>
    ${qRows ? `<div class="card mb-3">${qRows}</div>` : ''}

    <div class="section-header">风险分（${a.risk_score ?? '--'}，${a.risk_level ?? '--'}）</div>
    ${rRows ? `<div class="card mb-3">${rRows}</div>` : ''}

    <div class="section-header">命中规则（${(a.rules_hit||[]).length} 条）</div>
    <div class="card mb-3">${ruleRows || '<p class="text-slate-500 text-xs text-center py-2">无规则命中</p>'}</div>

    <div class="section-header">决策建议</div>
    <div class="card mb-4 text-sm">
      <div class="mb-1">
        <span class="text-slate-400">方向倾向：</span>
        <span class="font-semibold">${a.suggested_side || '无明确方向'}</span>
        ${a.lean_reason ? `<span class="text-slate-500 text-xs ml-2">${a.lean_reason}</span>` : ''}
      </div>
      <div class="mb-1">
        <span class="text-slate-400">是否建议下注：</span>
        <span class="font-semibold ${a.whether_to_bet?'text-green-400':'text-slate-500'}">${a.whether_to_bet?'建议参与':'不建议'}</span>
      </div>
      ${!a.whether_to_bet && a.no_bet_reason
        ? `<div class="text-xs text-slate-400 mt-1">原因：${a.no_bet_reason}</div>` : ''}
      ${a.whether_to_bet && a.stake_suggestion
        ? `<div class="text-xs text-green-400 mt-1">建议仓位：¥${a.stake_suggestion}</div>` : ''}
      <div class="text-xs text-slate-500 mt-2">${a.suggestion_reason || ''}</div>
    </div>

    <button class="btn btn-ghost btn-full" onclick="closeModal()">关闭</button>`;

    openModal(html);
  }

  // ── 录入比赛 Modal ──────────────────────────────────────────────
  function showAddMatchModal() {
    const ac = Storage.Autocomplete.get();
    const today = new Date().toISOString().slice(0, 10);
    const teamDatalist = ac.teams.map(t => `<option value="${t}">`).join('');
    const compDatalist = ac.competitions.map(c => `<option value="${c}">`).join('');

    const ahOptions = AH_PATH_LABELS.map((l, i) =>
      `<option value="${l}">${AH_PATH_LABEL_NAMES[i]}</option>`).join('');
    const euOptions = EU_PATH_LABELS.map((l, i) =>
      `<option value="${l}">${EU_PATH_LABEL_NAMES[i]}</option>`).join('');

    const html = `
    <datalist id="dl-teams">${teamDatalist}</datalist>
    <datalist id="dl-comp">${compDatalist}</datalist>
    <div class="modal-handle"></div>
    <h2 class="text-lg font-bold mb-4">录入新比赛</h2>
    <form id="add-match-form" autocomplete="off">

      <div class="section-header">基本信息</div>
      <div class="form-grid-2 mb-3">
        <div><label class="label">主队</label>
          <input class="input" id="f-home" list="dl-teams" placeholder="主队名称" required></div>
        <div><label class="label">客队</label>
          <input class="input" id="f-away" list="dl-teams" placeholder="客队名称" required></div>
      </div>
      <div class="form-grid-2 mb-3">
        <div><label class="label">比赛日期</label>
          <input type="date" class="input" id="f-date" value="${today}" required></div>
        <div><label class="label">赛事名称</label>
          <input class="input" id="f-comp" list="dl-comp" placeholder="如：英超"></div>
      </div>

      <div class="section-header">体彩赔率（必填）</div>
      <div class="mb-1 text-xs text-slate-500">胜平负赔率</div>
      <div class="odds-grid mb-2">
        <div><label class="label">主胜</label><input type="number" step="0.01" min="1.01" class="input" id="f-ctf-h" placeholder="如 2.10" required></div>
        <div><label class="label">平局</label><input type="number" step="0.01" min="1.01" class="input" id="f-ctf-d" placeholder="如 3.20" required></div>
        <div><label class="label">客胜</label><input type="number" step="0.01" min="1.01" class="input" id="f-ctf-a" placeholder="如 3.40" required></div>
      </div>
      <div class="mb-1 text-xs text-slate-500">让球胜平负（盘口：负数=主让，正数=客让）</div>
      <div class="mb-2">
        <label class="label">让球盘口</label>
        <input type="number" step="0.25" class="input mb-2" id="f-ctf-hdc" placeholder="如 -1 表示主让一球" required>
      </div>
      <div class="odds-grid mb-3">
        <div><label class="label">主胜</label><input type="number" step="0.01" min="1.01" class="input" id="f-ctf-hh" placeholder="" required></div>
        <div><label class="label">平局</label><input type="number" step="0.01" min="1.01" class="input" id="f-ctf-hd" placeholder="" required></div>
        <div><label class="label">客胜</label><input type="number" step="0.01" min="1.01" class="input" id="f-ctf-ha" placeholder="" required></div>
      </div>

      <div class="section-header">欧赔（必填）</div>
      <div class="mb-1 text-xs text-slate-500">初盘赔率</div>
      <div class="odds-grid mb-2">
        <div><label class="label">主胜</label><input type="number" step="0.01" min="1.01" class="input" id="f-eu-oh" placeholder="" required></div>
        <div><label class="label">平局</label><input type="number" step="0.01" min="1.01" class="input" id="f-eu-od" placeholder="" required></div>
        <div><label class="label">客胜</label><input type="number" step="0.01" min="1.01" class="input" id="f-eu-oa" placeholder="" required></div>
      </div>
      <div class="mb-1 text-xs text-slate-500">终盘赔率</div>
      <div class="odds-grid mb-3">
        <div><label class="label">主胜</label><input type="number" step="0.01" min="1.01" class="input" id="f-eu-ch" placeholder="" required></div>
        <div><label class="label">平局</label><input type="number" step="0.01" min="1.01" class="input" id="f-eu-cd" placeholder="" required></div>
        <div><label class="label">客胜</label><input type="number" step="0.01" min="1.01" class="input" id="f-eu-ca" placeholder="" required></div>
      </div>

      <div class="section-header">亚盘（初盘+终盘必填）</div>
      <div class="mb-1 text-xs text-slate-500">初盘（负数=主让）</div>
      <div class="form-grid-3 mb-2">
        <div><label class="label">盘口</label><input type="number" step="0.25" class="input" id="f-ah-ol" placeholder="-0.5" required></div>
        <div><label class="label">主队水位</label><input type="number" step="0.01" min="1.01" class="input" id="f-ah-oh" placeholder="0.90" required></div>
        <div><label class="label">客队水位</label><input type="number" step="0.01" min="1.01" class="input" id="f-ah-oa" placeholder="0.90" required></div>
      </div>
      <div class="mb-1 text-xs text-slate-500">中盘（可选，有数据更准）</div>
      <div class="form-grid-3 mb-2">
        <div><label class="label">盘口</label><input type="number" step="0.25" class="input" id="f-ah-ml" placeholder="可选"></div>
        <div><label class="label">主队</label><input type="number" step="0.01" min="1.01" class="input" id="f-ah-mh" placeholder="可选"></div>
        <div><label class="label">客队</label><input type="number" step="0.01" min="1.01" class="input" id="f-ah-ma" placeholder="可选"></div>
      </div>
      <div class="mb-1 text-xs text-slate-500">终盘</div>
      <div class="form-grid-3 mb-3">
        <div><label class="label">盘口</label><input type="number" step="0.25" class="input" id="f-ah-cl" placeholder="-1" required></div>
        <div><label class="label">主队水位</label><input type="number" step="0.01" min="1.01" class="input" id="f-ah-ch" placeholder="" required></div>
        <div><label class="label">客队水位</label><input type="number" step="0.01" min="1.01" class="input" id="f-ah-ca" placeholder="" required></div>
      </div>

      <div class="section-header">路径标签（无中盘时建议填写）</div>
      <div class="form-grid-2 mb-3">
        <div>
          <label class="label">亚盘路径</label>
          <select class="input" id="f-ah-path">
            <option value="">不填（有中盘数据）</option>
            ${ahOptions}
          </select>
        </div>
        <div>
          <label class="label">欧赔路径</label>
          <select class="input" id="f-eu-path">
            <option value="">不填</option>
            ${euOptions}
          </select>
        </div>
      </div>

      <details class="mb-4">
        <summary class="text-sm text-slate-400 cursor-pointer select-none py-2">▸ 近五场辅助数据（可选，不影响主分析）</summary>
        <div class="pt-3">
          <div class="mb-1 text-xs text-slate-500">主队近5场：胜/平/负/进球/失球</div>
          <div class="form-grid-3 mb-2 gap-1">
            <input type="number" class="input text-center" id="f-hw" min="0" max="5" placeholder="胜">
            <input type="number" class="input text-center" id="f-hd" min="0" max="5" placeholder="平">
            <input type="number" class="input text-center" id="f-hl" min="0" max="5" placeholder="负">
          </div>
          <div class="form-grid-2 mb-3 gap-1">
            <input type="number" class="input" id="f-hgf" min="0" max="30" placeholder="进球">
            <input type="number" class="input" id="f-hga" min="0" max="30" placeholder="失球">
          </div>
          <div class="mb-1 text-xs text-slate-500">客队近5场：胜/平/负/进球/失球</div>
          <div class="form-grid-3 mb-2 gap-1">
            <input type="number" class="input text-center" id="f-aw" min="0" max="5" placeholder="胜">
            <input type="number" class="input text-center" id="f-ad" min="0" max="5" placeholder="平">
            <input type="number" class="input text-center" id="f-al" min="0" max="5" placeholder="负">
          </div>
          <div class="form-grid-2 gap-1">
            <input type="number" class="input" id="f-agf" min="0" max="30" placeholder="进球">
            <input type="number" class="input" id="f-aga" min="0" max="30" placeholder="失球">
          </div>
        </div>
      </details>

      <button type="submit" class="btn btn-primary btn-full">运行分析并保存</button>
    </form>`;

    openModal(html, () => {
      document.getElementById('add-match-form').addEventListener('submit', submitAddMatch);
    });
  }

  function gv(id) { return document.getElementById(id)?.value || ''; }
  function gn(id) { const v = parseFloat(gv(id)); return isNaN(v) ? null : v; }
  function gi(id) { const v = parseInt(gv(id)); return isNaN(v) ? null : v; }

  function submitAddMatch(e) {
    e.preventDefault();
    const homeTeam = gv('f-home').trim();
    const awayTeam = gv('f-away').trim();
    if (!homeTeam || !awayTeam) { toast('请填写主队和客队名称', 'error'); return; }
    if (homeTeam === awayTeam)  { toast('主队和客队不能相同', 'error'); return; }

    const rawMatch = {
      match_date:  gv('f-date'),
      competition: gv('f-comp').trim(),
      home_team:   homeTeam,
      away_team:   awayTeam,
      // 体彩
      ctf_home_odds: gn('f-ctf-h'), ctf_draw_odds: gn('f-ctf-d'), ctf_away_odds: gn('f-ctf-a'),
      ctf_hdc_line:  gn('f-ctf-hdc'),
      ctf_hdc_home_odds: gn('f-ctf-hh'), ctf_hdc_draw_odds: gn('f-ctf-hd'), ctf_hdc_away_odds: gn('f-ctf-ha'),
      // 欧赔
      eu_open_home: gn('f-eu-oh'), eu_open_draw: gn('f-eu-od'), eu_open_away: gn('f-eu-oa'),
      eu_close_home: gn('f-eu-ch'), eu_close_draw: gn('f-eu-cd'), eu_close_away: gn('f-eu-ca'),
      // 亚盘
      ah_open_line: gn('f-ah-ol'), ah_open_home_odds: gn('f-ah-oh'), ah_open_away_odds: gn('f-ah-oa'),
      ah_mid_line:  gn('f-ah-ml'), ah_mid_home_odds:  gn('f-ah-mh'), ah_mid_away_odds:  gn('f-ah-ma'),
      ah_close_line: gn('f-ah-cl'), ah_close_home_odds: gn('f-ah-ch'), ah_close_away_odds: gn('f-ah-ca'),
      // 路径标签
      ah_path_label: gv('f-ah-path') || null,
      eu_path_label: gv('f-eu-path') || null,
      // 近五场（可选）
      home_recent_w: gi('f-hw'), home_recent_d: gi('f-hd'), home_recent_l: gi('f-hl'),
      home_recent_gf: gi('f-hgf'), home_recent_ga: gi('f-hga'),
      away_recent_w: gi('f-aw'), away_recent_d: gi('f-ad'), away_recent_l: gi('f-al'),
      away_recent_gf: gi('f-agf'), away_recent_ga: gi('f-aga'),
      // 大小球预留
      ou_line: null, ou_over_odds: null, ou_under_odds: null,
    };

    // ui.js 调度：先 engine 分析，再 storage 保存
    const analysis = Engine.analyze(rawMatch);
    const match = { ...rawMatch, analysis };
    Storage.Matches.save(match);

    closeModal();
    renderAnalysisPage();
    toast(`分析完成：${analysis.market_type_primary}，${analysis.confidence_grade}`, 'success');
    showAnalysisDetail(match.id);
  }

  // ── 录入结果 Modal ──────────────────────────────────────────────
  function showEnterResultModal(matchId) {
    const m = Storage.Matches.get(matchId);
    if (!m) return;
    const a = m.analysis || {};
    const sugSide = a.suggested_side || null;

    const html = `
    <div class="modal-handle"></div>
    <h2 class="text-lg font-bold mb-1">录入比赛结果</h2>
    <p class="text-slate-400 text-sm mb-4">${m.home_team} vs ${m.away_team} · ${m.match_date}</p>
    ${sugSide ? `<div class="card mb-3 text-sm"><span class="text-slate-400">系统倾向：</span>
      <span class="font-semibold">${sugSide}</span>
      <span class="text-xs text-slate-500 ml-2">${a.whether_to_bet?'建议下注':'不建议下注'}</span>
    </div>` : ''}
    <div class="form-grid-2 mb-4">
      <div><label class="label">${m.home_team} 进球</label>
        <input type="number" class="input text-center text-2xl font-bold" id="r-h" min="0" max="20" value="0"></div>
      <div><label class="label">${m.away_team} 进球</label>
        <input type="number" class="input text-center text-2xl font-bold" id="r-a" min="0" max="20" value="0"></div>
    </div>
    <details class="mb-4">
      <summary class="text-sm text-slate-400 cursor-pointer select-none py-2">▸ 记录实际下注（可选）</summary>
      <div class="pt-3">
        <div class="mb-3">
          <label class="label">实际下注方向</label>
          <div class="flex gap-2">
            ${['主胜','平局','客胜'].map(s => `<button type="button" class="btn btn-ghost flex-1 side-sel-btn" data-side="${s}">${s}</button>`).join('')}
          </div>
          <input type="hidden" id="r-bet-side" value="">
        </div>
        <div class="form-grid-2 mb-2">
          <div><label class="label">实际赔率</label>
            <input type="number" step="0.01" min="1.01" class="input" id="r-odds" placeholder="如 2.10"></div>
          <div><label class="label">实际仓位（元）</label>
            <input type="number" min="0" class="input" id="r-stake" placeholder="如 10"></div>
        </div>
      </div>
    </details>
    <button class="btn btn-primary btn-full" id="confirm-result-btn">确认录入</button>`;

    openModal(html, () => {
      // 方向选择高亮
      document.querySelectorAll('.side-sel-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.side-sel-btn').forEach(b => b.classList.remove('border-sky-500','text-sky-400'));
          btn.classList.add('border-sky-500','text-sky-400');
          document.getElementById('r-bet-side').value = btn.dataset.side;
        });
      });
      document.getElementById('confirm-result-btn').addEventListener('click', () => {
        const homeGoals = parseInt(document.getElementById('r-h').value);
        const awayGoals = parseInt(document.getElementById('r-a').value);
        if (isNaN(homeGoals) || isNaN(awayGoals)) { toast('请输入有效比分', 'error'); return; }
        const result1x2 = calcResult(homeGoals, awayGoals);
        const betSide   = document.getElementById('r-bet-side').value || null;
        const betOdds   = gn('r-odds');
        const betStake  = gn('r-stake');
        const profitLoss = betSide && betOdds && betStake
          ? (betSide === result1x2 ? betStake * (betOdds - 1) : -betStake)
          : null;

        // ui.js 调度：storage 只保存，不调用 engine
        Storage.Matches.setResult(matchId, homeGoals, awayGoals, result1x2, betSide, betOdds, betStake, profitLoss);

        // 自动尝试结算关联串关
        Storage.Bets.all().forEach(b => {
          if (b.status === '待结算' && b.selections?.some(s => s.matchId === matchId)) {
            trySettleBet(b.id);
          }
        });

        closeModal();
        renderAnalysisPage();
        const sysCorrect = (m.analysis?.suggested_side === result1x2);
        const sysHint = m.analysis?.suggested_side
          ? `系统预测${sysCorrect?'✓ 正确':'✗ 错误'}` : '';
        toast(`结果已录入：${result1x2}${sysHint ? '，' + sysHint : ''}`, sysCorrect ? 'success' : 'info');
      });
    });
  }

  // ── 串关 Page ────────────────────────────────────────────────────
  function renderParlayPage() {
    const pending = Storage.Matches.pending();
    const cont = document.getElementById('parlay-content');
    if (!pending.length) {
      cont.innerHTML = emptyState('暂无待比赛记录', '先在分析页添加比赛');
      updateParlayBar();
      return;
    }
    let html = `<p class="text-sm text-slate-400 mb-3">勾选比赛并输入赔率加入串关</p>`;
    html += pending.map(m => parlayMatchCard(m)).join('');
    cont.innerHTML = html;
    bindParlayEvents(cont);
    updateParlayBar();
  }

  function parlayMatchCard(m) {
    const a = m.analysis || {};
    const sel = parlaySelections.find(s => s.matchId === m.id);
    const isSelected = !!sel;
    const recSide = a.suggested_side;
    const recOdds = recSide === '主胜' ? m.eu_close_home : recSide === '客胜' ? m.eu_close_away : m.eu_close_draw;

    return `
    <div class="card parlay-card ${isSelected ? 'border-sky-500' : ''}" data-id="${m.id}">
      <div class="flex items-start gap-3">
        <div class="match-checkbox ${isSelected ? 'checked' : ''} parlay-toggle mt-1" data-id="${m.id}">
          ${isSelected ? '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" style="width:14px;height:14px"><path d="m5 13 4 4L19 7"/></svg>' : ''}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-slate-400 mb-0.5">${m.competition || ''} · ${m.match_date || ''}</div>
          <div class="font-semibold text-sm">${m.home_team} vs ${m.away_team}</div>
          <div class="flex items-center gap-2 mt-1">
            ${marketBadge(a.market_type_primary)}
            ${recSide ? `<span class="text-xs text-slate-400">倾向：<span class="font-semibold">${recSide}</span></span>` : ''}
          </div>
          ${isSelected ? `<div class="text-xs text-cyan-400 mt-1">已选：${sel.selection} @ ${sel.odds}</div>` : ''}
        </div>
      </div>
      ${!isSelected ? `
      <div class="mt-3 pt-3 border-t border-slate-700">
        <div class="flex gap-2 mb-2">
          ${['主胜','平局','客胜'].map(s =>
            `<button class="btn btn-sm btn-ghost flex-1 parlay-side-btn ${recSide===s?'border-sky-500 text-sky-400':''}"
              data-match="${m.id}" data-sel="${s}">${s}</button>`).join('')}
        </div>
        <div class="form-grid-2">
          <div><label class="label">赔率</label>
            <input type="number" step="0.01" min="1.01" class="input parlay-odds" data-id="${m.id}"
              placeholder="${recOdds ? recOdds : '输入赔率'}"></div>
          <div style="display:flex;align-items:flex-end">
            <button class="btn btn-primary btn-sm btn-full parlay-add-btn" data-id="${m.id}">加入</button>
          </div>
        </div>
      </div>` : ''}
    </div>`;
  }

  function bindParlayEvents(cont) {
    cont.querySelectorAll('.parlay-toggle').forEach(el => {
      el.addEventListener('click', () => {
        parlaySelections = parlaySelections.filter(s => s.matchId !== el.dataset.id);
        renderParlayPage();
      });
    });
    cont.querySelectorAll('.parlay-side-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        cont.querySelectorAll(`.parlay-side-btn[data-match="${btn.dataset.match}"]`).forEach(b =>
          b.classList.remove('border-sky-500','text-sky-400'));
        btn.classList.add('border-sky-500','text-sky-400');
      });
    });
    cont.querySelectorAll('.parlay-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const matchId = btn.dataset.id;
        const card = btn.closest('.parlay-card');
        const selBtn = card.querySelector('.parlay-side-btn.border-sky-500');
        const oddsInput = card.querySelector('.parlay-odds');
        if (!selBtn) { toast('请先选择结果方向', 'error'); return; }
        const odds = parseFloat(oddsInput?.value);
        if (!odds || odds < 1.01) { toast('请输入有效赔率', 'error'); return; }
        const m = Storage.Matches.get(matchId);
        parlaySelections = parlaySelections.filter(s => s.matchId !== matchId);
        parlaySelections.push({
          matchId, selection: selBtn.dataset.sel, odds,
          label: `${m.home_team} vs ${m.away_team}（${selBtn.dataset.sel}）`,
        });
        renderParlayPage();
        toast('已加入串关', 'success');
      });
    });
  }

  function addToParlayFromCard(matchId) {
    const m = Storage.Matches.get(matchId);
    const a = m?.analysis;
    if (!m) return;
    const rec = a?.suggested_side;
    const odds = rec === '主胜' ? m.eu_close_home : rec === '客胜' ? m.eu_close_away : m.eu_close_draw;
    if (!odds) { toast('无欧赔数据，请在串关页手动输入赔率', 'info'); showPage('parlay'); return; }
    parlaySelections = parlaySelections.filter(s => s.matchId !== matchId);
    parlaySelections.push({
      matchId, selection: rec, odds,
      label: `${m.home_team} vs ${m.away_team}（${rec}）`,
    });
    toast(`已加入串关：${rec} @ ${odds}`, 'success');
    updateParlayBar();
  }

  function updateParlayBar() {
    const bar = document.getElementById('parlay-bar');
    if (parlaySelections.length < 2) { bar.classList.remove('visible'); return; }
    bar.classList.add('visible');
    const tOdds = Parlay.totalOdds(parlaySelections);
    bar.innerHTML = `
      <div><span class="text-sm font-bold">${parlaySelections.length}串1</span>
        <span class="text-xs text-slate-300 ml-2">总赔率 ${tOdds}</span></div>
      <div class="flex gap-2">
        <button class="btn btn-sm btn-ghost" id="clear-parlay-btn">清空</button>
        <button class="btn btn-sm btn-primary" id="confirm-parlay-btn">确认投注</button>
      </div>`;
    document.getElementById('clear-parlay-btn').addEventListener('click', () => {
      parlaySelections = []; updateParlayBar();
      if (currentPage === 'parlay') renderParlayPage();
    });
    document.getElementById('confirm-parlay-btn').addEventListener('click', showConfirmBetModal);
  }

  function showConfirmBetModal() {
    if (parlaySelections.length < 2) { toast('至少选择2场', 'error'); return; }
    const tOdds = Parlay.totalOdds(parlaySelections);
    const allMatches = Storage.Matches.all();
    const winP = Parlay.winProbability(parlaySelections, allMatches);

    const html = `
    <div class="modal-handle"></div>
    <h2 class="text-lg font-bold mb-3">确认串关投注</h2>
    <div class="card mb-3">
      ${parlaySelections.map(s => `
        <div class="flex justify-between text-sm py-1 border-b border-slate-700 last:border-0">
          <span class="text-slate-300 truncate flex-1">${s.label}</span>
          <span class="text-cyan-400 font-semibold ml-3">@ ${s.odds}</span>
        </div>`).join('')}
    </div>
    <div class="card mb-3 text-sm">
      <div class="flex justify-between mb-1"><span class="text-slate-400">串关类型</span><span>${parlaySelections.length}串1</span></div>
      <div class="flex justify-between mb-1"><span class="text-slate-400">总赔率</span><span class="text-cyan-400 font-semibold">${tOdds}</span></div>
      <div class="flex justify-between"><span class="text-slate-400">理论中奖率</span><span>${pct(winP)}</span></div>
    </div>
    <div class="mb-4">
      <label class="label">投注金额（元，最低2元）</label>
      <input type="number" class="input text-center text-xl font-bold" id="bet-stake" min="2" step="1" value="2">
      <div id="bet-preview" class="text-center text-sm text-slate-400 mt-2"></div>
    </div>
    <div class="text-xs text-slate-500 mb-3 text-center">小本金阶段，风控比命中率更重要，请谨慎下注</div>
    <button class="btn btn-success btn-full" id="save-bet-btn">确认投注</button>`;

    openModal(html, () => {
      const stakeInput = document.getElementById('bet-stake');
      const preview = document.getElementById('bet-preview');
      const update = () => {
        const stake = parseFloat(stakeInput.value) || 0;
        const win = Parlay.potentialWin(stake, tOdds);
        const profit = Parlay.netProfit(stake, tOdds);
        preview.innerHTML = `预计收益 <span class="text-green-400 font-bold">¥${win}</span>（净利润 ¥${profit}）`;
      };
      stakeInput.addEventListener('input', update); update();
      document.getElementById('save-bet-btn').addEventListener('click', () => {
        const stake = parseFloat(stakeInput.value);
        const { valid, error } = Parlay.validate(parlaySelections, stake);
        if (!valid) { toast(error, 'error'); return; }
        const bet = {
          betDate: new Date().toISOString().slice(0, 10),
          betType: `${parlaySelections.length}串1`,
          stake, totalOdds: tOdds,
          potentialWin: Parlay.potentialWin(stake, tOdds),
          actualWin: null, status: '待结算',
          selections: parlaySelections.map(s => ({ matchId: s.matchId, selection: s.selection, odds: s.odds })),
        };
        Storage.Bets.save(bet);
        parlaySelections = []; updateParlayBar();
        closeModal(); toast('投注已记录', 'success'); showPage('records');
      });
    });
  }

  // ── 串关结算（ui.js 调度）────────────────────────────────────────
  function trySettleBet(betId) {
    const bet = Storage.Bets.get(betId);
    if (!bet || bet.status !== '待结算') return;
    const anyPending = bet.selections.some(s => {
      const m = Storage.Matches.get(s.matchId);
      return !m || !m.result_1x2;
    });
    if (anyPending) return;
    const allWon = bet.selections.every(s => {
      const m = Storage.Matches.get(s.matchId);
      return m && m.result_1x2 === s.selection;
    });
    const status    = allWon ? '已中奖' : '未中奖';
    const actualWin = allWon ? bet.potentialWin : 0;
    Storage.Bets.settle(betId, status, actualWin);
  }

  // ── 记录 Page ────────────────────────────────────────────────────
  function renderRecordsPage() {
    const bets = Storage.Bets.all();
    const cont = document.getElementById('records-content');
    if (!bets.length) { cont.innerHTML = emptyState('暂无投注记录', '在串关页完成投注后出现在这里'); return; }

    const tabs = ['全部','待结算','已中奖','未中奖'];
    const filter = cont.dataset.filter || '全部';
    const filtered = filter === '全部' ? bets : bets.filter(b => b.status === filter);

    let html = `<div class="tag-scroll mb-3">
      ${tabs.map(t => `<div class="tag ${filter===t?'active':''} filter-tab" data-filter="${t}">${t}</div>`).join('')}
    </div>`;
    html += filtered.length ? filtered.map(b => betCard(b)).join('') : `<p class="text-slate-500 text-center py-8 text-sm">无记录</p>`;
    cont.innerHTML = html;

    cont.querySelectorAll('.filter-tab').forEach(tab =>
      tab.addEventListener('click', () => { cont.dataset.filter = tab.dataset.filter; renderRecordsPage(); }));
    cont.querySelectorAll('.settle-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        trySettleBet(btn.dataset.id);
        const b = Storage.Bets.get(btn.dataset.id);
        if (b && b.status !== '待结算') { toast(b.status === '已中奖' ? '已中奖！' : '未中奖', b.status === '已中奖' ? 'success' : 'info'); renderRecordsPage(); }
        else toast('还有比赛结果未录入，暂无法结算', 'error');
      }));
    cont.querySelectorAll('.delete-bet-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        if (confirm('确认删除此投注记录？')) { Storage.Bets.delete(btn.dataset.id); renderRecordsPage(); }
      }));
  }

  function betCard(b) {
    const STATUS_CLASS = { '已中奖': 'badge-won', '未中奖': 'badge-lost', '待结算': 'badge-pending' };
    const selDetails = b.selections?.map(s => {
      const m = Storage.Matches.get(s.matchId);
      const done = m?.result_1x2;
      const correct = done && m.result_1x2 === s.selection;
      return `<div class="flex justify-between text-xs py-0.5">
        <span class="text-slate-400">${m ? `${m.home_team} vs ${m.away_team}` : '比赛已删除'}</span>
        <span class="${done ? (correct ? 'text-green-400' : 'text-red-400') : 'text-slate-500'}">${s.selection} @ ${s.odds}</span>
      </div>`;
    }).join('') || '';
    const profitHtml = b.status !== '待结算'
      ? `<span class="${b.status==='已中奖'?'text-green-400 font-bold':'text-red-400'}">${b.status==='已中奖'?'+':'−'}¥${Math.abs(b.status==='已中奖'?(b.actualWin-b.stake):b.stake).toFixed(2)}</span>`
      : '<span class="text-slate-400">待结算</span>';

    return `
    <div class="card">
      <div class="flex justify-between items-center mb-2">
        <div class="flex items-center gap-2"><span class="font-bold">${b.betType}</span>
          <span class="${STATUS_CLASS[b.status]||'badge-low'} text-xs px-2 py-0.5 rounded-full">${b.status}</span></div>
        <span class="text-xs text-slate-500">${b.betDate}</span>
      </div>
      <div class="mb-2">${selDetails}</div>
      <div class="flex justify-between text-sm pt-2 border-t border-slate-700">
        <span class="text-slate-400">投注 ¥${b.stake} · 赔率 ${b.totalOdds} · 预期 ¥${b.potentialWin}</span>
        ${profitHtml}
      </div>
      <div class="flex gap-2 mt-2">
        ${b.status==='待结算'?`<button class="btn btn-sm btn-ghost flex-1 settle-btn" data-id="${b.id}">自动结算</button>`:''}
        <button class="btn btn-sm btn-ghost ${b.status==='待结算'?'':'flex-1'} delete-bet-btn" data-id="${b.id}">删除</button>
      </div>
    </div>`;
  }

  // ── 账单 Page ────────────────────────────────────────────────────
  function renderFinancePage() {
    const summary = Storage.Bets.summary();
    const stats   = Storage.reviewStats();
    const cont    = document.getElementById('finance-content');
    const pColor  = summary.profit >= 0 ? 'text-green-400' : 'text-red-400';
    const rColor  = summary.roi >= 0    ? 'text-green-400' : 'text-red-400';

    cont.innerHTML = `
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="card text-center"><div class="stat-num text-white">¥${summary.totalStake.toFixed(0)}</div><div class="stat-label">累计投入</div></div>
      <div class="card text-center"><div class="stat-num ${pColor}">${summary.profit>=0?'+':''}¥${summary.profit.toFixed(0)}</div><div class="stat-label">净盈亏</div></div>
      <div class="card text-center"><div class="stat-num ${rColor}">${summary.roi.toFixed(1)}%</div><div class="stat-label">投资回报率</div></div>
      <div class="card text-center"><div class="stat-num">${summary.won}<span class="text-slate-500 text-lg">/${summary.won+summary.lost}</span></div><div class="stat-label">中奖/已结算</div></div>
    </div>
    <div class="section-header">月度收支</div>
    <div class="card"><div class="chart-wrap"><canvas id="finance-chart"></canvas></div></div>
    <div class="text-xs text-slate-500 text-center mt-3">小本金阶段，风控比命中率更重要，不要因短期连胜放大仓位</div>`;

    if (charts.finance) { charts.finance.destroy(); delete charts.finance; }
    const monthly = stats?.monthly || [];
    if (monthly.length) {
      const ctx = document.getElementById('finance-chart').getContext('2d');
      charts.finance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: monthly.map(m => m.month),
          datasets: [{ label: '月盈亏',
            data: monthly.map(m => +m.profit.toFixed(2)),
            backgroundColor: monthly.map(m => m.profit >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)'),
            borderRadius: 4 }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: '#1e293b' } },
            y: { ticks: { color: '#64748b', font: { size: 11 } }, grid: { color: '#334155' } },
          },
        },
      });
    }
  }

  // ── 复盘 Page ────────────────────────────────────────────────────
  function renderReviewPage() {
    const stats = Storage.reviewStats();
    const cont  = document.getElementById('review-content');
    if (!stats) { cont.innerHTML = emptyState('暂无复盘数据', '录入比赛结果后开始统计'); return; }

    // 两种视角切换标签
    const viewHtml = `
    <div class="flex gap-2 mb-4">
      <button class="btn btn-sm flex-1 ${reviewView==='system'?'btn-primary':'btn-ghost'} view-tab" data-view="system">系统推荐视角</button>
      <button class="btn btn-sm flex-1 ${reviewView==='actual'?'btn-primary':'btn-ghost'} view-tab" data-view="actual">实际下注视角</button>
    </div>`;

    let bodyHtml = '';
    if (reviewView === 'system') {
      const s = stats.sys;
      bodyHtml = `
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="card text-center"><div class="stat-num">${stats.total}</div><div class="stat-label">分析总场次</div></div>
        <div class="card text-center"><div class="stat-num">${s.betCount}</div><div class="stat-label">系统建议下注</div></div>
        <div class="card text-center"><div class="stat-num ${stats.abandonRate>=0.5?'text-green-400':'text-yellow-400'}">${pct(stats.abandonRate)}</div><div class="stat-label">放弃率</div></div>
        <div class="card text-center"><div class="stat-num">${s.rate!=null?pct(s.rate):'--'}</div><div class="stat-label">系统命中率</div></div>
      </div>
      <div class="section-header">各等级表现</div>
      <div class="card mb-3">
        ${['甲级','乙级','丙级'].map(g => {
          const d = stats.byGrade[g];
          if (!d || !d.total) return `<div class="text-xs text-slate-500 py-1">${g}：无数据</div>`;
          const rate = d.sysBet > 0 ? d.sysCorrect / d.sysBet : null;
          return `<div class="flex justify-between items-center py-1.5 border-b border-slate-700 last:border-0 text-sm">
            <span>${gradeBadge(g)}</span>
            <span class="text-slate-400">${d.total}场·建议${d.sysBet}场</span>
            <span class="font-semibold">${rate!=null?pct(rate):'--'}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="section-header">各市场类型表现</div>
      <div class="card mb-3">
        ${Object.entries(stats.byMarket).map(([mt, d]) =>
          `<div class="flex justify-between items-center py-1.5 border-b border-slate-700 last:border-0 text-xs">
            <span class="text-slate-300">${mt}</span>
            <span class="text-slate-400">${d.total}场</span>
            <span>${d.total>0?pct(d.correct/d.total):'--'}</span>
          </div>`).join('') || '<p class="text-slate-500 text-xs text-center py-2">暂无数据</p>'}
      </div>
      <div class="section-header">规则命中后胜率</div>
      <div class="card mb-3">
        ${Object.entries(stats.byRule).sort(([,a],[,b])=>b.total-a.total).slice(0,10).map(([id,r]) =>
          `<div class="flex justify-between items-center py-1 border-b border-slate-700 last:border-0 text-xs">
            <span class="text-slate-400">[${id}] ${r.name}</span>
            <span>${r.total}场 · ${r.total>0?pct(r.correct/r.total):'--'}</span>
          </div>`).join('') || '<p class="text-slate-500 text-xs text-center py-2">暂无数据</p>'}
      </div>
      <div class="section-header">准确率趋势</div>
      <div class="card"><div class="chart-wrap"><canvas id="accuracy-chart"></canvas></div></div>`;

    } else {
      const a = stats.actual;
      const roiColor = (a.roi ?? 0) >= 0 ? 'text-green-400' : 'text-red-400';
      bodyHtml = `
      <div class="grid grid-cols-2 gap-3 mb-4">
        <div class="card text-center"><div class="stat-num">${a.betCount}</div><div class="stat-label">实际下注场次</div></div>
        <div class="card text-center"><div class="stat-num">${a.rate!=null?pct(a.rate):'--'}</div><div class="stat-label">实际命中率</div></div>
        <div class="card text-center"><div class="stat-num ${roiColor}">${a.roi!=null?a.roi.toFixed(1)+'%':'--'}</div><div class="stat-label">实际投资回报</div></div>
        <div class="card text-center"><div class="stat-num text-orange-400">${a.maxDrawdown>0?'-¥'+a.maxDrawdown.toFixed(0):'--'}</div><div class="stat-label">最大回撤</div></div>
      </div>
      <div class="card mb-3 text-sm">
        <div class="flex justify-between mb-1"><span class="text-slate-400">总投入</span><span>¥${a.totalStake.toFixed(2)}</span></div>
        <div class="flex justify-between mb-1"><span class="text-slate-400">总回收</span><span>¥${a.totalReturn.toFixed(2)}</span></div>
        <div class="flex justify-between"><span class="text-slate-400">净盈亏</span>
          <span class="${(a.profit??0)>=0?'text-green-400':'text-red-400'} font-bold">${fmtSign(a.profit)}</span></div>
      </div>
      <div class="section-header">月度实际收支</div>
      <div class="card"><div class="chart-wrap"><canvas id="actual-chart"></canvas></div></div>`;
    }

    cont.innerHTML = viewHtml + bodyHtml;

    // 绑定视角切换
    cont.querySelectorAll('.view-tab').forEach(btn =>
      btn.addEventListener('click', () => { reviewView = btn.dataset.view; renderReviewPage(); }));

    // 图表
    const monthly = stats.monthly || [];
    if (reviewView === 'system' && monthly.length && document.getElementById('accuracy-chart')) {
      if (charts.accuracy) { charts.accuracy.destroy(); delete charts.accuracy; }
      const done = Storage.Matches.completed().reverse();
      if (done.length >= 3) {
        const wSize = 10, labels = [], data = [];
        for (let i = wSize-1; i < done.length; i++) {
          const sl = done.slice(i-wSize+1, i+1);
          const acc = sl.filter(m => m.analysis?.suggested_side === m.result_1x2).length / sl.length;
          labels.push(`#${i+1}`); data.push(+(acc*100).toFixed(1));
        }
        const ctx = document.getElementById('accuracy-chart').getContext('2d');
        charts.accuracy = new Chart(ctx, {
          type: 'line', data: { labels,
            datasets: [{ label: `滚动${wSize}场命中率`, data, borderColor: '#38bdf8',
              backgroundColor: 'rgba(56,189,248,0.1)', fill: true, tension: 0.3, pointRadius: 2 }] },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
            scales: { x: { ticks: { color:'#64748b', font:{size:10} }, grid:{display:false} },
              y: { min:0, max:100, ticks:{color:'#64748b', font:{size:10}, callback:v=>v+'%'}, grid:{color:'#334155'} } } },
        });
      }
    }
    if (reviewView === 'actual' && monthly.length && document.getElementById('actual-chart')) {
      if (charts.actual) { charts.actual.destroy(); delete charts.actual; }
      const ctx = document.getElementById('actual-chart').getContext('2d');
      charts.actual = new Chart(ctx, {
        type: 'bar', data: { labels: monthly.map(m=>m.month),
          datasets: [{ label: '月盈亏', data: monthly.map(m=>+m.profit.toFixed(2)),
            backgroundColor: monthly.map(m=>m.profit>=0?'rgba(34,197,94,0.7)':'rgba(239,68,68,0.7)'),
            borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x:{ticks:{color:'#64748b',font:{size:11}},grid:{color:'#1e293b'}},
            y:{ticks:{color:'#64748b',font:{size:11}},grid:{color:'#334155'}} } },
      });
    }
  }

  // ── 参数设置 Modal ──────────────────────────────────────────────
  function showSettingsModal() {
    const layered = Config.getLayered();
    const renderSection = (title, obj) =>
      `<div class="section-header">${title}</div>` +
      Object.entries(obj).map(([k, v]) => `
        <div class="flex justify-between items-center py-1.5 border-b border-slate-700">
          <span class="text-sm text-slate-300">${k}</span>
          <input type="number" step="any" class="input text-right w-28 config-field" data-key="${k}" value="${v}">
        </div>`).join('');

    const html = `
    <div class="modal-handle"></div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-lg font-bold">参数设置</h2>
      <button class="btn btn-sm btn-ghost" id="reset-config-btn">恢复默认</button>
    </div>
    ${renderSection('阈值层', layered['阈值'])}
    ${renderSection('权重层', layered['权重'])}
    ${renderSection('分级层', layered['分级'])}
    <div class="mt-4 flex gap-2">
      <button class="btn btn-ghost flex-1" onclick="closeModal()">取消</button>
      <button class="btn btn-primary flex-1" id="save-config-btn">保存</button>
    </div>
    <div class="flex gap-2 mt-3">
      <button class="btn btn-ghost btn-full btn-sm" id="export-btn">导出数据</button>
      <label class="btn btn-ghost btn-full btn-sm" style="cursor:pointer">导入数据
        <input type="file" accept=".json" id="import-file" style="display:none"></label>
    </div>`;

    openModal(html, () => {
      document.getElementById('reset-config-btn').addEventListener('click', () => {
        if (confirm('确认恢复所有参数到默认值？')) { Config.reset(); closeModal(); toast('已恢复默认参数', 'success'); }
      });
      document.getElementById('save-config-btn').addEventListener('click', () => {
        const updates = {};
        document.querySelectorAll('.config-field').forEach(input => {
          updates[input.dataset.key] = parseFloat(input.value);
        });
        Config.save(updates);
        closeModal(); toast('参数已保存', 'success');
      });
      document.getElementById('export-btn').addEventListener('click', () => {
        const blob = new Blob([Storage.exportAll()], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `足彩备份_${Date.now()}.json`; a.click();
        toast('数据已导出', 'success');
      });
      document.getElementById('import-file').addEventListener('change', function() {
        const file = this.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
          try { Storage.importAll(e.target.result); closeModal(); showPage(currentPage); toast('数据导入成功', 'success'); }
          catch { toast('导入失败：格式错误', 'error'); }
        };
        reader.readAsText(file);
      });
    });
  }

  // ── Modal 工具 ──────────────────────────────────────────────────
  function openModal(html, afterOpen) {
    let overlay = document.getElementById('modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'modal-overlay'; overlay.className = 'modal-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div class="modal-sheet">${html}</div>`;
    overlay.style.display = 'flex';
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); }, { once: true });
    afterOpen?.();
  }

  function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  // ── 初始化 ───────────────────────────────────────────────────────
  function init() {
    document.querySelectorAll('.nav-btn').forEach(btn =>
      btn.addEventListener('click', () => showPage(btn.dataset.page)));
    document.getElementById('fab-add').addEventListener('click', () => {
      if (currentPage === 'analysis') showAddMatchModal();
    });
    document.getElementById('btn-settings').addEventListener('click', showSettingsModal);
    showPage('analysis');
  }

  return { init, showPage, toast, closeModal, showSettingsModal };
})();

window.closeModal = App.closeModal;
window.UI = App;
document.addEventListener('DOMContentLoaded', App.init);
