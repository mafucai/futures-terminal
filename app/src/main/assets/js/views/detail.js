/* ═══ 视图：K线详情 ═══ */
(function () {
  'use strict';

  const PERIODS = [
    { v: 101, t: '日线' }, { v: 240, t: '4H' }, { v: 60, t: '60分' },
    { v: 30, t: '30分' }, { v: 15, t: '15分' }, { v: 5, t: '5分' }, { v: 1, t: '1分' }
  ];
  let charts = { main: null, vol: null, macd: null };
  let currentLabel = '';

  function open(code, period) {
    window.currentCode = code;
    window.currentPeriod = period || window.currentPeriod || 60;
    RouteRegistry.navigate('vDetail');
    renderPeriodBar();
    loadChart(code, window.currentPeriod, false);
  }

  function renderPeriodBar() {
    const bar = document.getElementById('periodBar');
    if (!bar) return;
    bar.innerHTML = PERIODS.map(p =>
      `<button class="btn btn-g btn-xs${p.v === window.currentPeriod ? ' on' : ''}" data-p="${p.v}">${p.t}</button>`
    ).join('');
    bar.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => loadChart(window.currentCode, Number(b.dataset.p), true));
    });
  }

  function renderMatrix(q, ind) {
    const box = document.getElementById('priceMatrix');
    if (!box) return;
    const items = [
      ['最新', UI.num(q.last ?? q.close)], ['开盘', UI.num(q.open)],
      ['最高', UI.num(q.high)], ['最低', UI.num(q.low)],
      ['成交量', UI.num(q.volume, 0)], ['持仓量', UI.num(q.openInterest ?? q.hold, 0)]
    ];
    box.innerHTML = items.map(([k, v]) => `<div class="mx"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    const indBar = document.getElementById('indBar');
    if (indBar && ind) {
      indBar.innerHTML = Object.entries(ind).slice(0, 8)
        .map(([k, v]) => `<span>${UI.esc(k)}: <b style="color:var(--t1)">${UI.num(v)}</b></span>`).join('');
    }
  }

  function drawCharts(klines, ind) {
    if (!window.echarts) return;

    // 主图（K线）
    const mainEl = document.getElementById('chart');
    charts.main?.dispose();
    charts.main = echarts.init(mainEl, null, { renderer: 'canvas' });
    const dates = klines.map(k => UI.fmtTime(k.time));
    const ohlc = klines.map(k => [Number(k.open), Number(k.close), Number(k.low), Number(k.high)]);
    charts.main.setOption({
      backgroundColor: 'transparent',
      grid: { left: 58, right: 16, top: 20, bottom: 30 },
      xAxis: { type: 'category', data: dates, axisLine: { lineStyle: { color: '#1c2740' } }, axisLabel: { color: '#5a6884', fontSize: 10 } },
      yAxis: { scale: true, axisLine: { lineStyle: { color: '#1c2740' } }, splitLine: { lineStyle: { color: '#131a2c' } }, axisLabel: { color: '#5a6884', fontSize: 10 } },
      tooltip: { trigger: 'axis', backgroundColor: '#131a2c', borderColor: '#28344f', textStyle: { color: '#e8edf7', fontSize: 11 } },
      series: [{
        type: 'candlestick', data: ohlc,
        itemStyle: { color: '#ff4d6a', color0: '#00d68f', borderColor: '#ff4d6a', borderColor0: '#00d68f' }
      }]
    });

    // 成交量
    const volEl = document.getElementById('volChart');
    charts.vol?.dispose();
    charts.vol = echarts.init(volEl);
    charts.vol.setOption({
      backgroundColor: 'transparent',
      grid: { left: 58, right: 16, top: 8, bottom: 18 },
      xAxis: { type: 'category', data: dates, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#1c2740' } } },
      yAxis: { axisLabel: { color: '#5a6884', fontSize: 9 }, splitLine: { lineStyle: { color: '#131a2c' } } },
      series: [{
        type: 'bar', data: klines.map(k => Number(k.volume) || 0),
        itemStyle: { color: 'rgba(77,159,255,.45)' }
      }]
    });

    // MACD
    const macdEl = document.getElementById('macdChart');
    charts.macd?.dispose();
    charts.macd = echarts.init(macdEl);
    const dif = ind?.DIF || ind?.dif || [];
    const dea = ind?.DEA || ind?.dea || [];
    const macd = ind?.MACD || ind?.macd || [];
    charts.macd.setOption({
      backgroundColor: 'transparent',
      grid: { left: 58, right: 16, top: 8, bottom: 18 },
      xAxis: { type: 'category', data: dates, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#1c2740' } } },
      yAxis: { axisLabel: { color: '#5a6884', fontSize: 9 }, splitLine: { lineStyle: { color: '#131a2c' } } },
      series: [
        { type: 'bar', data: macd, itemStyle: { color: p => Number(p.value) >= 0 ? '#ff4d6a' : '#00d68f' } },
        { type: 'line', data: dif, showSymbol: false, lineStyle: { width: 1, color: '#4d9fff' } },
        { type: 'line', data: dea, showSymbol: false, lineStyle: { width: 1, color: '#ffb020' } }
      ]
    });
  }

  async function loadChart(code, period, force) {
    if (!code) return;
    window.currentPeriod = period;
    currentLabel = code;
    const title = document.getElementById('detailTitle');
    if (title) title.textContent = `K线详情 · ${code}`;
    renderPeriodBar();
    UI.status('正在加载K线…', 'warn');
    try {
      const data = await API.kline(code, period, 200);
      const klines = Array.isArray(data) ? data : (data?.klines || data?.data || []);
      const ind = data?.indicators || {};
      if (!klines.length) throw new Error('无K线数据（缓存为空，先运行增量更新）');
      renderMatrix(klines[klines.length - 1] || {}, ind);
      drawCharts(klines, ind);
      UI.status(`${code} · ${klines.length} 根K线`, '');
    } catch (err) {
      UI.status('K线加载失败：' + err.message, 'err');
      const box = document.getElementById('chart');
      if (box) box.innerHTML = `<div class="blank"><div class="em">⚠️</div><div class="tx">${UI.esc(err.message)}</div></div>`;
    }
  }

  window.DetailView = { open, loadChart };

  RouteRegistry.registerPage('vDetail', { onEnter: () => { charts.main?.resize(); charts.vol?.resize(); charts.macd?.resize(); } });
  window.addEventListener('resize', () => { charts.main?.resize(); charts.vol?.resize(); charts.macd?.resize(); });
})();
