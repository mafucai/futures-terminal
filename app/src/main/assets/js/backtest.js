/* =============================================
   backtest.js — 回测引擎（浏览器版）
   与 sim.js 共用同一套信号契约与成本模型，保证「回测 = 模拟盘」口径一致。
   信号：{ type:'BUY'|'SELL'|'REDUCE'|'CLOSE', size?, ratio?, reason? }
   额外：策略可设 ctx.stopLoss（硬止损），引擎用下一根 high/low 判定（跳空按开盘认亏）。
         ctx.state 跨K线保留；ctx.lastExit 记录最近平仓 { reason, pnl }。
   ============================================= */
window.Backtest = (function () {
  'use strict';
  const SR = window.StrategyRunner;

  const DEFAULT_SPEC = { multiplier: 10, marginRate: 0.10, fee: 0, feeRate: 0, tickSize: 1 };

  class BacktestConfig {
    constructor(o = {}) {
      this.initialCash = o.initialCash != null ? o.initialCash : 100000;
      this.slippagePct = o.slippagePct != null ? o.slippagePct : 0.01;  // %
      this.riskPct = o.riskPct != null ? o.riskPct : 0.005;             // 单笔风险 0.5%
      this.lots = o.lots || 1;                                         // 固定手数（非风险模式）
      this.riskMode = !!o.riskMode;                                    // true=按止损距离算手数
      this.spec = Object.assign({}, DEFAULT_SPEC, o.spec || {});
      // 兼容旧字段
      if (o.multiplier) this.spec.multiplier = o.multiplier;
      if (o.marginPct) this.spec.marginRate = o.marginPct / 100;
      if (o.commissionPct) this.spec.feeRate = o.commissionPct / 100;
    }
  }

  function _feeOf(spec, price, size) {
    return (spec.fee || 0) * size + price * spec.multiplier * size * (spec.feeRate || 0);
  }
  function _execPrice(k, type, slipPct) {
    const s = slipPct / 100;
    return type === 'BUY' ? k.open * (1 + s) : k.open * (1 - s);
  }

  async function runBacktest(klines, strategyCode, config = {}) {
    const cfg = new BacktestConfig(config);
    const strategy = SR.compileStrategy(strategyCode);
    const ctx = SR.createContext({ cash: cfg.initialCash, spec: cfg.spec });
    const equityCurve = [{ cash: cfg.initialCash, equity: cfg.initialCash }];

    for (let i = 1; i < klines.length; i++) {
      const k = klines[i];
      ctx.history = klines.slice(0, i);   // 截止 i-1，防未来
      // 1) 盘中硬止损
      _checkStop(ctx, k, cfg);
      // 2) 策略信号（上一根收盘 → 当前根开盘执行）
      const prevK = klines[i - 1];
      const signal = await SR.runStrategy(strategy, prevK, ctx);
      _executeSignal(signal, k, ctx, cfg, i);
      _recordEquity(ctx, k, equityCurve);
    }
    _closeFinal(ctx, klines, cfg);
    return generateReport(ctx, equityCurve, cfg);
  }

  async function runMultiPeriodBacktest(klines4h, klines1h, strategyCode, config = {}) {
    const cfg = new BacktestConfig(config);
    const strategy = SR.compileStrategy(strategyCode);
    const ctx = SR.createContext({ cash: cfg.initialCash, spec: cfg.spec });
    const equityCurve = [{ cash: cfg.initialCash, equity: cfg.initialCash }];

    klines4h = klines4h.map(k => ({ ...k, period: '4H' }));
    klines1h = klines1h.map(k => ({ ...k, period: '1H' }));
    const allBars = _mergeTimeline(klines4h, klines1h);

    for (let i = 1; i < allBars.length; i++) {
      const k = allBars[i];
      ctx.history = allBars.slice(0, i);
      // 1) 盘中硬止损（每根都查，含 4H 根）
      _checkStop(ctx, k, cfg);
      if (k.period !== '1H') continue;
      // 2) 信号用上一根已收盘的 1H
      let prevIdx = i - 1;
      while (prevIdx >= 0 && allBars[prevIdx].period !== '1H') prevIdx--;
      if (prevIdx < 0) continue;
      const signal = await SR.runStrategy(strategy, allBars[prevIdx], ctx);
      _executeSignal(signal, k, ctx, cfg, i);
      _recordEquity(ctx, k, equityCurve);
    }
    _closeFinal(ctx, allBars, cfg);
    return generateReport(ctx, equityCurve, cfg);
  }

  function _mergeTimeline(k4, k1) {
    const map = new Map();
    for (const k of k4) map.set(k.time + '_4H', k);
    for (const k of k1) { const key = k.time + '_1H'; if (!map.has(key)) map.set(key, k); }
    return [...map.values()].sort((a, b) => a.time.localeCompare(b.time));
  }

  /** 盘中硬止损：用当前根 high/low 判定；跳空按开盘价认亏 */
  function _checkStop(ctx, k, cfg) {
    if (ctx.position === 0 || ctx.stopLoss == null) return;
    const stop = ctx.stopLoss;
    let hit = false, execPrice = null;
    if (ctx.position > 0 && k.low <= stop) { execPrice = k.open <= stop ? k.open : stop; hit = true; }
    else if (ctx.position < 0 && k.high >= stop) { execPrice = k.open >= stop ? k.open : stop; hit = true; }
    if (hit) _close(ctx, k, cfg, '硬止损', execPrice);
  }

  function _size(ctx, cfg, type, k) {
    if (cfg.riskMode && ctx.stopLoss != null) {
      const entry = _execPrice(k, type, cfg.slippagePct);
      const dist = Math.abs(entry - ctx.stopLoss);
      if (dist > 0 && cfg.spec.multiplier) return Math.max(1, Math.floor(ctx.cash * cfg.riskPct / (dist * cfg.spec.multiplier)));
    }
    return cfg.lots;
  }

  function _executeSignal(signal, k, ctx, cfg, idx) {
    if (!signal || !signal.type) return;
    const spec = cfg.spec;
    if (signal.type === 'BUY' || signal.type === 'SELL') {
      const size = signal.size || _size(ctx, cfg, signal.type, k);
      const execPrice = _execPrice(k, signal.type, cfg.slippagePct);
      const fee = _feeOf(spec, execPrice, size);
      const marginUsed = execPrice * spec.multiplier * size * spec.marginRate;
      if (marginUsed > ctx.cash) return; // 资金不足，跳过
      if (signal.type === 'BUY') {
        if (ctx.position < 0) {
          const pnl = (ctx.avgPrice - execPrice) * Math.abs(ctx.position) * spec.multiplier;
          ctx.cash += pnl; ctx.trades.push({ time: k.time, type: 'COVER', price: execPrice, qty: Math.abs(ctx.position), pnl });
        }
        ctx.position = size; ctx.avgPrice = execPrice; ctx.cash -= fee;
        ctx.signals.push({ time: k.time, type: 'BUY', price: execPrice, reason: signal.reason || '', marginUsed });
        ctx.trades.push({ time: k.time, type: 'BUY', price: execPrice, qty: size, commission: fee });
      } else {
        if (ctx.position > 0) {
          const pnl = (execPrice - ctx.avgPrice) * ctx.position * spec.multiplier;
          ctx.cash += pnl; ctx.trades.push({ time: k.time, type: 'SELL', price: execPrice, qty: ctx.position, pnl });
        }
        ctx.position = -size; ctx.avgPrice = execPrice; ctx.cash -= fee;
        ctx.signals.push({ time: k.time, type: 'SELL', price: execPrice, reason: signal.reason || '', marginUsed });
        ctx.trades.push({ time: k.time, type: 'SELL', price: execPrice, qty: size, commission: fee });
      }
    } else if (signal.type === 'REDUCE') {
      _reduce(ctx, k, cfg, signal.ratio || 1 / 3, signal.reason);
    } else if (signal.type === 'CLOSE') {
      _close(ctx, k, cfg, signal.reason || 'CLOSE', null);
    }
  }

  function _reduce(ctx, k, cfg, ratio, reason) {
    if (ctx.position === 0) return;
    const spec = cfg.spec;
    const dir = ctx.position > 0 ? 'SELL' : 'BUY';
    const cur = Math.abs(ctx.position);
    let rl = Math.max(1, Math.round(cur * ratio)); if (rl >= cur) rl = cur - 1; if (rl <= 0) return;
    const price = _execPrice(k, dir, cfg.slippagePct);
    const pnl = (ctx.position > 0 ? (price - ctx.avgPrice) : (ctx.avgPrice - price)) * rl * spec.multiplier;
    ctx.cash += pnl - _feeOf(spec, price, rl);
    ctx.position = ctx.position > 0 ? cur - rl : -(cur - rl);
    ctx.trades.push({ time: k.time, type: dir, price, qty: rl, pnl, reduce: true });
    ctx.signals.push({ time: k.time, type: dir, price, reason: reason || 'REDUCE', reduce: true });
    ctx.lastExit = { reason: 'REDUCE', pnl, time: k.time };
  }

  function _close(ctx, k, cfg, reason, execPrice) {
    if (ctx.position === 0) return;
    const spec = cfg.spec;
    const dir = ctx.position > 0 ? 'SELL' : 'BUY';
    const price = execPrice != null ? execPrice : _execPrice(k, dir, cfg.slippagePct);
    const lots = Math.abs(ctx.position);
    const pnl = (ctx.position > 0 ? (price - ctx.avgPrice) : (ctx.avgPrice - price)) * lots * spec.multiplier;
    ctx.cash += pnl - _feeOf(spec, price, lots);
    ctx.trades.push({ time: k.time, type: dir, price, qty: lots, pnl, close: true });
    ctx.signals.push({ time: k.time, type: dir, price, reason, close: true });
    ctx.position = 0; ctx.avgPrice = 0; ctx.stopLoss = null;
    ctx.lastExit = { reason: reason || 'CLOSE', pnl, time: k.time };
  }

  function _recordEquity(ctx, k, equityCurve) {
    const mult = ctx.spec.multiplier || 1;
    const unreal = ctx.position !== 0
      ? (ctx.position > 0 ? k.close - ctx.avgPrice : ctx.avgPrice - k.close) * Math.abs(ctx.position) * mult : 0;
    equityCurve.push({ cash: ctx.cash, position: ctx.position, equity: ctx.cash + unreal, close: k.close, time: k.time });
  }

  function _closeFinal(ctx, klines, cfg) {
    if (ctx.position === 0) return;
    const lastK = klines[klines.length - 1];
    _close(ctx, lastK, cfg, 'CLOSE', lastK.close);
  }

  function generateReport(ctx, equityCurve, cfg) {
    const trades = ctx.trades.filter(t => t.pnl !== undefined);
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl < 0);
    const finalEquity = equityCurve[equityCurve.length - 1] ? equityCurve[equityCurve.length - 1].equity : cfg.initialCash;
    const totalReturn = (finalEquity - cfg.initialCash) / cfg.initialCash * 100;

    let peak = cfg.initialCash, maxDrawdown = 0;
    for (const point of equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const dd = (peak - point.equity) / peak * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      if (equityCurve[i - 1] && equityCurve[i - 1].equity > 0) returns.push(equityCurve[i].equity / equityCurve[i - 1].equity - 1);
    }
    const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const variance = returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / (returns.length || 1);
    const sharpe = Math.sqrt(252) * avgReturn / (Math.sqrt(variance) || 0.001);

    const totalFees = ctx.trades.reduce((a, t) => a + (t.commission || 0), 0);

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
        totalFees: Math.round(totalFees * 100) / 100,
        avgProfit: trades.length ? (wins.reduce((a, t) => a + t.pnl, 0) / (wins.length || 1)).toFixed(2) : '0',
        avgLoss: trades.length ? (losses.reduce((a, t) => a + t.pnl, 0) / (losses.length || 1)).toFixed(2) : '0',
        profitFactor: losses.reduce((a, t) => a + t.pnl, 0) === 0 ? '∞' :
          Math.abs(wins.reduce((a, t) => a + t.pnl, 0) / losses.reduce((a, t) => a + t.pnl, 0)).toFixed(2)
      },
      trades: ctx.trades.slice(-50),
      signals: ctx.signals.slice(-50),
      equityCurve: equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 200)) === 0 || i === equityCurve.length - 1),
      totalBars: equityCurve.length
    };
  }

  return { runBacktest, runMultiPeriodBacktest, BacktestConfig, DEFAULT_SPEC };
})();
