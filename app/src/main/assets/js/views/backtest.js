/* ═══ 视图：回测 ═══ */
(function () {
  'use strict';

  let equityChart = null;

  function renderResult(r) {
    const box = document.getElementById('btResult');
    if (!box) return;
    const s = r && r.summary ? r.summary : r;
    if (!s) { box.innerHTML = ''; return; }
    const ret = parseFloat(s.totalReturn) || 0;
    const stats = [
      ['总收益', s.totalReturn || UI.num(ret) + '%', ret > 0 ? 'pos' : ret < 0 ? 'neg' : ''],
      ['交易次数', s.totalTrades != null ? s.totalTrades : '--', ''],
      ['胜率', s.winRate || '--', ''],
      ['最大回撤', s.maxDrawdown || '--', ''],
      ['盈亏比', s.profitFactor != null ? s.profitFactor : '--', ''],
      ['夏普', s.sharpeRatio || '--', '']
    ];
    box.innerHTML = `<div class="stats">${stats.map(([k, v, c]) =>
      `<div class="stat"><div class="k">${k}</div><div class="v ${c}">${UI.esc(String(v))}</div></div>`).join('')}</div>`;
  }

  function drawEquity(curve) {
    if (!window.echarts || !Array.isArray(curve) || !curve.length) return;
    const el = document.getElementById('btChart');
    if (!el) return;
    equityChart?.dispose();
    equityChart = echarts.init(el);
    const data = curve.map(p => (p && typeof p === 'object') ? p.equity : p);
    equityChart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 62, right: 14, top: 14, bottom: 22 },
      xAxis: { type: 'category', data: data.map((_, i) => i), axisLabel: { show: false }, axisLine: { lineStyle: { color: '#1c2740' } } },
      yAxis: { scale: true, axisLabel: { color: '#5a6884', fontSize: 10 }, splitLine: { lineStyle: { color: '#131a2c' } } },
      tooltip: { trigger: 'axis', backgroundColor: '#131a2c', borderColor: '#28344f', textStyle: { color: '#e8edf7', fontSize: 11 } },
      series: [{
        type: 'line', data, showSymbol: false, smooth: true,
        lineStyle: { width: 1.6, color: '#4d9fff' },
        areaStyle: { color: 'rgba(77,159,255,.12)' }
      }]
    });
  }

  async function runBacktest() {
    const code = document.getElementById('btCode')?.value.trim();
    const period = Number(document.getElementById('btPeriod')?.value || 101);
    const limit = Number(document.getElementById('btLimit')?.value || 200);
    const multi = document.getElementById('btMulti')?.checked || false;
    const st = document.getElementById('btStatus');

    if (!code) { if (st) st.innerHTML = '<span style="color:var(--warn)">请先填写合约代码</span>'; return; }
    if (st) st.innerHTML = '<span class="spin"></span>回测运行中…';
    UI.status('回测运行中…', 'warn');
    try {
      const data = await API.backtest({ code, period, multi, limit });
      renderResult(data?.summary ? data : data);
      drawEquity(data?.equityCurve || data?.equity || data?.curve || []);
      if (st) st.innerHTML = `✅ 回测完成 · ${UI.esc(code)}（${multi ? '多周期' : '单周期'}）`;
      UI.status('回测完成', '');
    } catch (err) {
      if (st) st.innerHTML = `<span style="color:var(--danger)">回测失败：${UI.esc(err.message)}</span>`;
      UI.status('回测失败：' + err.message, 'err');
    }
  }

  window.BacktestView = { runBacktest };

  RouteRegistry.register('run-backtest', runBacktest);
  RouteRegistry.register('backtest-code', p => {
    const inp = document.getElementById('btCode');
    if (inp && p?.code) inp.value = p.code;
    RouteRegistry.navigate('vBacktest');
  });
  RouteRegistry.registerPage('vBacktest', { onEnter: () => equityChart?.resize() });
})();
