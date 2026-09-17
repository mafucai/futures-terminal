/* =============================================
   sim.js — 模拟期货盘引擎（浏览器版，纯本地）
   与 backtest.js 的区别：
     - backtest 是"一次性跑完历史给出统计"；
     - sim（模拟盘）是"真实盘口推演"：既可按策略自动逐根推进生成买卖点，
       也允许用户手动在某一根 K 线上买入/卖出，K 线上标注所有买卖点。
   数据一律来自本地缓存（不联网）；合约/周期/日期由视图决定。
   ============================================= */
window.SimEngine = (function () {
  'use strict';
  const SR = window.StrategyRunner;

  const CFG = {
    initialCash: 100000,
    slippagePct: 0.01,   // 滑点 %
    commissionPct: 0.003, // 手续费 %（按名义价值）
    multiplier: 15,      // 合约乘数
    marginPct: 10        // 保证金比例 %
  };

  /** 新建一个模拟账户 */
  function newAccount(extra) {
    return Object.assign({
      initialCash: CFG.initialCash,
      cash: CFG.initialCash,
      position: 0,          // 正=多，负=空
      avgPrice: 0,
      marks: [],            // [{ index, time, type:'BUY'|'SELL', price, qty, reason, auto }]
      trades: [],           // 成交明细
      equity: [],           // [{ time, equity }]
      realized: 0,          // 已实现盈亏
      lastIndex: -1,
      code: '',
      period: 101
    }, extra || {});
  }

  function _execPrice(bar, type) {
    const slip = CFG.slippagePct / 100;
    return type === 'BUY' ? bar.open * (1 + slip) : bar.open * (1 - slip);
  }

  function _commission(price, size) {
    return price * CFG.multiplier * size * CFG.commissionPct / 100;
  }

  /**
   * 扣保证金执行一笔开/平仓。返回新的 account（原地修改）。
   * type: 'BUY'(开多或平空) / 'SELL'(开空或平多)
   */
  function _apply(acc, type, size, bar, reason, auto, index) {
    const price = bar ? (auto ? _execPrice(bar, type) : Number(bar.close)) : 0;
    if (!price) return { ok: false, error: '无有效价格' };
    const commission = _commission(price, size);

    if (type === 'BUY') {
      // 先平掉空头
      if (acc.position < 0) {
        const pnl = (acc.avgPrice - price) * Math.abs(acc.position) * CFG.multiplier;
        acc.cash += pnl; acc.realized += pnl;
        acc.trades.push({ time: bar.time, type: 'COVER', price, qty: Math.abs(acc.position), pnl });
      }
      const margin = price * CFG.multiplier * size * CFG.marginPct / 100;
      if (margin > acc.cash) return { ok: false, error: `资金不足：需保证金 ${Math.round(margin)}，可用 ${Math.round(acc.cash)}` };
      acc.position = size; acc.avgPrice = price; acc.cash -= commission;
      acc.marks.push({ index, time: bar.time, type: 'BUY', price, qty: size, reason: reason || '', auto: !!auto });
      acc.trades.push({ time: bar.time, type: 'BUY', price, qty: size, commission });
    } else if (type === 'SELL') {
      if (acc.position > 0) {
        const pnl = (price - acc.avgPrice) * acc.position * CFG.multiplier;
        acc.cash += pnl; acc.realized += pnl;
        acc.trades.push({ time: bar.time, type: 'SELL', price, qty: acc.position, pnl });
      }
      const margin = price * CFG.multiplier * size * CFG.marginPct / 100;
      if (margin > acc.cash) return { ok: false, error: `资金不足：需保证金 ${Math.round(margin)}，可用 ${Math.round(acc.cash)}` };
      acc.position = -size; acc.avgPrice = price; acc.cash -= commission;
      acc.marks.push({ index, time: bar.time, type: 'SELL', price, qty: size, reason: reason || '', auto: !!auto });
      acc.trades.push({ time: bar.time, type: 'SELL', price, qty: size, commission });
    }
    return { ok: true };
  }

  function _markEquity(acc, bar) {
    const unreal = acc.position !== 0
      ? (acc.position > 0 ? bar.close - acc.avgPrice : acc.avgPrice - bar.close) * Math.abs(acc.position) * CFG.multiplier
      : 0;
    acc.equity.push({ time: bar.time, equity: acc.cash + unreal, close: bar.close });
  }

  /**
   * 按策略执行（真实数据推演）。
   * @param {Array} klines  该合约该周期的K线（升序）
   * @param {string} strategyCode 策略源码
   * @param {string} endDate 模拟截止日期 'YYYY-MM-DD'（空 或 'latest' = 用最新日期/全部数据）
   * @param {object} opts { qty=1 }
   * @returns { account, klines, endIndex }
   */
  async function runStrategy(klines, strategyCode, endDate, opts) {
    opts = opts || {};
    const qty = opts.qty || 1;
    if (!Array.isArray(klines) || klines.length < 2) throw new Error('K线不足，无法模拟');
    const strategy = SR.compileStrategy(strategyCode);

    // 定位截止下标：默认最后一根（最新日期）；给日期则只跑到该日期之前
    let endIndex = klines.length - 1;
    if (endDate && endDate !== 'latest') {
      const t = String(endDate);
      let idx = -1;
      for (let i = klines.length - 1; i >= 0; i--) { if (String(klines[i].time).slice(0, 10) <= t) { idx = i; break; } }
      if (idx < 0) idx = klines.length - 1; // 该日期早于全部数据 -> 无法模拟，用全部
      endIndex = idx;
    }

    const acc = newAccount({ code: opts.code || '', period: opts.period || 101 });
    const ctx = SR.createContext({ cash: acc.cash, code: acc.code });

    // 从第一根开始逐根推进到 endIndex：指标自然预热，信号逐根产生，不偷看未来
    ctx.history.push(klines[0]);

    for (let i = 1; i <= endIndex; i++) {
      const bar = klines[i];
      ctx.history.push(bar);
      // 用上一根（已收盘）产生信号，在当前根开盘执行——避免未来函数
      const prev = klines[i - 1];
      if (prev) {
        const signal = await SR.runStrategy(strategy, prev, ctx);
        if (signal && (signal.type === 'BUY' || signal.type === 'SELL')) {
          const size = signal.size || qty;
          const r = _apply(acc, signal.type, size, bar, signal.reason, true, i);
          if (!r.ok) { /* 资金不足等，跳过该信号 */ }
        }
      }
      _markEquity(acc, bar);
      acc.lastIndex = i;
    }
    acc.ctxPosition = ctx.position; // 仅信息
    return { account: acc, klines, endIndex };
  }

  /** 手动下单：在指定下标（默认最后一根）以收盘价成交 */
  function manualOrder(acc, klines, index, type, qty, reason) {
    const bar = klines[index];
    if (!bar) return { ok: false, error: '该K线不存在' };
    const r = _apply(acc, type, qty || 1, bar, reason || '手动', false, index);
    if (r.ok) _markEquity(acc, bar);
    return r;
  }

  /** 平仓：把当前持仓按最后一根收盘平掉 */
  function closePosition(acc, klines, index) {
    if (acc.position === 0) return { ok: false, error: '当前无持仓' };
    const bar = klines[index >= 0 ? index : klines.length - 1];
    if (!bar) return { ok: false, error: '无K线' };
    const price = bar.close;
    if (acc.position > 0) {
      const pnl = (price - acc.avgPrice) * acc.position * CFG.multiplier;
      acc.cash += pnl; acc.realized += pnl;
      acc.marks.push({ index: klines.indexOf(bar), time: bar.time, type: 'SELL', price, qty: acc.position, reason: '平仓', auto: false });
      acc.trades.push({ time: bar.time, type: 'SELL', price, qty: acc.position, pnl });
    } else {
      const pnl = (acc.avgPrice - price) * Math.abs(acc.position) * CFG.multiplier;
      acc.cash += pnl; acc.realized += pnl;
      acc.marks.push({ index: klines.indexOf(bar), time: bar.time, type: 'BUY', price, qty: Math.abs(acc.position), reason: '平仓', auto: false });
      acc.trades.push({ time: bar.time, type: 'BUY', price, qty: Math.abs(acc.position), pnl });
    }
    acc.position = 0; acc.avgPrice = 0;
    return { ok: true };
  }

  /** 汇总（与回测口径一致，便于对比） */
  function summary(acc, lastClose) {
    const unreal = acc.position !== 0 && lastClose
      ? (acc.position > 0 ? lastClose - acc.avgPrice : acc.avgPrice - lastClose) * Math.abs(acc.position) * CFG.multiplier
      : 0;
    const equity = acc.cash + unreal;
    const totalReturn = (equity - acc.initialCash) / acc.initialCash * 100;
    const closed = acc.trades.filter(t => t.pnl !== undefined);
    const wins = closed.filter(t => t.pnl > 0).length;
    const losses = closed.filter(t => t.pnl < 0).length;

    let peak = acc.initialCash, maxDD = 0;
    for (const p of acc.equity) {
      if (p.equity > peak) peak = p.equity;
      const dd = (peak - p.equity) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }
    return {
      initialCash: acc.initialCash,
      cash: Math.round(acc.cash * 100) / 100,
      equity: Math.round(equity * 100) / 100,
      unrealized: Math.round(unreal * 100) / 100,
      realized: Math.round(acc.realized * 100) / 100,
      position: acc.position,
      avgPrice: acc.avgPrice,
      totalReturn: totalReturn.toFixed(2) + '%',
      trades: acc.trades.length,
      closedTrades: closed.length,
      winRate: closed.length ? (wins / closed.length * 100).toFixed(1) + '%' : '--',
      maxDrawdown: maxDD.toFixed(2) + '%',
      buys: acc.marks.filter(m => m.type === 'BUY').length,
      sells: acc.marks.filter(m => m.type === 'SELL').length
    };
  }

  return { CFG, newAccount, runStrategy, manualOrder, closePosition, summary, _apply, _markEquity };
})();
