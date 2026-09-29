/* ═══ 视图：策略对比（动态 + 号，可放 2/3/4…N 套）═══
   设计：
     - 每套策略是一张卡片（名称 + 代码 + 删除按钮）。
     - 底部一个虚线「＋ 添加一套策略」按钮，点了就多一套，**没有上限**。
     - 保存到 localStorage['fv2_cmp_strategies']，供模拟盘复用。
     - 「对比回测」对同一合约/周期跑每套策略，输出指标表并标出每项谁更好。
   ============================================================================ */
(function () {
  'use strict';

  /* 唯一事实源（2026-09-22）：本页不再直接读写 fv2_cmp_strategies —— 那是 StrategyLibrary 的所有权。
     依赖顺序由 index.html 保证（strategy-library.js 先于本文件），见 docs/CALL-GRAPH.md §3。 */
  const LIB = window.StrategyLibrary;

  // 运行时所有权校验（撞车即炸）
  if (LIB) try { LIB.own('fv2_cmp_strategies', 'views/strategy-compare'); } catch (e) { console.error('[StrategyCompare]', e); }

  /* 默认策略示例（模板字符串）。
     ⚠️ 修复记录 2026-09-28：513a092 提交误删了本行的 `const DEFAULT_STRATEGY = \`` 前缀，
     只剩孤立的结尾反引号（第 29 行 `};` + 反引号），导致整个文件 SyntaxError，策略对比页无法加载。
     从 b391477 原始版还原前缀。 */
  const DEFAULT_STRATEGY = `// 策略契约：module.exports.onBar = function(kline, ctx){ return {type,reason} | null }
module.exports.onBar = function (kline, ctx) {
  var closes = ctx.history.map(function (k) { return k.close; });
  if (closes.length < 30) return null;
  function ema(arr, n) { var k = 2 / (n + 1), e = arr[0]; for (var i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k); return e; }
  var e26 = ema(closes, 26);
  var prev = closes.slice(0, -1);
  var e26p = ema(prev, 26);
  var c = closes[closes.length - 1], cp = prev[prev.length - 1];
  if (cp <= e26p && c > e26) return { type: 'BUY', reason: '上穿EMA26' };
  if (cp >= e26p && c < e26) return { type: 'SELL', reason: '下穿EMA26' };
  return null;
};`;

  let strategies = [];

  function load() {
    strategies = LIB ? LIB.getList() : [];
    if (!Array.isArray(strategies) || !strategies.length) {
      strategies = [
        { id: 's1', name: '策略 1', code: DEFAULT_STRATEGY },
        { id: 's2', name: '策略 2', code: '' }
      ];
      save();
    }
  }
  function save() {
    try { if (LIB) LIB.setList(strategies); } catch (e) { /* ignore */ }
  }
  function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* 不再把策略 id / name 拼进 onclick / oninput（CALL-GRAPH §4.3）。
     原写法的注入点：把 s.id 拼进 onclick（事件属性内嵌字符串插值）—— onclick 是 HTML 属性，
     浏览器先解码 &#39; 回 '，恶意 id 可闭合 JS 字符串。
     改为 data-* + 事件委托（容器上监听 input/click），值不参与 JS 拼接。 */
  function render() {
    const box = document.getElementById('cmpList');
    if (!box) return;
    box.innerHTML = strategies.map((s, i) => `
      <div class="cmp-card" data-id="${UI.esc(s.id)}">
        <div class="cmp-head">
          <span class="cmp-idx">${i + 1}</span>
          <input class="cmp-name" type="text" value="${UI.esc(s.name || '')}" placeholder="策略名称，如 EMA26-1H">
          <button class="btn btn-d btn-xs cmp-del">✕ 删除</button>
        </div>
        <textarea class="cmp-textarea" spellcheck="false" placeholder="在此编写策略代码…">${UI.esc(s.code || '')}</textarea>
      </div>`).join('')
      + `<button class="btn btn-g cmp-add">＋ 添加一套策略（可无限增加）</button>`;
    bindList(box);
  }

  // 事件委托：input 改 name/code，click 删除/新增。id 从最近 .cmp-card 的 data-id 取。
  function bindList(box) {
    if (box.dataset.bound === '1') return;      // 委托绑在容器上，重建 innerHTML 不影响
    box.dataset.bound = '1';
    box.addEventListener('input', (e) => {
      const cardEl = e.target.closest('.cmp-card');
      if (!cardEl) return;
      const id = cardEl.dataset.id;
      if (e.target.classList.contains('cmp-name')) rename(id, e.target.value);
      else if (e.target.classList.contains('cmp-textarea')) edit(id, e.target.value);
    });
    box.addEventListener('click', (e) => {
      if (e.target.classList.contains('cmp-add')) { add(); return; }
      if (e.target.classList.contains('cmp-del')) {
        const cardEl = e.target.closest('.cmp-card');
        if (cardEl) remove(cardEl.dataset.id);
      }
    });
  }

  function add() {
    strategies.push({ id: uid(), name: '策略 ' + (strategies.length + 1), code: '' });
    save(); render();
    const st = document.getElementById('cmpStatus');
    if (st) st.innerHTML = `<span>已添加，当前共 ${strategies.length} 套策略</span>`;
  }
  function remove(id) {
    if (strategies.length <= 1) {
      const st = document.getElementById('cmpStatus');
      if (st) st.innerHTML = '<span style="color:var(--warn)">至少保留 1 套策略</span>';
      return;
    }
    strategies = strategies.filter(s => s.id !== id);
    save(); render();
  }
  function rename(id, name) {
    const s = strategies.find(x => x.id === id);
    if (s) { s.name = name; save(); }
  }
  function edit(id, code) {
    const s = strategies.find(x => x.id === id);
    if (s) { s.code = code; save(); }
  }

  /* ── 对比回测指标定义（"更好"的方向：收益/胜率/盈亏比/夏普 越大越好，回撤越小越好） ── */
  const CMP_METRICS = [
    { key: 'totalReturn', label: '总收益', better: 'high', fmt: v => v == null ? '--' : v.toFixed(2) + '%' },
    { key: 'winRate', label: '胜率', better: 'high', fmt: v => v == null ? '--' : v.toFixed(1) + '%' },
    { key: 'maxDrawdown', label: '最大回撤', better: 'low', fmt: v => v == null ? '--' : v.toFixed(2) + '%' },
    { key: 'profitFactor', label: '盈亏比', better: 'high', fmt: v => v == null ? '--' : String(v) },
    { key: 'sharpeRatio', label: '夏普', better: 'high', fmt: v => v == null ? '--' : String(v) },
    { key: 'totalTrades', label: '交易次数', better: null, fmt: v => v == null ? '--' : String(v) }
  ];
  const cmpNum = v => { const n = parseFloat(String(v == null ? '' : v).replace('%', '')); return Number.isFinite(n) ? n : null; };

  // 每项指标的最优行 id（纯函数，可单测）
  function computeBest(rows) {
    const best = {};
    CMP_METRICS.forEach(m => {
      if (!m.better) return;
      let bk = null, bv = null;
      rows.forEach(r => {
        if (!r.ok) return;
        const val = cmpNum(r.summary[m.key]);
        if (val == null) return;
        if (bv == null || (m.better === 'high' ? val > bv : val < bv)) { bv = val; bk = r.id; }
      });
      best[m.key] = bk;
    });
    return best;
  }

  // 结果区 HTML（纯渲染，不碰状态）
  function renderRows(rows, best) {
    return rows.map(r => {
      if (!r.ok) {
        return `<div class="cmp-res"><div class="t">${UI.esc(r.name)}</div>
          <div class="line" style="color:var(--danger)">回测失败：${UI.esc(r.error)}</div></div>`;
      }
      const s = r.summary;
      const lines = CMP_METRICS.map(m => {
        const val = cmpNum(s[m.key]);
        const isBest = best[m.key] && best[m.key] === r.id && val != null;
        const tag = isBest ? (m.better === 'low' ? ' 🏆最小' : ' 🏆最优') : '';
        const shown = (m.key === 'totalReturn' || m.key === 'maxDrawdown' || m.key === 'winRate') ? val : s[m.key];
        return `<div class="line"><span>${m.label}</span><b class="${isBest ? 'win' : ''}">${m.fmt(shown)}${tag}</b></div>`;
      }).join('');
      return `<div class="cmp-res"><div class="t">${UI.esc(r.name)}</div>${lines}</div>`;
    }).join('');
  }

  // 综合排序（收益 − 0.5×回撤 + 0.05×胜率），纯函数
  function rankOverall(rows) {
    return rows.filter(r => r.ok).map(r => {
      const ret = cmpNum(r.summary.totalReturn) || 0;
      const dd = cmpNum(r.summary.maxDrawdown) || 0;
      const rw = cmpNum(r.summary.winRate) || 0;
      return { name: r.name, score: ret - dd * 0.5 + rw * 0.05, ret, dd };
    }).sort((a, b) => b.score - a.score);
  }

  /* ── 对比回测：给出每套策略指标，并标出每项最优 ── */
  async function run() {
    const code = (document.getElementById('cmpCode')?.value || '').trim();
    const period = Number(document.getElementById('cmpPeriod')?.value || 101);
    const limit = Number(document.getElementById('cmpLimit')?.value || 300);
    const out = document.getElementById('cmpResult');
    const st = document.getElementById('cmpStatus');

    if (!code) { if (st) st.innerHTML = '<span style="color:var(--warn)">请先填写对比用合约代码</span>'; return; }
    const valid = strategies.filter(s => (s.code || '').trim());
    if (!valid.length) { if (st) st.innerHTML = '<span style="color:var(--warn)">还没有填写任何策略代码</span>'; return; }

    if (out) out.innerHTML = '<div class="note"><span class="spin"></span>对比回测运行中…</div>';
    UI.status('策略对比中…', 'warn');

    const rows = [];
    for (const s of valid) {
      try {
        const r = await API.backtestWith(s.code, { code, period, multi: false, limit });
        rows.push({ id: s.id, name: s.name || s.id, ok: true, summary: r.summary || {}, equity: r.equityCurve || [] });
      } catch (err) {
        rows.push({ id: s.id, name: s.name || s.id, ok: false, error: err.message });
      }
    }

    const best = computeBest(rows);

    if (out) {
      out.innerHTML = `<div class="stats" style="margin-top:14px">
        <div class="stat"><div class="k">参与对比</div><div class="v">${rows.length}</div></div>
        <div class="stat"><div class="k">合约</div><div class="v" style="font-size:13px">${UI.esc(code)}</div></div>
        <div class="stat"><div class="k">周期</div><div class="v" style="font-size:13px">${period === 101 ? '日线' : period + '分'}</div></div>
      </div>
      <div class="cmp-results">${renderRows(rows, best)}</div>`;

      // 综合结论：按总收益 + 回撤加权的一句话
      const scored = rankOverall(rows);
      if (scored.length) {
        out.innerHTML += `<div class="note" style="margin-top:12px;display:block">
          <div>📌 综合（收益 − 0.5×回撤 + 0.05×胜率）排序：${scored.map((s, i) => `${i + 1}. ${UI.esc(s.name)}（收益 ${s.ret.toFixed(2)}% / 回撤 ${s.dd.toFixed(2)}%）`).join('　')}</div>
          <div style="color:var(--t3)">⚠️ 仅基于历史数据的信号强度对比，非涨跌预测，不构成投资建议</div>
        </div>`;
      }
    }
    if (st) st.innerHTML = `<span>对比完成 · ${rows.length} 套策略</span>`;
    UI.status('策略对比完成', '');
  }

  window.StrategyCompareView = { load, render, add, remove, rename, edit, run };
  load();

  RouteRegistry.register('compare-run', run);
  // 说明：页面进入钩子统一由 app.js 的 pageMap 调用 StrategyView.onEnter，
  // 这里不再重复 registerPage('vStrategy')，避免覆盖 strategy.js 的注册。
  // StrategyView.onEnter 会调用 StrategyCompareView.enter()。
  function enter() {
    load();
    render();
    const st = document.getElementById('cmpStatus');
    if (st) st.innerHTML = `<span>当前 ${strategies.length} 套策略</span>`;
  }
  window.StrategyCompareView.enter = enter;
})();
