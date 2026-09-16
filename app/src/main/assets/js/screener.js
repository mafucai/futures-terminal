/* =============================================
   screener.js — 策略筛选器（浏览器版）
   移植自 server/screener.js
   缓存改用 localStorage / IndexedDB（浏览器无 fs）
   ============================================= */
window.Screener = (function () {
  'use strict';
  const SR = window.StrategyRunner;
  const WD = window.WebData;

  // ── 本地缓存层（替代 fs 文件缓存） ──
  const Store = {
    _k: 'fv2_kline_', _f: 'fv2_futures',
    save(k, v) { try { localStorage.setItem(this._k + k, JSON.stringify(v)); } catch (e) {} },
    load(k) { try { const s = localStorage.getItem(this._k + k); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
    saveFutures(v) { try { localStorage.setItem(this._f, JSON.stringify(v)); } catch (e) {} },
    loadFutures() { try { const s = localStorage.getItem(this._f); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  };

  function cacheKline(code, period, klines, name) {
    Store.save(`${code}_${period}`, { klines, name: name || code, time: new Date().toISOString() });
  }
  function readKlineCache(code, period) {
    const d = Store.load(`${code}_${period}`);
    return d ? d.klines : null;
  }
  function getContracts(mainOnly = false) {
    const d = Store.loadFutures();
    if (!d || !d.data) return [];
    let entries = Object.entries(d.data);
    if (mainOnly) entries = entries.filter(([code]) => code.endsWith('m'));
    return entries.map(([code, info]) => ({ code, name: (info && info.name) || code }));
  }

  // ── EMA26 符合度评分 ──
  function scoreEma26(k4h, k1h) {
    if (!k4h || !k1h || k4h.length < 26 || k1h.length < 26) return null;
    const closes4 = k4h.map(x => x.close);
    const closes1 = k1h.map(x => x.close);
    const highs1 = k1h.map(x => x.high);
    const lows1 = k1h.map(x => x.low);

    const ema26_4h = calcEMA(closes4, 26);
    const ema26_1h = calcEMA(closes1, 26);
    const atr14_1h = calcATR(highs1, lows1, closes1, 14);

    const cur = closes1[closes1.length - 1];
    const prev1 = closes1[closes1.length - 2];
    const prev2 = closes1[closes1.length - 3];
    const prev3 = closes1[closes1.length - 4];
    const prevEMA1 = getPrevEMA(closes1, 26, 1);
    const prevEMA2 = getPrevEMA(closes1, 26, 2);
    const prevEMA3 = getPrevEMA(closes1, 26, 3);
    const curOpen = k1h[k1h.length - 1].open;

    const longDir = closes4[closes4.length - 1] > ema26_4h;
    const longCross = prev1 <= prevEMA1 && cur > ema26_1h;
    const longDist = (cur - ema26_1h) <= 1.5 * atr14_1h;
    const longConfirm = prev1 < prevEMA1 && prev2 < prevEMA2 && prev3 < prevEMA3;
    const longYang = cur > curOpen;

    const shortDir = closes4[closes4.length - 1] < ema26_4h;
    const shortCross = prev1 >= prevEMA1 && cur < ema26_1h;
    const shortDist = (ema26_1h - cur) <= 1.5 * atr14_1h;
    const shortConfirm = prev1 > prevEMA1 && prev2 > prevEMA2 && prev3 > prevEMA3;
    const shortYin = cur < curOpen;

    const longScore = (longDir ? 20 : 0) + (longCross ? 25 : 0) + (longDist ? 15 : 0) + (longConfirm ? 20 : 0) + (longYang ? 10 : 0);
    const shortScore = (shortDir ? 20 : 0) + (shortCross ? 25 : 0) + (shortDist ? 15 : 0) + (shortConfirm ? 20 : 0) + (shortYin ? 10 : 0);

    const isLong = longDir && !shortDir ? true : (shortDir && !longDir ? false : longScore >= shortScore);
    const score = isLong ? longScore : shortScore;

    const dist = isLong ? Math.abs(cur - ema26_1h) : Math.abs(ema26_1h - cur);
    const distRatio = atr14_1h > 0 ? dist / atr14_1h : 1;
    let adjust = 0;
    if (distRatio <= 0.5) adjust = 5;
    else if (distRatio <= 1.5) adjust = 3;
    else if (distRatio > 3) adjust = -5;

    const finalScore = Math.max(0, Math.min(100, score + adjust));
    return {
      score: Math.round(finalScore),
      conditions: {
        direction: isLong ? 'LONG' : 'SHORT',
        dirHit: isLong ? longDir : shortDir,
        crossHit: isLong ? longCross : shortCross,
        distHit: isLong ? longDist : shortDist,
        confirmHit: isLong ? longConfirm : shortConfirm,
        candleHit: isLong ? longYang : shortYin
      },
      detail: {
        ema4h: ema26_4h.toFixed(2), ema1h: ema26_1h.toFixed(2),
        atr14: atr14_1h.toFixed(2), cur: cur.toFixed(2), distRatio: distRatio.toFixed(2)
      }
    };
  }

  function calcEMA(data, period) {
    const k = 2 / (period + 1);
    let ema = data[0];
    for (let i = 1; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
    return ema;
  }
  function calcATR(highs, lows, closes, period) {
    const trValues = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(closes[i - 1] - highs[i]), Math.abs(closes[i - 1] - lows[i]));
      trValues.push(tr);
    }
    if (trValues.length < period) return trValues.reduce((a, b) => a + b, 0) / trValues.length;
    return trValues.slice(-period).reduce((a, b) => a + b, 0) / period;
  }
  function getPrevEMA(data, period, offset) {
    return calcEMA(data.slice(0, data.length - offset), period);
  }

  // ── 单周期筛选 ──
  async function screenWithCode(strategyCode, period = 101, opts = {}) {
    const { mainOnly = false, minBars = 20, liveFetch = false, onProgress } = opts;
    const strategy = SR.compileStrategy(strategyCode);
    const contracts = getContracts(mainOnly);
    const results = [];
    let skipped = 0, fetched = 0;

    for (let ci = 0; ci < contracts.length; ci++) {
      const contract = contracts[ci];
      if (onProgress && ci % 10 === 0) onProgress(ci, contracts.length);
      let klines = readKlineCache(contract.code, period);

      if ((!klines || klines.length < minBars) && liveFetch) {
        try {
          klines = await WD.futureKline(contract.code, period, 100);
          if (klines && klines.length >= minBars) { cacheKline(contract.code, period, klines, contract.name); fetched++; }
          else klines = null;
        } catch (e) { klines = null; }
      }

      if (!klines || klines.length < minBars) { skipped++; continue; }

      const ctx = SR.createContext({ cash: 100000, code: contract.code });
      for (const k of klines) {
        ctx.history.push(k);
        const signal = await SR.runStrategy(strategy, k, ctx);
        if (signal) ctx.signals.push({ time: k.time, ...signal });
      }
      if (ctx.signals.length > 0) {
        const last = ctx.signals[ctx.signals.length - 1];
        // 5 信号加权评分（可解释）；Scoring 缺失时降级为 null，不阻断
        let sc = null;
        try { if (window.Scoring) sc = window.Scoring.scoreContract(klines); } catch (e) { sc = null; }
        results.push({
          code: contract.code, name: contract.name,
          price: klines[klines.length - 1].close,
          signal: { type: last.type, reason: last.reason || '-' },
          signals: ctx.signals.length,
          score: sc && sc.ok ? sc.score : null,
          grade: sc ? sc.grade : null,
          rules: sc ? sc.rules : [],
          summary: sc ? sc.summary : null,
          scoreDetail: sc
        });
      }
    }
    return { ok: true, totalTargets: contracts.length, skipped, fetched, results, time: new Date().toISOString() };
  }

  // ── 多周期筛选 ──
  async function screenMultiPeriod(strategyCode, opts = {}) {
    const { mainOnly = false, minBars = 20, liveFetch = false, onProgress } = opts;
    const strategy = SR.compileStrategy(strategyCode);
    const contracts = getContracts(mainOnly);
    const results = [];
    let skipped = 0, fetched = 0;

    for (let ci = 0; ci < contracts.length; ci++) {
      const contract = contracts[ci];
      if (onProgress && ci % 10 === 0) onProgress(ci, contracts.length);
      let k4h = readKlineCache(contract.code, 240);
      let k1h = readKlineCache(contract.code, 60);

      if ((!k4h || k4h.length < minBars) && liveFetch) {
        try {
          k4h = await WD.futureKline(contract.code, 240, 100);
          if (k4h && k4h.length >= minBars) cacheKline(contract.code, 240, k4h, contract.name); else k4h = null;
        } catch (e) { k4h = null; }
      }
      if ((!k1h || k1h.length < minBars) && liveFetch) {
        try {
          k1h = await WD.futureKline(contract.code, 60, 100);
          if (k1h && k1h.length >= minBars) cacheKline(contract.code, 60, k1h, contract.name); else k1h = null;
        } catch (e) { k1h = null; }
      }
      if (k4h && k1h) fetched++;

      if (!k4h || !k1h || k4h.length < minBars || k1h.length < minBars) { skipped++; continue; }

      const map = new Map();
      for (const k of k4h) map.set(k.time + '_4H', { ...k, period: '4H' });
      for (const k of k1h) map.set(k.time + '_1H', { ...k, period: '1H' });
      const allBars = [...map.values()].sort((a, b) => a.time.localeCompare(b.time));

      const ctx = SR.createContext({ cash: 100000, code: contract.code });
      for (const k of allBars) {
        ctx.history.push(k);
        if (k.period !== '1H') continue;
        const signal = await SR.runStrategy(strategy, k, ctx);
        if (signal) ctx.signals.push({ time: k.time, ...signal });
      }

      if (ctx.signals.length > 0) {
        const last = ctx.signals[ctx.signals.length - 1];
        const score = scoreEma26(k4h, k1h);
        results.push({
          code: contract.code, name: contract.name,
          price: k1h[k1h.length - 1].close,
          signal: { type: last.type, reason: last.reason || '-' },
          signals: ctx.signals.length,
          score: score ? score.score : null, scoreDetail: score
        });
      }
    }
    return { ok: true, totalTargets: contracts.length, skipped, fetched, results, time: new Date().toISOString() };
  }

  // ── 对候选批量做 5 信号评分并排名（供 AI 二轮分析的"第一轮结果"）──
  function scoreAll(items) {
    if (!window.Scoring) return items.map(it => Object.assign({}, it, { score: null, rank: null }));
    return window.Scoring.scoreAndRank(items.map(it => ({
      code: it.code, name: it.name, price: it.price, klines: it.klines || readKlineCache(it.code, 101) || []
    })));
  }

  return { screenWithCode, screenMultiPeriod, scoreEma26, scoreAll, Store, cacheKline, readKlineCache, getContracts };
})();
