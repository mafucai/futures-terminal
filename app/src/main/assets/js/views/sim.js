/* ═══ 视图：模拟期货盘 ═══
   功能：
     - 选合约 / 周期 / 起始日期（或"用最新日期"）/ 策略 / 手数
     - 「按策略执行」：用真实K线逐根推演，生成买卖点
     - 手动「买入 / 卖出 / 平仓」：在最新一根K线上成交
     - K线主图**明显标注**每次买入(▲红)、卖出(▼绿)，叠加权益曲线
     - 数据全部来自本地缓存（不自动联网）
   ================================================================= */
(function () {
  'use strict';

  let chart = null;
  let klines = [];
  let acc = null;
  let curCode = '';
  let curPeriod = 101;

  const storeKey = (code, period) => 'fv2_sim_' + code + '_' + period;

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
    return { code, period, endDate, qty, stratId, latest, dateVal };
  }

  /* 载入本地缓存的K线（不联网）；返回 true/false */
  function loadKlines(code, period) {
    const k = (window.Screener && Screener.readKlineCache(code, period)) || null;
    klines = Array.isArray(k) ? k : [];
    curCode = code; curPeriod = period;
    return klines.length > 0;
  }

  async function loadStrategies() {
    const sel = document.getElementById('simStrategy');
    if (!sel) return;
    try {
      const r = await API.listStrategies();
      sel.innerHTML = '<option value="">— 选择要执行的策略 —</option>'
        + r.strategies.map(s => `<option value="${UI.esc(s.id)}">${UI.esc(s.name)}</option>`).join('');
      // 记住完整策略文本，选择时用 id 取
      sel._map = {};
      r.strategies.forEach(s => { sel._map[s.id] = s.code; });
    } catch (e) { /* ignore */ }
  }

  function strategyCodeOf(id) {
    const sel = document.getElementById('simStrategy');
    if (!sel || !sel._map) return '';
    return sel._map[id] || '';
  }

  function renderPos() {
    const box = document.getElementById('simPos');
    if (!box) return;
    if (!acc) { box.innerHTML = ''; return; }
    const s = SimEngine.summary(acc, klines.length ? klines[klines.length - 1].close : null);
    const posTxt = s.position > 0 ? ('多头 ' + s.position + ' 手') : s.position < 0 ? ('空头 ' + Math.abs(s.position) + ' 手') : '空仓';
    const cells = [
      ['初始资金', UI.num(s.initialCash, 0)],
      ['账户权益', UI.num(s.equity, 0)],
      ['总收益', s.totalReturn],
      ['持仓', posTxt],
      ['持仓均价', s.position ? UI.num(s.avgPrice) : '--'],
      ['已实现盈亏', UI.num(s.realized, 0)],
      ['最大回撤', s.maxDrawdown],
      ['胜率', s.winRate]
    ];
    box.innerHTML = cells.map(([k, v]) => {
      let cls = '';
      if (k === '总收益') cls = parseFloat(s.totalReturn) > 0 ? 'pos' : parseFloat(s.totalReturn) < 0 ? 'neg' : '';
      if (k === '已实现盈亏') cls = s.realized > 0 ? 'pos' : s.realized < 0 ? 'neg' : '';
      return `<div class="sim-cell"><div class="k">${k}</div><div class="v ${cls}">${UI.esc(String(v))}</div></div>`;
    }).join('');
  }

  function renderTrades() {
    const box = document.getElementById('simTrades');
    if (!box) return;
    if (!acc || !acc.trades.length) { box.textContent = '尚无成交'; return; }
    const rows = acc.trades.slice(-30).map(t => {
      const kind = t.type === 'BUY' ? '买入' : t.type === 'SELL' ? '卖出' : '平' + (t.type === 'COVER' ? '空' : '多');
      // 颜色：买入红、卖出绿
      const cls = (t.type === 'BUY') ? 'buy' : 'sell';
      const pnl = t.pnl !== undefined ? `${t.pnl >= 0 ? '+' : ''}${Number(t.pnl).toFixed(0)}` : '--';
      return `<div class="trade-row"><span>${UI.esc(UI.fmtTime(t.time))}</span>
        <span class="${cls}">${kind}</span>
        <span>@${UI.num(t.price)}</span>
        <span>${t.qty} 手 · 盈亏 ${pnl}</span></div>`;
    }).join('');
    box.innerHTML = rows;
  }

  function drawChart() {
    if (!window.echarts || !klines.length || !acc) return;
    const el = document.getElementById('simChart');
    if (!el) return;
    chart?.dispose();
    chart = echarts.init(el);

    const dates = klines.map(k => UI.fmtTime(k.time));
    const ohlc = klines.map(k => [Number(k.open), Number(k.close), Number(k.low), Number(k.high)]);

    // 买卖点散点（用 K 线 index 作 x，价格作 y）
    const buys = acc.marks.filter(m => m.type === 'BUY').map(m => ({
      value: [m.index, m.price], name: m.time,
      itemStyle: { color: '#ff4d6a' }
    }));
    const sells = acc.marks.filter(m => m.type === 'SELL').map(m => ({
      value: [m.index, m.price], name: m.time,
      itemStyle: { color: '#00d68f' }
    }));

    // 权益曲线（映射到价格轴附近可读性差，改放右侧独立 y 轴）
    const eq = acc.equity.map(p => p.equity);
    const eqStart = acc.equity.length ? acc.equity[0].time : null;
    const eqAligned = new Array(klines.length).fill(null);
    acc.equity.forEach(p => {
      const idx = klines.findIndex(k => String(k.time) === String(p.time));
      if (idx >= 0) eqAligned[idx] = Math.round(p.equity);
    });

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 58, right: 64, top: 26, bottom: 34 },
      legend: { data: ['权益'], right: 8, top: 2, textStyle: { color: '#9aa8c2', fontSize: 10 } },
      xAxis: {
        type: 'category', data: dates, boundaryGap: true,
        axisLine: { lineStyle: { color: '#1c2740' } }, axisLabel: { color: '#5a6884', fontSize: 10 }
      },
      yAxis: [
        { scale: true, name: '价格', axisLine: { lineStyle: { color: '#1c2740' } },
          splitLine: { lineStyle: { color: '#131a2c' } }, axisLabel: { color: '#5a6884', fontSize: 10 } },
        { scale: true, name: '权益', position: 'right', axisLine: { lineStyle: { color: '#1c2740' } },
          splitLine: { show: false }, axisLabel: { color: '#4d9fff', fontSize: 9 } }
      ],
      tooltip: {
        trigger: 'axis', backgroundColor: '#131a2c', borderColor: '#28344f',
        textStyle: { color: '#e8edf7', fontSize: 11 }
      },
      series: [
        {
          name: 'K线', type: 'candlestick', data: ohlc,
          itemStyle: { color: '#ff4d6a', color0: '#00d68f', borderColor: '#ff4d6a', borderColor0: '#00d68f' }
        },
        {
          name: '买入', type: 'scatter', data: buys, symbol: 'triangle', symbolSize: 13,
          itemStyle: { color: '#ff4d6a', borderColor: '#fff', borderWidth: 1 },
          label: { show: true, formatter: '买', position: 'bottom', color: '#ff4d6a', fontSize: 10, fontWeight: 700 }
        },
        {
          name: '卖出', type: 'scatter', data: sells, symbol: 'triangle', symbolRotate: 180, symbolSize: 13,
          itemStyle: { color: '#00d68f', borderColor: '#fff', borderWidth: 1 },
          label: { show: true, formatter: '卖', position: 'top', color: '#00d68f', fontSize: 10, fontWeight: 700 }
        },
        {
          name: '权益', type: 'line', yAxisIndex: 1, data: eqAligned, showSymbol: false,
          connectNulls: true, lineStyle: { width: 1.4, color: '#4d9fff', type: 'dashed' }
        }
      ]
    });
  }

  function refreshAll() {
    renderPos();
    renderTrades();
    drawChart();
  }

  /* ── 按策略执行 ── */
  async function run() {
    const st = document.getElementById('simStatus');
    const { code, period, endDate, qty, stratId, latest, dateVal } = readInputs();
    if (!code) { if (st) st.innerHTML = '<span style="color:var(--warn)">请先填写合约代码</span>'; return; }
    if (!loadKlines(code, period)) {
      if (st) st.innerHTML = `<span style="color:var(--warn)">本地无 ${UI.esc(code)} ${period} 缓存，请先在 K线详情页「⤓ 拉取K线(增量)」</span>`;
      UI.status('本地无K线缓存', 'err');
      return;
    }
    const code_ = strategyCodeOf(stratId);
    if (!code_) { if (st) st.innerHTML = '<span style="color:var(--warn)">请选择要执行的策略（可先在「策略」页用＋添加多套）</span>'; return; }

    if (st) st.innerHTML = '<span class="spin"></span>按策略推演中…';
    UI.status('模拟盘执行中…', 'warn');
    try {
      const r = await SimEngine.runStrategy(klines, code_, endDate, { qty, code, period });
      acc = r.account;
      persist();
      refreshAll();
      const label = latest ? '最新日期（全部数据）' : ('截至 ' + (dateVal || '最新'));
      if (st) st.innerHTML = `<span>✅ 已按策略执行（${UI.esc(label)}）· 买入 ${acc.marks.filter(m => m.type === 'BUY').length} 次 · 卖出 ${acc.marks.filter(m => m.type === 'SELL').length} 次</span>`;
      UI.status('模拟盘执行完成', '');
    } catch (err) {
      if (st) st.innerHTML = `<span style="color:var(--danger)">执行失败：${UI.esc(err.message)}</span>`;
      UI.status('模拟盘失败：' + err.message, 'err');
    }
  }

  /* 确保有账户 / 有K线 */
  function ensureBase() {
    const { code, period } = readInputs();
    if (!code) return false;
    if (curCode !== code || curPeriod !== period) {
      loadKlines(code, period);
      acc = restore(code, period) || SimEngine.newAccount({ code, period });
    }
    if (!acc) acc = SimEngine.newAccount({ code, period });
    return klines.length > 0;
  }

  /* ── 手动下单 ── */
  function manualOrder(type) {
    const st = document.getElementById('simStatus');
    if (!ensureBase()) {
      if (st) st.innerHTML = '<span style="color:var(--warn)">本地无K线缓存，请先拉取K线</span>';
      return;
    }
    const { qty } = readInputs();
    const idx = klines.length - 1;
    const r = SimEngine.manualOrder(acc, klines, idx, type, qty, '手动');
    if (!r.ok) { if (st) st.innerHTML = `<span style="color:var(--danger)">${UI.esc(r.error)}</span>`; return; }
    persist(); refreshAll();
    if (st) st.innerHTML = `<span>✅ 手动${type === 'BUY' ? '买入' : '卖出'} ${qty} 手 @ ${UI.num(klines[idx].close)}（${UI.esc(klines[idx].time)}）</span>`;
  }

  function closeOrder() {
    const st = document.getElementById('simStatus');
    if (!ensureBase()) { if (st) st.innerHTML = '<span style="color:var(--warn)">本地无K线缓存</span>'; return; }
    const r = SimEngine.closePosition(acc, klines, klines.length - 1);
    if (!r.ok) { if (st) st.innerHTML = `<span style="color:var(--warn)">${UI.esc(r.error)}</span>`; return; }
    persist(); refreshAll();
    if (st) st.innerHTML = '<span>✅ 已平仓</span>';
  }

  function reset() {
    const { code, period } = readInputs();
    acc = SimEngine.newAccount({ code: code || curCode, period: period || curPeriod });
    persist();
    refreshAll();
    const st = document.getElementById('simStatus');
    if (st) st.innerHTML = '<span>↺ 模拟盘已重置（资金回到初始）</span>';
  }

  window.SimView = { run, manualOrder, closeOrder, reset, loadStrategies };

  RouteRegistry.register('sim-run', run);
  RouteRegistry.register('sim-reset', reset);
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
      chart?.resize();
    }
  });
  window.addEventListener('resize', () => chart?.resize());
})();
