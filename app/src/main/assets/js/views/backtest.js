/* =============================================
   views/backtest.js — 回测页
   RouteRegistry: run-backtest
   ============================================= */
window.BacktestView = (function () {
  // 已保存策略缓存（避免每次重复请求）
  let cachedStrategy = null;

  // 确保策略已加载：回测页进入时或点击运行前自动从后端拉取
  async function ensureStrategy() {
    if (cachedStrategy) return cachedStrategy;
    try {
      const j = await window.API.getStrategy();
      cachedStrategy = j.content || '';
      // 同步到编辑器（如果编辑器是空的）
      const editor = document.getElementById('strategyEditor');
      if (editor && !editor.value.trim()) editor.value = cachedStrategy;
      return cachedStrategy;
    } catch (e) {
      return '';
    }
  }

  async function runBacktest() {
    const code = document.getElementById('btCode').value.trim() || 'agm';
    const period = parseInt(document.getElementById('btPeriod').value) || 101;
    const limit = parseInt(document.getElementById('btLimit').value) || 200;
    // 多周期开关（兼容旧HTML无此控件）
    const multiEl = document.getElementById('btMulti');
    const multi = multiEl ? multiEl.checked : true;
    const result = document.getElementById('btResult');
    const status = document.getElementById('btStatus');
    const chartEl = document.getElementById('btChart');

    // 策略来源：编辑器 > 已保存文件
    let content = document.getElementById('strategyEditor').value.trim();
    if (!content) content = await ensureStrategy();

    if (!content.trim()) { result.innerHTML = '<span style="color:var(--rise)">策略为空，请先到「策略」页编写并保存策略</span>'; return; }
    result.innerHTML = '<span class="loading"></span> 回测进行中...';
    status.innerHTML = '<span class="loading"></span> ' + (multi ? '拉取4H+1H K线并计算...' : '拉取K线并计算...');
    try {
      const j = await window.API.backtest(code, period, limit, content, {}, multi);
      renderReport(j, result, chartEl);
      status.innerHTML = `<span style="color:var(--fall)">✅ 完成 · ${window.UI.esc(j.code)} · ${multi ? '多周期(4H+1H)' : j.period + '周期'} · ${j.totalBars}根K线</span>`;
    } catch (e) {
      result.innerHTML = `<span style="color:var(--rise)">❌ ${window.UI.esc(e.message)}</span>`;
      status.innerHTML = `<span style="color:var(--rise)">失败</span>`;
    }
  }

  function renderReport(j, resultEl, chartEl) {
    const s = j.summary;
    const items = [
      { label: '总收益率', value: s.totalReturn, cls: parseFloat(s.totalReturn) >= 0 ? 'positive' : 'negative' },
      { label: '最终资金', value: s.finalEquity },
      { label: '交易次数', value: s.totalTrades },
      { label: '胜率', value: s.winRate },
      { label: '最大回撤', value: s.maxDrawdown, cls: 'negative' },
      { label: '夏普', value: s.sharpeRatio },
      { label: '盈亏比', value: s.profitFactor },
      { label: '盈利笔数', value: s.winTrades },
      { label: '亏损笔数', value: s.loseTrades },
    ];
    let html = `<div class="summary-grid">`;
    items.forEach(it => {
      html += `<div class="summary-item"><div class="label">${it.label}</div><div class="value ${it.cls || ''}">${it.value}</div></div>`;
    });
    html += '</div>';

    // 最近交易
    if (j.trades && j.trades.length) {
      html += `<div class="card-title" style="margin:12px 0 8px">最近交易</div><table style="width:100%;font-size:12px;border-collapse:collapse;font-family:var(--font-mono)"><tr style="color:var(--text-dim);border-bottom:1px solid var(--border)">`;
      html += `<th style="padding:6px;text-align:left">时间</th><th style="padding:6px">方向</th><th style="padding:6px">价格</th><th style="padding:6px">盈亏</th></tr>`;
      j.trades.slice(-10).reverse().forEach(t => {
        const pnl = t.pnl !== undefined ? t.pnl.toFixed(2) : '-';
        const pnlCls = t.pnl > 0 ? 'var(--rise)' : (t.pnl < 0 ? 'var(--fall)' : 'var(--text-dim)');
        html += `<tr style="border-bottom:1px solid rgba(30,45,74,0.3)"><td style="padding:6px">${t.time}</td><td style="padding:6px;text-align:center">${t.type}</td><td style="padding:6px;text-align:center">${t.price}</td><td style="padding:6px;text-align:center;color:${pnlCls}">${pnl}</td></tr>`;
      });
      html += '</table>';
    }

    resultEl.innerHTML = html;

    // 净值曲线
    if (j.equityCurve && j.equityCurve.length > 1 && typeof echarts !== 'undefined') {
      const dates = j.equityCurve.map(e => e.time);
      const equ = j.equityCurve.map(e => Math.round(e.equity * 100) / 100);
      if (!window._btChart) window._btChart = echarts.init(chartEl);
      window._btChart.setOption({
        backgroundColor: 'transparent', animation: false,
        grid: { left: 60, right: 20, top: 20, bottom: 30 },
        xAxis: { type: 'category', data: dates, axisLabel: { color: '#8892a6', fontSize: 10 } },
        yAxis: { scale: true, splitLine: { lineStyle: { color: 'rgba(30,45,74,0.3)' } }, axisLabel: { color: '#8892a6', fontSize: 10 } },
        tooltip: { trigger: 'axis', backgroundColor: '#111827', borderColor: '#1e2d4a', textStyle: { color: '#e2e8f0' } },
        series: [{ type: 'line', data: equ, showSymbol: false, lineStyle: { width: 2, color: '#06b6d4' },
          areaStyle: { color: 'rgba(6,182,212,0.1)' } }]
      }, true);
    }
  }

  RouteRegistry.register('run-backtest', () => runBacktest());

  RouteRegistry.registerPage('pageBacktest', {
    onEnter: () => {
      // 默认回测合约
      const code = document.getElementById('btCode');
      if (!code.value) code.value = 'agm';
      // 自动加载已保存策略（打通策略与回测）
      ensureStrategy();
    }
  });

  return { runBacktest };
})();