/* ═══ 模块：模拟盘「纯渲染」层 ═══
   从 views/sim.js 拆出（2026-09-22 模块化）：
     - 本文件只做「数据 → HTML / ECharts option」的转换，**纯函数、不碰 DOM、不碰状态**
     - DOM 读写、状态与事件全部留在 views/sim.js（控制器）
   好处：渲染可单独验证（node 里直接调即可），控制器不会因为改样式而碰坏逻辑。

   【对外契约】window.SimRender
     posHtml(summary)              → 持仓总览的 HTML
     tradesHtml(trades)            → 成交记录的 HTML
     chartOption(klines, account)  → ECharts setOption 用的 option 对象
     allResultHtml(rows, code)     → 「对比模拟」结果区 HTML（卡片带 data-sim-pick）
   ================================================================= */
window.SimRender = (function () {
  'use strict';

  const BUY_COLOR = '#ff4d6a';   // 红涨
  const SELL_COLOR = '#00d68f';  // 绿跌
  const EQUITY_COLOR = '#4d9fff';

  function esc(s) { return (window.UI && UI.esc) ? UI.esc(s) : String(s == null ? '' : s); }
  function num(v, d) {
    if (window.UI && UI.num) return UI.num(v, d == null ? 2 : d);
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(d == null ? 2 : d) : '--';
  }
  function fmtTime(t) { return (window.UI && UI.fmtTime) ? UI.fmtTime(t) : String(t || '--'); }

  /* ── 持仓总览 ── */
  function posHtml(s) {
    if (!s) return '';
    const posTxt = s.position > 0 ? ('多头 ' + s.position + ' 手')
      : s.position < 0 ? ('空头 ' + Math.abs(s.position) + ' 手') : '空仓';
    const cells = [
      ['初始资金', num(s.initialCash, 0), ''],
      ['账户权益', num(s.equity, 0), ''],
      ['总收益', s.totalReturn, parseFloat(s.totalReturn) > 0 ? 'pos' : parseFloat(s.totalReturn) < 0 ? 'neg' : ''],
      ['持仓', posTxt, ''],
      ['持仓均价', s.position ? num(s.avgPrice) : '--', ''],
      ['已实现盈亏', num(s.realized, 0), s.realized > 0 ? 'pos' : s.realized < 0 ? 'neg' : ''],
      ['最大回撤', s.maxDrawdown, ''],
      ['胜率', s.winRate, '']
    ];
    return cells.map(function (c) {
      return '<div class="sim-cell"><div class="k">' + c[0] + '</div><div class="v ' + c[2] + '">' + esc(String(c[1])) + '</div></div>';
    }).join('');
  }

  /* ── 成交记录 ── */
  function tradesHtml(trades) {
    if (!trades || !trades.length) return '尚无成交';
    return trades.slice(-30).map(function (t) {
      const kind = t.type === 'BUY' ? '买入' : t.type === 'SELL' ? '卖出' : ('平' + (t.type === 'COVER' ? '空' : '多'));
      const cls = (t.type === 'BUY') ? 'buy' : 'sell';
      const pnl = t.pnl !== undefined ? ((t.pnl >= 0 ? '+' : '') + Number(t.pnl).toFixed(0)) : '--';
      return '<div class="trade-row"><span>' + esc(fmtTime(t.time)) + '</span>'
        + '<span class="' + cls + '">' + kind + '</span>'
        + '<span>@' + num(t.price) + '</span>'
        + '<span>' + t.qty + ' 手 · 盈亏 ' + pnl + '</span></div>';
    }).join('');
  }

  /* ── K线 + 买卖点 + 权益曲线 ── */
  function chartOption(klines, acc) {
    const dates = klines.map(function (k) { return fmtTime(k.time); });
    const ohlc = klines.map(function (k) { return [Number(k.open), Number(k.close), Number(k.low), Number(k.high)]; });

    const marks = (acc && acc.marks) || [];
    const buys = marks.filter(function (m) { return m.type === 'BUY'; })
      .map(function (m) { return { value: [m.index, m.price], name: m.time, itemStyle: { color: BUY_COLOR } }; });
    const sells = marks.filter(function (m) { return m.type === 'SELL'; })
      .map(function (m) { return { value: [m.index, m.price], name: m.time, itemStyle: { color: SELL_COLOR } }; });

    // 权益曲线对齐到 K 线下标（独立右轴，避免压扁价格轴）
    const eqAligned = new Array(klines.length).fill(null);
    ((acc && acc.equity) || []).forEach(function (p) {
      const idx = klines.findIndex(function (k) { return String(k.time) === String(p.time); });
      if (idx >= 0) eqAligned[idx] = Math.round(p.equity);
    });

    return {
      backgroundColor: 'transparent',
      grid: { left: 58, right: 64, top: 26, bottom: 34 },
      legend: { data: ['权益'], right: 8, top: 2, textStyle: { color: '#9aa8c2', fontSize: 10 } },
      xAxis: {
        type: 'category', data: dates, boundaryGap: true,
        axisLine: { lineStyle: { color: '#1c2740' } }, axisLabel: { color: '#5a6884', fontSize: 10 }
      },
      yAxis: [
        {
          scale: true, name: '价格', axisLine: { lineStyle: { color: '#1c2740' } },
          splitLine: { lineStyle: { color: '#131a2c' } }, axisLabel: { color: '#5a6884', fontSize: 10 }
        },
        {
          scale: true, name: '权益', position: 'right', axisLine: { lineStyle: { color: '#1c2740' } },
          splitLine: { show: false }, axisLabel: { color: EQUITY_COLOR, fontSize: 9 }
        }
      ],
      tooltip: {
        trigger: 'axis', backgroundColor: '#131a2c', borderColor: '#28344f',
        textStyle: { color: '#e8edf7', fontSize: 11 }
      },
      series: [
        {
          name: 'K线', type: 'candlestick', data: ohlc,
          itemStyle: { color: BUY_COLOR, color0: SELL_COLOR, borderColor: BUY_COLOR, borderColor0: SELL_COLOR }
        },
        {
          name: '买入', type: 'scatter', data: buys, symbol: 'triangle', symbolSize: 13,
          itemStyle: { color: BUY_COLOR, borderColor: '#fff', borderWidth: 1 },
          label: { show: true, formatter: '买', position: 'bottom', color: BUY_COLOR, fontSize: 10, fontWeight: 700 }
        },
        {
          name: '卖出', type: 'scatter', data: sells, symbol: 'triangle', symbolRotate: 180, symbolSize: 13,
          itemStyle: { color: SELL_COLOR, borderColor: '#fff', borderWidth: 1 },
          label: { show: true, formatter: '卖', position: 'top', color: SELL_COLOR, fontSize: 10, fontWeight: 700 }
        },
        {
          name: '权益', type: 'line', yAxisIndex: 1, data: eqAligned, showSymbol: false,
          connectNulls: true, lineStyle: { width: 1.4, color: EQUITY_COLOR, type: 'dashed' }
        }
      ]
    };
  }

  function toNum(v) {
    const n = parseFloat(String(v == null ? '' : v).replace('%', ''));
    return Number.isFinite(n) ? n : null;
  }

  /* ── 对比模拟结果区 ──
     卡片点击改为 data-sim-pick 属性 + 容器事件委托（不再内联 onclick 拼字符串，避免名称里的引号炸页面） */
  function allResultHtml(rows, code) {
    const ok = rows.filter(function (x) { return x.ok; });
    let bestRet = null, bestName = '';
    ok.forEach(function (x) {
      const v = toNum(x.sum.totalReturn);
      if (v != null && (bestRet == null || v > bestRet)) { bestRet = v; bestName = x.name; }
    });

    const head = '<div class="stats" style="margin-top:12px">'
      + '<div class="stat"><div class="k">策略数</div><div class="v">' + rows.length + '</div></div>'
      + '<div class="stat"><div class="k">合约</div><div class="v" style="font-size:13px">' + esc(code) + '</div></div>'
      + '<div class="stat"><div class="k">最优</div><div class="v" style="font-size:13px">' + (bestName ? esc(bestName) : '--') + '</div></div>'
      + '</div>';

    const cards = rows.map(function (x, i) {
      if (!x.ok) {
        return '<div class="cmp-res"><div class="t">' + esc(x.name) + '</div>'
          + '<div class="line" style="color:var(--danger)">失败：' + esc(x.error) + '</div></div>';
      }
      const s = x.sum;
      const isBest = bestName === x.name && bestRet != null;
      const ret = toNum(s.totalReturn);
      return '<div class="cmp-res" style="cursor:pointer" data-sim-pick="' + i + '">'
        + '<div class="t">' + esc(x.name) + (isBest ? ' 🏆' : '') + '</div>'
        + '<div class="line"><span>总收益</span><b class="' + (ret > 0 ? 'win' : ret < 0 ? 'lose' : '') + '">' + s.totalReturn + '</b></div>'
        + '<div class="line"><span>买入/卖出</span><b>' + s.buys + ' / ' + s.sells + '</b></div>'
        + '<div class="line"><span>胜率</span><b>' + s.winRate + '</b></div>'
        + '<div class="line"><span>最大回撤</span><b>' + s.maxDrawdown + '</b></div>'
        + '</div>';
    }).join('');

    return head + '<div class="cmp-results">' + cards + '</div>'
      + '<div class="note" style="margin-top:8px"><span>点任意一张卡片，可把该策略的买卖点、成交记录与权益曲线一起画到上面的K线。</span></div>';
  }

  return { posHtml: posHtml, tradesHtml: tradesHtml, chartOption: chartOption, allResultHtml: allResultHtml };
})();
