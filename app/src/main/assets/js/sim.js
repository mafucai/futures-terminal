/* =============================================
   sim.js — 模拟期货盘引擎（浏览器版，纯本地）
   与 backtest.js 的区别：
     - backtest 是"一次性跑完历史给出统计"；
     - sim（模拟盘）是"真实盘口推演"：既可按策略自动逐根推进生成买卖点，
       也允许用户手动在某一根 K 线上买入/卖出，K 线上标注所有买卖点。
   数据一律来自本地缓存（不联网）；合约/周期/日期由视图决定。

   策略信号契约（onBar 可返回）：
     { type:'BUY'|'SELL'|'REDUCE'|'CLOSE', size?, ratio?, reason? }
       BUY/SELL   —— 开多/开空（若持反向仓，先平后反手）
       REDUCE     —— 按比例减仓（ratio 默认 1/3），保留剩余仓位
       CLOSE      —— 全平
     另可设置（写在 ctx 上，引擎读取）：
       ctx.stopLoss = 价格   —— 硬止损；引擎在【下一根K线的 high/low】判定，跳空按开盘认亏
     ctx.state 为持久对象（连亏计数/暂停方向等），跨K线保留。
   ============================================= */
window.SimEngine = (function () {
  'use strict';
  const SR = window.StrategyRunner;

  /* 默认合约规格（无同花顺数据时的兜底） */
  const DEFAULT_SPEC = {
    multiplier: 10,   // 合约乘数（每手每点盈亏）
    marginRate: 0.10, // 保证金率（小数）
    fee: 0,           // 手续费（元/手，固定）
    feeRate: 0,       // 手续费率（按成交额，小数；两种可同时存在）
    tickSize: 1
  };

  const CFG = {
    initialCash: 100000,
    slippagePct: 0.01,   // 滑点 %
    riskPct: 0.005,      // 单笔风险比例（0.5%）
    maxLots: 0           // 0 = 不限（由风险预算决定）
  };

  function normSpec(spec) {
    return Object.assign({}, DEFAULT_SPEC, spec || {});
  }

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
      period: 101,
      spec: null
    }, extra || {});
  }

  function _execPrice(bar, type) {
    const slip = CFG.slippagePct / 100;
    return type === 'BUY' ? bar.open * (1 + slip) : bar.open * (1 - slip);
  }

  /** 手续费 = 固定元/手 × 手数 + 成交额 × 费率（两种可同时） */
  function _feeOf(spec, price, size) {
    const fixed = (spec.fee || 0) * size;
    const byRate = price * spec.multiplier * size * (spec.feeRate || 0);
    return fixed + byRate;
  }

  /** 按风险预算算手数：手数 = 资金 × 风险% ÷（止损距离 × 乘数） */
  function calcSizeByRisk(cash, spec, entryPrice, stopPrice) {
    const dist = Math.abs(entryPrice - stopPrice);
    if (!dist || !spec.multiplier) return 1;
    const lots = Math.floor(cash * CFG.riskPct / (dist * spec.multiplier));
    return Math.max(1, lots);
  }

  /**
   * 执行一笔操作。原地修改 acc。
   * type: 'BUY' 开多/平空反手 | 'SELL' 开空/平多反手
   * opt.execPrice 指定成交价（止损用）；否则 auto→滑点开盘价，手动→收盘价
   */
  function _apply(acc, type, size, bar, reason, auto, index, opt) {
    opt = opt || {};
    const spec = acc.spec || DEFAULT_SPEC;
    const price = opt.execPrice != null
      ? opt.execPrice
      : (bar ? (auto ? _execPrice(bar, type) : Number(bar.close)) : 0);
    if (!price || !bar) return { ok: false, error: '无有效价格' };
    const fee = _feeOf(spec, price, size);

    if (type === 'BUY') {
      if (acc.position < 0) {  // 平空
        const pnl = (acc.avgPrice - price) * Math.abs(acc.position) * spec.multiplier;
        acc.cash += pnl; acc.realized += pnl;
        acc.trades.push({ time: bar.time, type: 'COVER', price, qty: Math.abs(acc.position), pnl });
      }
      const margin = price * spec.multiplier * size * spec.marginRate;
      if (margin > acc.cash) return { ok: false, error: `资金不足：需保证金 ${Math.round(margin)}，可用 ${Math.round(acc.cash)}` };
      acc.position = size; acc.avgPrice = price; acc.cash -= fee;
      acc.marks.push({ index, time: bar.time, type: 'BUY', price, qty: size, reason: reason || '', auto: !!auto });
      acc.trades.push({ time: bar.time, type: 'BUY', price, qty: size, commission: fee });
    } else if (type === 'SELL') {
      if (acc.position > 0) {  // 平多
        const pnl = (price - acc.avgPrice) * acc.position * spec.multiplier;
        acc.cash += pnl; acc.realized += pnl;
        acc.trades.push({ time: bar.time, type: 'SELL', price, qty: acc.position, pnl });
      }
      const margin = price * spec.multiplier * size * spec.marginRate;
      if (margin > acc.cash) return { ok: false, error: `资金不足：需保证金 ${Math.round(margin)}，可用 ${Math.round(acc.cash)}` };
      acc.position = -size; acc.avgPrice = price; acc.cash -= fee;
      acc.marks.push({ index, time: bar.time, type: 'SELL', price, qty: size, reason: reason || '', auto: !!auto });
      acc.trades.push({ time: bar.time, type: 'SELL', price, qty: size, commission: fee });
    }
    return { ok: true, price, fee };
  }

  /** 按比例减仓（保留剩余仓位）。ratio 为减仓比例（默认 1/3） */
  function _reduce(acc, ratio, bar, reason, auto, index) {
    if (acc.position === 0) return { ok: false, error: '无持仓可减' };
    const spec = acc.spec || DEFAULT_SPEC;
    const cur = Math.abs(acc.position);
    let reduceLots = Math.max(1, Math.round(cur * (ratio || 1 / 3)));
    if (reduceLots >= cur) reduceLots = cur - 1; // 至少保留1手
    if (reduceLots <= 0) return { ok: false, error: '手数不足，无法减仓' };
    const dir = acc.position > 0 ? 'SELL' : 'BUY';
    const price = auto ? _execPrice(bar, dir) : Number(bar.close);
    const pnl = (acc.position > 0 ? (price - acc.avgPrice) : (acc.avgPrice - price)) * reduceLots * spec.multiplier;
    acc.cash += pnl; acc.realized += pnl;
    acc.cash -= _feeOf(spec, price, reduceLots);
    acc.position = acc.position > 0 ? (cur - reduceLots) : -(cur - reduceLots);
    acc.marks.push({ index, time: bar.time, type: dir, price, qty: reduceLots, reason: reason || '减仓', auto: !!auto, reduce: true });
    acc.trades.push({ time: bar.time, type: dir, price, qty: reduceLots, pnl, reduce: true });
    return { ok: true, price, pnl };
  }

  /** 全部平仓 */
  function _close(acc, bar, reason, auto, index, opt) {
    if (acc.position === 0) return { ok: false, error: '无持仓' };
    opt = opt || {};
    const spec = acc.spec || DEFAULT_SPEC;
    const dir = acc.position > 0 ? 'SELL' : 'BUY';
    const price = opt.execPrice != null ? opt.execPrice : (auto ? _execPrice(bar, dir) : Number(bar.close));
    const lots = Math.abs(acc.position);
    const pnl = (acc.position > 0 ? (price - acc.avgPrice) : (acc.avgPrice - price)) * lots * spec.multiplier;
    acc.cash += pnl; acc.realized += pnl;
    acc.cash -= _feeOf(spec, price, lots);
    acc.marks.push({ index, time: bar.time, type: dir, price, qty: lots, reason: reason || '平仓', auto: !!auto, close: true });
    acc.trades.push({ time: bar.time, type: dir, price, qty: lots, pnl, close: true });
    acc.position = 0; acc.avgPrice = 0;
    return { ok: true, price, pnl };
  }

  function _markEquity(acc, bar) {
    const spec = acc.spec || DEFAULT_SPEC;
    const unreal = acc.position !== 0
      ? (acc.position > 0 ? bar.close - acc.avgPrice : acc.avgPrice - bar.close) * Math.abs(acc.position) * spec.multiplier
      : 0;
    acc.equity.push({ time: bar.time, equity: acc.cash + unreal, close: bar.close });
  }

  /**
   * 按策略执行（真实数据推演）。
   * @param {Array} klines  该合约该周期的K线（升序）
   * @param {string} strategyCode 策略源码
   * @param {string} endDate 模拟截止日期 'YYYY-MM-DD'（空 或 'latest' = 用最新日期/全部数据）
   * @param {object} opts { qty=1, code, period, spec, riskMode }
   *   riskMode=true 时按「止损距离×乘数」自动算手数（需策略设置 ctx.stopLoss）
   * @returns { account, klines, endIndex }
   */
  async function runStrategy(klines, strategyCode, endDate, opts) {
    opts = opts || {};
    const fixedQty = opts.qty || 1;
    const riskMode = !!opts.riskMode;
    if (!Array.isArray(klines) || klines.length < 2) throw new Error('K线不足，无法模拟');
    const strategy = SR.compileStrategy(strategyCode);
    const spec = normSpec(opts.spec);
    connState.ctx = SR.createContext({});   // 每次运行重置 ctx.state，策略间互不影响

    // 定位截止下标：默认最后一根（最新日期）；给日期则只跑到该日期之前
    let endIndex = klines.length - 1;
    if (endDate && endDate !== 'latest') {
      const t = String(endDate);
      let idx = -1;
      for (let i = klines.length - 1; i >= 0; i--) { if (String(klines[i].time).slice(0, 10) <= t) { idx = i; break; } }
      if (idx < 0) idx = klines.length - 1;
      endIndex = idx;
    }

    const acc = newAccount({ code: opts.code || '', period: opts.period || 101, spec });

    /** 从第一根开始逐根推进到 endIndex：指标自然预热，信号逐根产生，不偷看未来 */
    for (let i = 1; i <= endIndex; i++) {
      const bar = klines[i];
      const ctx = _ctxFor(klines, i, acc, spec);

      // ── 1) 盘中硬止损优先：用【当前根 high/low】判定上一根设置的止损 ──
      if (acc.position !== 0 && ctx._pendingStop != null) {
        const stop = ctx._pendingStop;
        let hit = false, execPrice = null;
        if (acc.position > 0 && bar.low <= stop) {
          // 跳空：若开盘已低于止损，按开盘价认亏
          execPrice = bar.open <= stop ? bar.open : stop;
          hit = true;
        } else if (acc.position < 0 && bar.high >= stop) {
          execPrice = bar.open >= stop ? bar.open : stop;
          hit = true;
        }
        if (hit) {
          _close(acc, bar, '硬止损', true, i, { execPrice });
          ctx.stopLoss = null;
        }
      }

      // ── 2) 策略信号：用上一根已收盘K线产生，在【当前根】执行 ──
      const prev = klines[i - 1];
      if (prev) {
        // 让策略看到当前根的 stopLoss 状态
        const signal = await SR.runStrategy(strategy, prev, ctx);
        if (signal && signal.type) {
          const reason = signal.reason || '';
          if (signal.type === 'BUY' || signal.type === 'SELL') {
            let size;
            if (riskMode && ctx.stopLoss != null) {
              const entry = _execPrice(bar, signal.type);
              size = calcSizeByRisk(acc.cash, spec, entry, ctx.stopLoss);
            } else {
              size = signal.size || fixedQty;
            }
            _apply(acc, signal.type, size, bar, reason, true, i);
          } else if (signal.type === 'REDUCE') {
            _reduce(acc, signal.ratio || 1 / 3, bar, reason, true, i);
          } else if (signal.type === 'CLOSE') {
            _close(acc, bar, reason, true, i);
          }
        }
      }

      // ── 3) 记录本轮止损（供下一根盘中判定）──
      ctx._pendingStop = acc.position !== 0 ? ctx.stopLoss : null;
      // 把最近一次平仓结果暴露给策略，便于实现「连亏暂停」等纪律
      const lastTrade = acc.trades[acc.trades.length - 1];
      if (lastTrade && lastTrade.time === bar.time && lastTrade.pnl !== undefined) {
        ctx.lastExit = { reason: lastTrade.close ? 'CLOSE' : (lastTrade.reduce ? 'REDUCE' : 'CLOSE'), pnl: lastTrade.pnl, time: bar.time };
      }

      _markEquity(acc, bar);
      acc.lastIndex = i;
      acc._lastCtx = ctx;
    }
    acc.ctxPosition = acc._lastCtx ? acc._lastCtx.position : acc.position;
    delete acc._lastCtx;
    return { account: acc, klines, endIndex };
  }

  /** 为第 i 根构造 ctx（含截止 i-1 的历史 + 上一轮 persist 状态） */
  function _ctxFor(klines, i, acc, spec) {
    const ctx = connState.ctx;
    ctx.history = klines.slice(0, i);   // 截止 i-1（不含当前根，防未来）
    ctx.position = acc.position;
    ctx.avgPrice = acc.avgPrice;
    ctx.cash = acc.cash;
    ctx.code = acc.code;
    ctx.spec = spec;
    return ctx;
  }
  // 复用一个 ctx 以保留 state（策略自定义状态跨K线保留）
  const connState = { ctx: SR.createContext({}) };

  /** 手动下单：在指定下标以收盘价成交 */
  function manualOrder(acc, klines, index, type, qty, reason) {
    const bar = klines[index];
    if (!bar) return { ok: false, error: '该K线不存在' };
    const r = _apply(acc, type, qty || 1, bar, reason || '手动', false, index);
    if (r.ok) _markEquity(acc, bar);
    return r;
  }

  /** 平仓：把当前持仓按指定（默认最后一根）收盘平掉 */
  function closePosition(acc, klines, index) {
    const i = (index >= 0) ? index : klines.length - 1;
    const bar = klines[i];
    if (!bar) return { ok: false, error: '无K线' };
    return _close(acc, bar, '手动平仓', false, i);
  }

  /** 汇总（与回测口径一致，便于对比） */
  function summary(acc, lastClose) {
    const spec = acc.spec || DEFAULT_SPEC;
    const unreal = acc.position !== 0 && lastClose
      ? (acc.position > 0 ? lastClose - acc.avgPrice : acc.avgPrice - lastClose) * Math.abs(acc.position) * spec.multiplier
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

  return {
    CFG, DEFAULT_SPEC, normSpec, newAccount, calcSizeByRisk, _feeOf,
    runStrategy, manualOrder, closePosition, summary, _apply, _reduce, _close, _markEquity
  };
})();
