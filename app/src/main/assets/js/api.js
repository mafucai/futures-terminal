/* =============================================
   api.js — 本地 API 层（浏览器版，替代原 HTTP 后端）
   原 server/server.js 的所有路由逻辑，改为直接调用本地模块
   保持与前端 views 完全一致的接口签名
   ============================================= */
window.API = (function () {
  'use strict';
  const WD = window.WebData;
  const IND = window.Indicators;
  const BT = window.Backtest;
  const SCR = window.Screener;
  const Store = window.Screener.Store;

  const CACHE_FUTURES = 'fv2_futures';
  const STRATEGY_KEY = 'fv2_strategy';

  // ── 策略读写（原 /api/strategy），改用 localStorage ──
  function getStrategyContent() {
    try { return localStorage.getItem(STRATEGY_KEY) || ''; } catch (e) { return ''; }
  }
  function saveStrategyContent(content) {
    try { localStorage.setItem(STRATEGY_KEY, content); return true; } catch (e) { return false; }
  }

  // ── /api/futures/all ──
  async function getFutures(refresh) {
    if (!refresh) {
      const cached = Store.loadFutures();
      if (cached && cached.data && Object.keys(cached.data).length > 0) {
        return { ok: true, total: Object.keys(cached.data).length, data: cached.data, cached: true, time: cached.time };
      }
    }
    const list = await WD.futureList();
    const results = {};
    for (const item of list) {
      results[item.code] = {
        price: item.price, changePct: item.changePct, changeAmt: item.changeAmt,
        name: item.name, open: item.open, high: item.high, low: item.low,
        lastClose: item.lastClose, code: item.code
      };
    }
    const payload = { data: results, time: new Date().toISOString() };
    Store.saveFutures(payload);
    return { ok: true, total: Object.keys(results).length, data: results, cached: false, time: payload.time };
  }

  // ── /api/quote ──
  async function getQuote(codes) {
    const data = await WD.sinaQuoteBatch(codes);
    return { ok: true, data, total: Object.keys(data).length };
  }

  // ── /api/kline ──
  async function getKline(code, period = 101, limit = 200, refresh = false) {
    period = parseInt(period);
    let klines = null;
    if (!refresh) klines = SCR.readKlineCache(code, period);
    if (!klines || klines.length < 20) {
      klines = await WD.futureKline(code, period, limit);
      if (klines && klines.length) SCR.cacheKline(code, period, klines, code);
    }
    if (!klines || !klines.length) throw new Error('无K线数据');
    const indicators = IND.calculateAll(klines);
    return { ok: true, code, period, klines, indicators, total: klines.length };
  }

  // ── /api/strategy ──
  async function getStrategy() {
    return { ok: true, content: getStrategyContent() };
  }
  async function saveStrategy(content) {
    if (typeof content !== 'string') throw new Error('策略内容无效');
    saveStrategyContent(content);
    return { ok: true, saved: true, message: '策略已保存到本地' };
  }

  // ── /api/screen ──
  // 兼容前端签名 screen(content, period, { mainOnly, multi })
  async function screen(strategy, period = 101, opts = {}) {
    const { multi = false, ...rest } = opts || {};
    try {
      const res = multi
        ? await SCR.screenMultiPeriod(strategy, rest)
        : await SCR.screenWithCode(strategy, period, rest);
      return res;
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // ── /api/screen multi ──
  async function screenMulti(strategy, opts = {}) {
    try {
      return await SCR.screenMultiPeriod(strategy, opts);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // ── /api/backtest ──
  async function backtest(code, period = 101, limit = 200, strategy = null, params = {}, multi = false) {
    try {
      if (!strategy) strategy = getStrategyContent();
      if (!strategy || !strategy.trim()) throw new Error('策略内容为空，请先在策略编辑器编写并保存策略');

      const cfg = params || {};
      if (multi) {
        const [k4h, k1h] = await Promise.all([
          WD.futureKline(code, 240, limit),
          WD.futureKline(code, 60, limit * 2),
        ]);
        if (!k4h.length || !k1h.length) throw new Error('无K线数据（4H/1H）');
        const report = await BT.runMultiPeriodBacktest(k4h, k1h, strategy, cfg);
        return report;
      }
      const klines = await WD.futureKline(code, parseInt(period), limit);
      if (!klines.length) throw new Error('无K线数据');
      return await BT.runBacktest(klines, strategy, cfg);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  // ── 监控（本地实例，非 HTTP） ──
  let _monitor = null;
  function monitorStart(contracts, strategy, onLog) {
    if (_monitor) _monitor.stop();
    _monitor = new window.FuturesMonitor.Monitor({ intervalSec: 30, onLog });
    _monitor.start({ contracts, strategyCode: strategy || getStrategyContent() });
    return { ok: true, running: true, count: contracts.length };
  }
  function monitorStop() {
    if (_monitor) _monitor.stop();
    return { ok: true, running: false };
  }
  function monitorIsRunning() { return !!(_monitor && _monitor.isRunning()); }
  function monitorLogs() { return _monitor ? _monitor.getLogs() : []; }

  function clearCache() {
    try {
      Object.keys(localStorage).filter(k => k.startsWith('fv2_kline_')).forEach(k => localStorage.removeItem(k));
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  function health() {
    return { ok: true, mode: 'local-webview', bridge: (typeof window.Android !== 'undefined') };
  }

  return {
    getFutures, getQuote, getKline,
    getStrategy, saveStrategy: (content) => saveStrategy(content),
    screen, screenMulti, backtest,
    monitorStart, monitorStop, monitorIsRunning, monitorLogs,
    clearCache, health,
  };
})();
