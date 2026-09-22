/* ═══ 视图控制器：模拟期货盘 ═══
   职责分工（2026-09-22 模块化重构）：
     js/strategy-library.js  ← 策略唯一事实源（主策略 + 对比页 N 套）
     js/views/sim-render.js  ← 纯渲染（数据 → HTML / ECharts option）
     js/sim.js               ← 推演引擎（账户、下单、止损、汇总）
     本文件（控制器）        ← 状态 + DOM 读写 + 事件注册

   【本页所有交互一律走中央路由】禁止内联 onclick 里写业务逻辑：
     sim-run               按策略执行
     sim-reset             重置模拟盘
     sim-buy / sim-sell    手动买入 / 卖出
     sim-close             平仓
     sim-run-all           对比模拟（全部策略）
     sim-pick              把对比结果里第 N 张卡片画到K线上（payload: { index } 或 { name }）
     sim-refresh-strategies 重新载入策略列表
     sim-strategy-change   策略下拉变化（payload: id）
     sim-code-change       合约输入变化（刷新合约规格提示）

   数据来源一律走 StrategyLibrary / Screener 缓存，本文件不直接读写 localStorage 业务键。

   中央路由注册覆盖的坑（2026-09-22 已修）：app.js 曾在 DOMContentLoaded 里对 7 个页面
   统一 registerPage 并整体覆盖本文件注册的 onEnter → 策略下拉永不加载。现已改为组合语义。
   ================================================================= */
(function () {
  'use strict';

  const R = window.SimRender;
  const SR = window.SimEngine;
  const LIB = window.StrategyLibrary;

  let chart = null;
  let klines = [];
  let acc = null;
  let curCode = '';
  let curPeriod = 101;
  let simStrategies = [];       // StrategyLibrary.all() 的最近一份（模拟盘与对比模拟共用）
  let allRows = [];             // 「对比模拟」最近一轮结果
  let delegateBound = false;    // 结果区事件委托只绑一次

  const storeKey = (code, period) => 'fv2_sim_' + code + '_' + period;

  /* ─────────── 状态存取 ─────────── */
  function persist() {
    if (!acc || !curCode) return;
    try { localStorage.setItem(storeKey(curCode, curPeriod), JSON.stringify(acc)); } catch (e) { /* ignore */ }
  }
  function restore(code, period) {
    try {
      const raw = localStorage.getItem(storeKey(code, period));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function readInputs() {
    const code = (document.getElementById('simCode')?.value || '').trim();
    const period = Number(document.getElementById('simPeriod')?.value || 101);
    const latest = document.getElementById('simLatest')?.checked;
    const dateVal = (document.getElementById('simDate')?.value || '').trim();
    const endDate = latest ? 'latest' : (dateVal || '');
    const qty = Math.max(1, Number(document.getElementById('simQty')?.value || 1));
    const stratId = document.getElementById('simStrategy')?.value || '';
    const riskMode = document.getElementById('simRisk')?.checked || false;
    return { code, period, endDate, qty, stratId, latest, dateVal, riskMode };
  }

  /* 载入本地缓存的K线（不联网）；返回 true/false */
  function loadKlines(code, period) {
    const k = (window.Screener && Screener.readKlineCache(code, period)) || null;
    klines = Array.isArray(k) ? k : [];
    curCode = code; curPeriod = period;
    return klines.length > 0;
  }

  function setStatus(html) {
    const st = document.getElementById('simStatus');
    if (st) st.innerHTML = html;
  }
  function warn(msg) { setStatus('<span style="color:var(--warn)">' + UI.esc(msg) + '</span>'); }
  function fail(msg) { setStatus('<span style="color:var(--danger)">' + UI.esc(msg) + '</span>'); }

  /* ─────────── 策略列表（统一走 StrategyLibrary） ─────────── */
  async function loadStrategies() {
    const sel = document.getElementById('simStrategy');
    if (!sel) return simStrategies;
    let keep = sel.value || LIB.lastId();
    try {
      await Promise.resolve();                       // 保持异步契约，便于将来换远端源
      simStrategies = LIB.all();
      sel.innerHTML = '<option value="">— 选择要执行的策略 —</option>'
        + simStrategies.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)}</option>`).join('');
      sel._map = {};
      simStrategies.forEach(s => { sel._map[s.id] = s.code; });
      if (keep && sel._map[keep] !== undefined) sel.value = keep;
    } catch (e) { /* ignore */ }
    return simStrategies;
  }

  /* 取策略代码：每次现取（用户在对比页改了代码后，模拟盘立即用新文本，不再用旧快照） */
  function strategyCodeOf(id) { return LIB.get(id); }

  /* 下拉变化：记住选择 + 回显 */
  function onStrategyChange(id) {
    LIB.remember(id || '');
    const s = simStrategies.find(x => x.id === id);
    if (s) setStatus(`<span>已选策略：${UI.esc(s.name)}（${(s.code || '').length} 字符）</span>`);
  }

  /* ─────────── 渲染 ─────────── */
  function renderPos() {
    const box = document.getElementById('simPos');
    if (!box) return;
    if (!acc) { box.innerHTML = ''; return; }
    const s = SR.summary(acc, klines.length ? klines[klines.length - 1].close : null);
    box.innerHTML = R.posHtml(s);
  }

  function renderTrades() {
    const box = document.getElementById('simTrades');
    if (!box) return;
    box.innerHTML = R.tradesHtml(acc && acc.trades);
  }

  function drawChart() {
    if (!window.echarts || !klines.length || !acc) return;
    const el = document.getElementById('simChart');
    if (!el) return;
    chart?.dispose();
    chart = echarts.init(el);
    chart.setOption(R.chartOption(klines, acc));
  }

  function refreshAll() {
    renderPos();
    renderTrades();
    drawChart();
  }

  /* ─────────── 事件处理（全部由 RouteRegistry 派发） ─────────── */

  /* 按策略执行 */
  async function run() {
    const { code, period, endDate, qty, stratId, latest, dateVal, riskMode } = readInputs();
    if (!code) return warn('请先填写合约代码');
    if (!loadKlines(code, period)) {
      warn(`本地无 ${code} ${period} 缓存，请先在 K线详情页「⤓ 拉取K线(增量)」`);
      UI.status('本地无K线缓存', 'err');
      return;
    }
    const strategyCode = strategyCodeOf(stratId);
    if (!strategyCode) return warn('请选择要执行的策略（可先在「策略」页用＋添加多套）');
    LIB.remember(stratId);

    setStatus('<span class="spin"></span>按策略推演中…');
    UI.status('模拟盘执行中…', 'warn');
    try {
      const spec = window.Specs ? Specs.get(code) : null;
      const r = await SR.runStrategy(klines, strategyCode, endDate, { qty, code, period, spec, riskMode });
      acc = r.account;
      persist();
      refreshAll();
      const label = latest ? '最新日期（全部数据）' : ('截至 ' + (dateVal || '最新'));
      setStatus(`<span>✅ 已按策略执行（${UI.esc(label)}）· 买入 ${acc.marks.filter(m => m.type === 'BUY').length} 次 · 卖出 ${acc.marks.filter(m => m.type === 'SELL').length} 次</span>`);
      UI.status('模拟盘执行完成', '');
    } catch (err) {
      fail('执行失败：' + err.message);
      UI.status('模拟盘失败：' + err.message, 'err');
    }
  }

  /* 确保有账户 / 有K线 */
  function ensureBase() {
    const { code, period } = readInputs();
    if (!code) return false;
    if (curCode !== code || curPeriod !== period) {
      loadKlines(code, period);
      acc = restore(code, period) || SR.newAccount({ code, period });
    }
    if (!acc) acc = SR.newAccount({ code, period });
    return klines.length > 0;
  }

  /* 手动下单 */
  function manualOrder(type) {
    if (!ensureBase()) return warn('本地无K线缓存，请先拉取K线');
    const { qty } = readInputs();
    const idx = klines.length - 1;
    const r = SR.manualOrder(acc, klines, idx, type, qty, '手动');
    if (!r.ok) return fail(r.error);
    persist(); refreshAll();
    setStatus(`<span>✅ 手动${type === 'BUY' ? '买入' : '卖出'} ${qty} 手 @ ${UI.num(klines[idx].close)}（${UI.esc(klines[idx].time)}）</span>`);
  }

  function closeOrder() {
    if (!ensureBase()) return warn('本地无K线缓存');
    const r = SR.closePosition(acc, klines, klines.length - 1);
    if (!r.ok) return warn(r.error);
    persist(); refreshAll();
    setStatus('<span>✅ 已平仓</span>');
  }

  function reset() {
    const { code, period } = readInputs();
    acc = SR.newAccount({ code: code || curCode, period: period || curPeriod });
    persist();
    refreshAll();
    setStatus('<span>↺ 模拟盘已重置（资金回到初始）</span>');
  }

  /* ─────────── 对比模拟：同一合约，把所有策略各跑一遍 ─────────── */
  async function runAll() {
    const out = document.getElementById('simAllResult');
    const { code, period, endDate, qty, riskMode } = readInputs();
    if (!code) return warn('请先填写合约代码');
    if (!loadKlines(code, period)) return warn(`本地无 ${code} ${period} 缓存，请先拉取K线`);

    if (out) out.innerHTML = '<div class="note"><span class="spin"></span>全部策略模拟中…</div>';
    UI.status('对比模拟中…', 'warn');
    try {
      simStrategies = LIB.all();                     // 与下拉框共用同一份最新策略
      const valid = simStrategies.filter(s => (s.code || '').trim());
      if (!valid.length) throw new Error('没有可用策略（请先在策略页编写并保存）');

      const rows = [];
      const spec = window.Specs ? Specs.get(code) : null;
      for (const s of valid) {
        try {
          const sim = await SR.runStrategy(klines, s.code, endDate, { qty, code, period, spec, riskMode });
          const lastIdx = sim.account.lastIndex >= 0 ? sim.account.lastIndex : klines.length - 1;
          const sum = SR.summary(sim.account, klines[lastIdx].close);
          // 修复（2026-09-22）：原来只留 marks，trades/equity/cash 被丢弃，
          // 点卡片后「成交记录」永远「尚无成交」、蓝色权益虚线不出现。现在整账户一起带。
          rows.push({ id: s.id, name: s.name || s.id, ok: true, sum, account: sim.account });
        } catch (e) {
          rows.push({ id: s.id, name: s.name || s.id, ok: false, error: e.message });
        }
      }
      allRows = rows;
      if (out) out.innerHTML = R.allResultHtml(rows, code);
      setStatus(`<span>✅ 对比模拟完成 · ${rows.length} 套策略</span>`);
      UI.status('对比模拟完成', '');
    } catch (err) {
      if (out) out.innerHTML = `<div class="blank"><div class="em">⚠️</div><div class="tx">${UI.esc(err.message)}</div></div>`;
      UI.status('对比模拟失败：' + err.message, 'err');
    }
  }

  /* 把某套策略的结果（买卖点 + 成交记录 + 权益曲线）画到 K 线上 */
  function pick(payload) {
    let r = null;
    if (payload && typeof payload.index === 'number') r = allRows[payload.index];
    else if (payload && payload.name) r = allRows.find(x => x.name === payload.name);
    if (!r || !r.ok) return;
    acc = r.account || { initialCash: 100000, cash: 100000, position: 0, avgPrice: 0, marks: [], trades: [], equity: [] };
    renderPos();
    renderTrades();
    drawChart();
    setStatus(`<span>已把「${UI.esc(r.name)}」的买卖点、成交记录与权益曲线画到K线上</span>`);
    // 结果区高亮当前选中卡片
    const box = document.getElementById('simAllResult');
    if (box) {
      box.querySelectorAll('[data-sim-pick]').forEach(el => {
        el.style.outline = (Number(el.dataset.simPick) === payload.index) ? '1px solid var(--brand)' : 'none';
      });
    }
  }

  /* ─────────── 合约规格提示 ─────────── */
  function updateSpecInfo() {
    const el = document.getElementById('simSpecInfo');
    const code = (document.getElementById('simCode')?.value || '').trim();
    if (!el) return;
    if (!code || !window.Specs) { el.textContent = ''; return; }
    const s = Specs.get(code);
    el.innerHTML = `　规格：乘数 <b style="color:var(--t1)">${s.multiplier}</b> · 保证金 ${(s.marginRate * 100).toFixed(0)}% · 费 ${s.fee || 0}元/手${s.feeRate ? ' + ' + (s.feeRate * 10000).toFixed(1) + '‱' : ''} · <span style="color:var(--t3)">${UI.esc(s.source)}</span>`;
  }

  /* ─────────── 事件注册（中央路由） ─────────── */
  RouteRegistry.register('sim-run', run);
  RouteRegistry.register('sim-reset', reset);
  RouteRegistry.register('sim-buy', () => manualOrder('BUY'));
  RouteRegistry.register('sim-sell', () => manualOrder('SELL'));
  RouteRegistry.register('sim-close', closeOrder);
  RouteRegistry.register('sim-run-all', runAll);
  RouteRegistry.register('sim-pick', pick);
  RouteRegistry.register('sim-refresh-strategies', loadStrategies);
  RouteRegistry.register('sim-strategy-change', onStrategyChange);
  RouteRegistry.register('sim-code-change', updateSpecInfo);

  /* 对比结果区点击：事件委托（只绑一次），不再往 HTML 里拼 onclick */
  function bindDelegation() {
    const box = document.getElementById('simAllResult');
    if (!box || delegateBound) return;
    box.addEventListener('click', ev => {
      const card = ev.target.closest && ev.target.closest('[data-sim-pick]');
      if (!card) return;
      RouteRegistry.dispatch('sim-pick', { index: Number(card.dataset.simPick) });
    });
    delegateBound = true;
  }

  /* 策略库变更（对比页保存/改名）→ 模拟盘下拉同步 */
  if (LIB && LIB.onChange) LIB.onChange(() => { loadStrategies(); });

  RouteRegistry.registerPage('vSim', {
    onEnter: () => {
      loadStrategies();
      // 从详情页跳进来时，把当前合约带过来
      const codeInp = document.getElementById('simCode');
      if (codeInp && !codeInp.value && window.currentCode) codeInp.value = window.currentCode;
      const pInp = document.getElementById('simPeriod');
      if (pInp && window.currentPeriod) {
        const has = Array.from(pInp.options).some(o => Number(o.value) === window.currentPeriod);
        if (has) pInp.value = String(window.currentPeriod);
      }
      updateSpecInfo();
      bindDelegation();
      chart?.resize();
    }
  });

  /* 兼容旧调用点：外部仍可通过 window.SimView 触发（内部一律走中央路由） */
  window.SimView = {
    run, manualOrder, closeOrder, reset, runAll, pick, loadStrategies,
    onStrategyChange, updateSpecInfo,
    onEnter: () => RouteRegistry.dispatch('sim-run-all') && undefined  // 占位，避免被误当页面钩子
  };
  delete window.SimView.onEnter;

  window.addEventListener('resize', () => chart?.resize());
})();
