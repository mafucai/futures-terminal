/* =============================================
   views/detail.js — K线详情页
   RouteRegistry: open-detail/back-to-list/load-chart/switch-period
   ============================================= */
window.DetailView = (function () {
  let currentCode = 'agm';
  let currentPeriod = 101;
  let chart = null, volChart = null, macdChart = null;

  const PERIODS = [
    { id: 1, label: '分时' },
    { id: 101, label: '日线' },
    { id: 240, label: '4小时' },
    { id: 60, label: '60分' },
    { id: 30, label: '30分' },
    { id: 15, label: '15分' },
    { id: 5, label: '5分' },
  ];

  function openDetail(code) {
    currentCode = code;
    RouteRegistry.navigate('pageDetail', { code });
  }

  function renderPeriodButtons() {
    const bar = document.getElementById('periodBar');
    bar.innerHTML = PERIODS.map(p => `<button class="btn btn-secondary btn-p${p.id === currentPeriod ? ' active' : ''}" data-period="${p.id}">${p.label}</button>`).join('');
    bar.querySelectorAll('.btn-p').forEach(b => {
      b.onclick = () => switchPeriod(parseInt(b.dataset.period));
    });
  }

  function switchPeriod(p) {
    currentPeriod = p;
    renderPeriodButtons();
    loadChart(currentCode, p, false);
  }

  async function loadChart(code, period, refresh) {
    const indBar = document.getElementById('indBar');
    indBar.innerHTML = '<span class="loading"></span> 加载中...';
    try {
      const j = await window.API.getKline(code, period, 200, refresh);
      document.getElementById('detailTitle').textContent = `${j.name} (${code})${j.cached ? ' 📦' : ' 🌐'}`;
      document.getElementById('indBar').innerHTML = `${j.cached ? '📦 缓存数据' : '🌐 实时数据'} · 数据时间:${window.UI.fmtTime(j.time)}${j.cached && window.UI.isStale(j.time, 120) ? ' ⚠️已超2小时' : ''}`;
      renderChart(j);
      renderPriceMatrix(j);
    } catch (e) {
      indBar.textContent = '❌ ' + e.message;
    }
  }

  function renderPriceMatrix(j) {
    const k = j.klines;
    const last = k[k.length - 1];
    const pre = k[k.length - 2];
    const chg = pre ? (last.close - pre.close) : 0;
    const chgPct = pre ? (chg / pre.close * 100) : 0;
    const ind = j.indicators;
    const i = k.length - 1;
    const matrix = [
      { label: '最新价', value: last.close.toFixed(2) },
      { label: '涨跌', value: (chg >= 0 ? '+' : '') + chg.toFixed(2), cls: chg >= 0 ? 'rise' : 'fall' },
      { label: '涨跌幅', value: (chgPct >= 0 ? '+' : '') + chgPct.toFixed(2) + '%', cls: chgPct >= 0 ? 'rise' : 'fall' },
      { label: '今开', value: last.open.toFixed(2) },
      { label: '最高', value: last.high.toFixed(2) },
      { label: '最低', value: last.low.toFixed(2) },
      { label: 'MA20', value: ind.ma20[i] ? ind.ma20[i].toFixed(2) : '-' },
      { label: 'RSI14', value: ind.rsi14[i] ? ind.rsi14[i].toFixed(1) : '-' },
      { label: 'MACD', value: ind.macd.hist[i] ? ind.macd.hist[i].toFixed(2) : '-' },
      { label: 'ATR', value: ind.atr[i] ? ind.atr[i].toFixed(2) : '-' },
    ];
    document.getElementById('priceMatrix').innerHTML = matrix.map(m =>
      `<div class="price-item"><div class="label">${m.label}</div><div class="value ${m.cls || ''}">${m.value}</div></div>`
    ).join('');
  }

  function renderChart(data) {
    const k = data.klines;
    const ind = data.indicators;
    const dates = k.map(x => x.time);
    const ohlc = k.map(x => [x.open, x.close, x.low, x.high]);
    const vc = k.map(x => x.close >= x.open ? 'rgba(244,63,94,0.6)' : 'rgba(34,197,94,0.6)');

    const main = document.getElementById('chart');
    const vol = document.getElementById('volChart');
    const macdEl = document.getElementById('macdChart');
    if (!chart) chart = echarts.init(main);
    if (!volChart) volChart = echarts.init(vol);
    if (!macdChart) macdChart = echarts.init(macdEl);

    const baseOpt = {
      backgroundColor: 'transparent', animation: false,
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'cross' },
        backgroundColor: '#111827', borderColor: '#1e2d4a', textStyle: { color: '#e2e8f0', fontSize: 12 },
        formatter: function (p) {
          const i = p[0].dataIndex; const l = k[i];
          let s = `<b>${l.time}</b><br/>开:${l.open} 收:${l.close} 高:${l.high} 低:${l.low}<br/>量:${l.volume}`;
          if (ind.macd.dif[i] !== undefined && ind.macd.dif[i] !== null) s += `<br/>MACD DIF:${ind.macd.dif[i].toFixed(2)} DEA:${ind.macd.dea[i].toFixed(2)} 柱:${ind.macd.hist[i].toFixed(2)}`;
          if (ind.rsi14[i] !== undefined && ind.rsi14[i] !== null) s += `<br/>RSI:${ind.rsi14[i].toFixed(2)}`;
          if (ind.kdj.k[i] !== undefined && ind.kdj.k[i] !== null) s += ` KDJ:${ind.kdj.k[i].toFixed(2)}/${ind.kdj.d[i].toFixed(2)}/${ind.kdj.j[i].toFixed(2)}`;
          if (ind.boll.upper[i] !== undefined && ind.boll.upper[i] !== null) s += `<br/>BOLL:${ind.boll.upper[i].toFixed(2)}/${ind.boll.mid[i].toFixed(2)}/${ind.boll.lower[i].toFixed(2)}`;
          return s;
        }
      },
      legend: { show: true, textStyle: { color: '#8892a6' }, data: ['K线','MA5','MA10','MA20','MA60','BOLL上','BOLL中','BOLL下'] },
    };

    chart.setOption({
      ...baseOpt,
      grid: [{ left: 60, right: 20, top: 20, height: '68%' }],
      xAxis: [{ type: 'category', data: dates, gridIndex: 0, axisLine: { lineStyle: { color: '#1e2d4a' } }, axisLabel: { color: '#8892a6', fontSize: 10 } }],
      yAxis: [{ scale: true, gridIndex: 0, axisLine: { lineStyle: { color: '#1e2d4a' } }, splitLine: { lineStyle: { color: 'rgba(30,45,74,0.3)' } }, axisLabel: { color: '#8892a6', fontSize: 10 } }],
      dataZoom: [{ type: 'inside', start: 30, end: 100 }, { type: 'slider', bottom: 0, height: 18, borderColor: '#1e2d4a' }],
      series: [
        { name: 'K线', type: 'candlestick', data: ohlc, itemStyle: { color: '#f43f5e', color0: '#22c55e', borderColor: '#f43f5e', borderColor0: '#22c55e' } },
        { name: 'MA5', type: 'line', data: ind.ma5, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#f59e0b' } },
        { name: 'MA10', type: 'line', data: ind.ma10, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#3b82f6' } },
        { name: 'MA20', type: 'line', data: ind.ma20, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#a855f7' } },
        { name: 'MA60', type: 'line', data: ind.ma60, smooth: true, showSymbol: false, lineStyle: { width: 1, color: '#06b6d4' } },
        { name: 'BOLL上', type: 'line', data: ind.boll.upper, showSymbol: false, lineStyle: { width: 1, color: '#64748b', type: 'dashed' } },
        { name: 'BOLL中', type: 'line', data: ind.boll.mid, showSymbol: false, lineStyle: { width: 1, color: '#94a3b8', type: 'dashed' } },
        { name: 'BOLL下', type: 'line', data: ind.boll.lower, showSymbol: false, lineStyle: { width: 1, color: '#64748b', type: 'dashed' } },
      ]
    }, true);

    volChart.setOption({
      backgroundColor: 'transparent', animation: false,
      grid: [{ left: 60, right: 20, top: 10, bottom: 10 }],
      xAxis: [{ type: 'category', data: dates, show: false }],
      yAxis: [{ scale: true, axisLabel: { color: '#8892a6', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(30,45,74,0.2)' } } }],
      series: [{ name: '成交量', type: 'bar', data: k.map(x => x.volume), itemStyle: { color: function(p) { return vc[p.dataIndex]; } } }]
    }, true);

    macdChart.setOption({
      backgroundColor: 'transparent', animation: false,
      grid: [{ left: 60, right: 20, top: 10, bottom: 10 }],
      xAxis: [{ type: 'category', data: dates, show: false }],
      yAxis: [{ scale: true, axisLabel: { color: '#8892a6', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(30,45,74,0.2)' } } }],
      series: [
        { name: 'MACD柱', type: 'bar', data: ind.macd.hist, itemStyle: { color: function(p) { return p.data >= 0 ? '#f43f5e' : '#22c55e'; } } },
        { name: 'DIF', type: 'line', data: ind.macd.dif, showSymbol: false, lineStyle: { width: 1, color: '#f59e0b' } },
        { name: 'DEA', type: 'line', data: ind.macd.dea, showSymbol: false, lineStyle: { width: 1, color: '#3b82f6' } },
      ]
    }, true);
  }

  // 注册路由
  RouteRegistry.register('open-detail', (code) => openDetail(code));
  RouteRegistry.register('back-to-list', () => RouteRegistry.navigate('pageList'));
  RouteRegistry.register('load-chart', (p) => loadChart(currentCode, p.period || 101, p.refresh || false));
  RouteRegistry.register('switch-period', (p) => switchPeriod(p.period));

  RouteRegistry.registerPage('pageDetail', {
    onEnter: (payload) => {
      if (payload && payload.code) currentCode = payload.code;
      renderPeriodButtons();
      loadChart(currentCode, currentPeriod, false);
    }
  });

  return { openDetail, switchPeriod, loadChart };
})();