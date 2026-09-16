/* =============================================
   backtest.js — 回测引擎（浏览器版）
   移植自 server/backtest.js
   ============================================= */
window.Backtest = (function () {
  'use strict';
  const SR = window.StrategyRunner;

  class BacktestConfig {
    constructor({ initialCash = 100000, slippagePct = 0.01, commissionPct = 0.003,
                  multiplier = 15, marginPct = 10 } = {}) {
      this.initialCash = initialCash;
      this.slippagePct = slippagePct;
      this.commissionPct = commissionPct;
      this.multiplier = multiplier;
      this.marginPct = marginPct;
    }
  }

  async function runBacktest(klines, strategyCode, config = {}) {
    const cfg = new BacktestConfig(config);
    const strategy = SR.compileStrategy(strategyCode);
    const ctx = SR.createContext({ cash: cfg.initialCash });
    ctx.multiplier = cfg.multiplier;
    const equityCurve = [{ cash: cfg.initialCash, equity: cfg.initialCash }];

    for (let i = 0; i < klines.length; i++) {
      const k = klines[i];
      ctx.history.push(k);
      if (i === 0) continue;
      const prevK = klines[i - 1];
      const signal = await SR.runStrategy(strategy, prevK, ctx);
      _executeSignal(signal, k, ctx, cfg);
      _recordEquity(ctx, k, equityCurve);
    }
    _closeFinal(ctx, klines, cfg);
    return generateReport(ctx, equityCurve, cfg);
  }

  async function runMultiPeriodBacktest(klines4h, klines1h, strategyCode, config = {}) {
    const cfg = new BacktestConfig(config);
    const strategy = SR.compileStrategy(strategyCode);
    const ctx = SR.createContext({ cash: cfg.initialCash });
    ctx.multiplier = cfg.multiplier;
    const equityCurve = [{ cash: cfg.initialCash, equity: cfg.initialCash }];

    klines4h = klines4h.map(k => ({ ...k, period: '4H' }));
    klines1h = klines1h.map(k => ({ ...k, period: '1H' }));
    const allBars = _mergeTimeline(klines4h, klines1h);

    for (let i = 0; i < allBars.length; i++) {
      const k = allBars[i];
      ctx.history.push(k);
      if (k.period !== '1H') continue;
      if (i === 0) continue;
      let prevIdx = i - 1;
      while (prevIdx >= 0 && allBars[prevIdx].period !== '1H') prevIdx--;
      if (prevIdx < 0) continue;
      const prevK = allBars[prevIdx];
      const signal = await SR.runStrategy(strategy, prevK, ctx);
      _executeSignal(signal, k, ctx, cfg);
      _recordEquity(ctx, k, equityCurve);
    }

    const last1h = [...allBars].reverse().find(k => k.period === '1H');
    if (last1h && ctx.position !== 0) {
      const pnl = (ctx.position > 0
        ? (last1h.close - ctx.avgPrice) * ctx.position
        : (ctx.avgPrice - last1h.close) * Math.abs(ctx.position)) * cfg.multiplier;
      ctx.cash += pnl;
      ctx.trades.push({ time: last1h.time, type: 'CLOSE', price: last1h.close, qty: Math.abs(ctx.position), pnl });
      ctx.position = 0;
    }
    return generateReport(ctx, equityCurve, cfg);
  }

  function _mergeTimeline(klines4h, klines1h) {
    const map = new Map();
    for (const k of klines4h) map.set(k.time + '_4H', k);
    for (const k of klines1h) {
      const key = k.time + '_1H';
      if (!map.has(key)) map.set(key, k);
    }
    return [...map.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  function _executeSignal(signal, k, ctx, cfg) {
    if (!signal) return;
    const size = signal.size || 1;
    const execPrice = signal.type === 'BUY'
      ? k.open * (1 + cfg.slippagePct / 100)
      : k.open * (1 - cfg.slippagePct / 100);
    const commission = execPrice * cfg.multiplier * size * cfg.commissionPct / 100;
    const marginUsed = execPrice * cfg.multiplier * size * cfg.marginPct / 100;
    if (marginUsed > ctx.cash) {
      throw new Error(`资金不足：需保证金 ${Math.round(marginUsed)}，可用 ${Math.round(ctx.cash)}`);
    }
    const pnlFactor = cfg.multiplier;
    if (signal.type === 'BUY') {
      if (ctx.position < 0) {
        const pnl = (ctx.avgPrice - execPrice) * Math.abs(ctx.position) * pnlFactor;
        ctx.cash += pnl;
        ctx.trades.push({ time: k.time, type: 'COVER', price: execPrice, qty: Math.abs(ctx.position), pnl });
      }
      ctx.position = size;
      ctx.avgPrice = execPrice;
      ctx.cash -= commission;
      ctx.signals.push({ time: k.time, type: 'BUY', price: execPrice, reason: signal.reason || '', marginUsed });
      ctx.trades.push({ time: k.time, type: 'BUY', price: execPrice, qty: size, commission });
    } else if (signal.type === 'SELL') {
      if (ctx.position > 0) {
        const pnl = (execPrice - ctx.avgPrice) * ctx.position * pnlFactor;
        ctx.cash += pnl;
        ctx.trades.push({ time: k.time, type: 'SELL', price: execPrice, qty: ctx.position, pnl });
      }
      ctx.position = -size;
      ctx.avgPrice = execPrice;
      ctx.cash -= commission;
      ctx.signals.push({ time: k.time, type: 'SELL', price: execPrice, reason: signal.reason || '', marginUsed });
      ctx.trades.push({ time: k.time, type: 'SELL', price: execPrice, qty: size, commission });
    }
  }

  function _recordEquity(ctx, k, equityCurve) {
    const mult = ctx.multiplier || 1;
    const unrealizedPnl = ctx.position !== 0
      ? (ctx.position > 0 ? k.close - ctx.avgPrice : ctx.avgPrice - k.close) * Math.abs(ctx.position) * mult
      : 0;
    equityCurve.push({ cash: ctx.cash, position: ctx.position, equity: ctx.cash + unrealizedPnl, close: k.close, time: k.time });
  }

  function _closeFinal(ctx, klines, cfg) {
    if (ctx.position === 0) return;
    const lastK = klines[klines.length - 1];
    const pnl = ctx.position > 0
      ? (lastK.close - ctx.avgPrice) * ctx.position * cfg.multiplier
      : (ctx.avgPrice - lastK.close) * Math.abs(ctx.position) * cfg.multiplier;
    ctx.cash += pnl;
    ctx.trades.push({ time: lastK.time, type: 'CLOSE', price: lastK.close, qty: Math.abs(ctx.position), pnl });
    ctx.position = 0;
  }

  function generateReport(ctx, equityCurve, cfg) {
    const trades = ctx.trades.filter(t => t.pnl !== undefined);
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    const finalEquity = equityCurve[equityCurve.length - 1]?.equity || cfg.initialCash;
    const totalReturn = (finalEquity - cfg.initialCash) / cfg.initialCash * 100;

    let peak = cfg.initialCash, maxDrawdown = 0;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const dd = (peak - point.equity) / peak * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      if (equityCurve[i - 1]?.equity > 0) returns.push(equityCurve[i].equity / equityCurve[i - 1].equity - 1);
    }
    const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length || 1);
    const sharpe = Math.sqrt(252) * avgReturn / (Math.sqrt(variance) || 0.001);

    return {
      ok: true,
      summary: {
        initialCash: cfg.initialCash,
        finalCash: Math.round(ctx.cash * 100) / 100,
        finalEquity: Math.round(finalEquity * 100) / 100,
        totalReturn: totalReturn.toFixed(2) + '%',
        totalTrades: trades.length,
        winTrades: wins.length,
        loseTrades: losses.length,
        winRate: trades.length ? (wins.length / trades.length * 100).toFixed(1) + '%' : '0%',
        maxDrawdown: maxDrawdown.toFixed(2) + '%',
        sharpeRatio: sharpe.toFixed(2),
        avgProfit: trades.length ? (wins.reduce((a, t) => a + t.pnl, 0) / (wins.length || 1)).toFixed(2) : '0',
        avgLoss: trades.length ? (losses.reduce((a, t) => a + t.pnl, 0) / (losses.length || 1)).toFixed(2) : '0',
        profitFactor: losses.reduce((a, t) => a + t.pnl, 0) === 0 ? '∞' :
          Math.abs(wins.reduce((a, t) => a + t.pnl, 0) / losses.reduce((a, t) => a + t.pnl, 0)).toFixed(2),
      },
      trades: trades.slice(-20),
      signals: ctx.signals.slice(-20),
      equityCurve: equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 200)) === 0 || i === equityCurve.length - 1),
      totalBars: equityCurve.length
    };
  }

  return { runBacktest, runMultiPeriodBacktest, BacktestConfig };
})();
