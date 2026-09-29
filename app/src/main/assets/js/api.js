/* ═══ API 适配层（App 本地版 · 无后端）═══
   作用：让界面继续用 API.xxx(...) 调用，但底层走本机模块——
         WebData（数据源，经 Android 原生桥）/ Screener / StrategyRunner / Scoring。
   为什么：App 是纯前端离线运行，没有 /api/* 服务器。
   兼容：若运行在浏览器且存在后端，可设 window.FT_USE_HTTP=true 回退到 fetch。
*/
(function () {
  'use strict';

  const WD = window.WebData;
  const SCR = window.Screener;
  const SCORING = window.Scoring;
  const USE_HTTP = window.FT_USE_HTTP === true;

  const BT_PERIOD = 101;

  function hasBridge() {
    return typeof window.Android !== 'undefined' && window.Android.httpGet;
  }

  /* ── 通用 HTTP 回退（仅浏览器+后端场景） ── */
  async function httpReq(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  /* ── 策略本地存取 ──
     唯一事实源 = StrategyLibrary（js/strategy-library.js），本层不得再碰 fv2_strategy 键。
     依赖顺序由 index.html 保证：strategy-library.js(314) 先于 api.js(321) 加载。
     加固：万一未来顺序被改坏，这里立刻报错而不是静默用旧键（防止「数据未接通」重现）。 */
  function getStrategy() {
    if (!window.StrategyLibrary) throw new Error('StrategyLibrary 模块未加载（检查 index.html 脚本顺序）');
    StrategyLibrary.own('fv2_strategy', 'api.js:read');   // ← 声明读权限
    return StrategyLibrary.getMain();
  }
  function saveStrategy(code) {
    if (!window.StrategyLibrary) throw new Error('StrategyLibrary 模块未加载（检查 index.html 脚本顺序）');
    StrategyLibrary.own('fv2_strategy', 'api.js:write');  // ← 声明写权限
    return StrategyLibrary.setMain(code);
  }

  /* ═══ 对外接口（与后端版同名，界面无需改） ═══ */
  const API = {
    /* 1. 期货列表 */
    futuresAll(refresh) {
      if (USE_HTTP) return httpReq('/api/futures/all' + (refresh ? '?refresh=1' : ''));
      return (async () => {
        const cached = SCR.Store.loadFutures();
        if (!refresh && cached && cached.data) return cached;
        const list = await WD.futureList();
        const map = {};
        list.forEach(it => { map[it.code] = it; });
        const payload = { data: map, list, time: new Date().toISOString() };
        SCR.Store.saveFutures(payload);
        return payload;
      })();
    },

    /* 2. 实时行情 */
    quote(code) {
      if (USE_HTTP) return httpReq('/api/quote?code=' + encodeURIComponent(code));
      return WD.futureQuote(code);
    },

    /* 3. K线 + 指标 */
    kline(code, period, limit) {
      if (USE_HTTP) return httpReq(`/api/kline?code=${encodeURIComponent(code)}&period=${period}&limit=${limit || 200}`);
      return (async () => {
        const p = period || BT_PERIOD;
        // 只读本地缓存：**不主动联网**。无缓存时明确提示，由用户点「拉取K线」手动更新。
        const klines = SCR.readKlineCache(code, p);
        if (!klines || !klines.length) {
          throw new Error('本地暂无该周期K线，请点「⟳ 拉取K线」手动更新（不自动联网）');
        }
        const indicators = window.Indicators ? window.Indicators.calculateAll(klines) : {};
        return { code, period: p, count: klines.length, klines, indicators };
      })();
    },

    /* 3b. 手动拉取 / 增量更新单合约单周期K线（唯一允许联网的K线入口） */
    klineUpdate(code, period, limit) {
      if (USE_HTTP) return httpReq(`/api/kline?code=${encodeURIComponent(code)}&period=${period}&limit=${limit || 300}&refresh=1`);
      return (async () => {
        const p = period || BT_PERIOD;
        const r = await SCR.updateKlineIncremental(code, p, limit || 300);
        if (!r.ok) throw new Error('该合约该周期暂无数据');
        const klines = SCR.readKlineCache(code, p) || [];
        const indicators = window.Indicators ? window.Indicators.calculateAll(klines) : {};
        return { code, period: p, count: klines.length, added: r.added, updated: r.updated, total: r.total, klines, indicators };
      })();
    },

    /* 4. 策略读写 */
    getStrategy() {
      if (USE_HTTP) return httpReq('/api/strategy');
      return Promise.resolve({ code: getStrategy() });
    },

    /* 4b. 策略库：主策略 + 对比页保存的多套策略（供模拟盘/对比选择）
       数据源统一走 StrategyLibrary（唯一事实源），本层不解析共享键。 */
    listStrategies() {
      if (!window.StrategyLibrary) return Promise.reject(new Error('StrategyLibrary 模块未加载（检查 index.html 脚本顺序）'));
      return Promise.resolve({ strategies: StrategyLibrary.all() });
    },
    saveStrategy(code) {
      if (USE_HTTP) return httpReq('/api/strategy', { method: 'POST', body: { code } });
      return Promise.resolve(saveStrategy(code));
    },

    /* 5. 策略筛选（含 5 信号评分） */
    screen(body) {
      if (USE_HTTP) return httpReq('/api/screen', { method: 'POST', body });
      return (async () => {
        const code = getStrategy();
        if (!code.trim()) throw new Error('未保存策略，无法筛选');
        const { mainOnly = false, multi = false, liveFetch = false } = body || {};
        let raw;
        if (multi) {
          raw = await SCR.screenMultiPeriod(code, { mainOnly, liveFetch });
          // 多周期已有 scoreEma26；再用 5 信号覆盖为统一口径（有 K 线时）
          raw.results = raw.results.map(r => {
            const kl = SCR.readKlineCache(r.code, 101) || SCR.readKlineCache(r.code, 60) || [];
            const sc = SCORING ? SCORING.scoreContract(kl) : null;
            return Object.assign({}, r, {
              score: sc && sc.ok ? sc.score : r.score,
              grade: sc ? sc.grade : null,
              rules: sc ? sc.rules : [],
              summary: sc ? sc.summary : null,
              scoreDetail: sc || r.scoreDetail
            });
          });
        } else {
          raw = await SCR.screenWithCode(code, BT_PERIOD, { mainOnly, liveFetch });
        }
        // 排名
        const ok = raw.results.filter(r => typeof r.score === 'number').sort((a, b) => b.score - a.score);
        ok.forEach((r, i) => { r.rank = i + 1; });
        const rest = raw.results.filter(r => typeof r.score !== 'number');
        return {
          ok: true, totalTargets: raw.totalTargets, skipped: raw.skipped, fetched: raw.fetched,
          results: ok.concat(rest),
          scoring: { weights: SCORING ? SCORING.DEFAULT_WEIGHTS : null, explainable: true },
          time: new Date().toISOString(),
          disclaimer: '信号强度评分，非涨跌预测，不构成投资建议'
        };
      })();
    },

    /* 6. 单合约评分 */
    score(code, period) {
      if (USE_HTTP) return httpReq(`/api/score?code=${encodeURIComponent(code)}&period=${period || BT_PERIOD}`);
      return (async () => {
        const kl = SCR.readKlineCache(code, period || BT_PERIOD);
        if (!kl) throw new Error('无缓存数据，请先在行情页载入');
        if (!SCORING) throw new Error('评分模块未加载');
        return Object.assign({ code, period: period || BT_PERIOD }, SCORING.scoreContract(kl));
      })();
    },

    /* 7. 回测（本地 StrategyRunner + Backtest） */
    backtest(body) {
      if (USE_HTTP) return httpReq('/api/backtest', { method: 'POST', body });
      return (async () => {
        const { code, period = BT_PERIOD, multi = false, limit = 200 } = body || {};
        const code_ = getStrategy();
        if (!code_.trim()) throw new Error('未保存策略，无法回测');
        const BT = window.Backtest;
        if (!BT) throw new Error('回测模块未加载');
        const spec = window.Specs ? Specs.get(code) : null;
        if (multi) {
          // 只读缓存，不主动联网；缺数据请先在详情页「⟳ 拉取K线」
          const k4h = SCR.readKlineCache(code, 240);
          const k1h = SCR.readKlineCache(code, 60);
          if (!k4h || !k1h) throw new Error('本地缺 4H/60分 缓存，请先在 K线详情页手动「⟳ 拉取K线」');
          return BT.runMultiPeriodBacktest(k4h, k1h, code_, { spec });
        }
        const kl = SCR.readKlineCache(code, period);
        if (!kl || !kl.length) throw new Error('本地无该周期K线，请先在 K线详情页手动「⟳ 拉取K线」');
        return BT.runBacktest(kl, code_, { spec });
      })();
    },

    /* 7b. 用「指定的策略文本」回测（策略对比用；仍只读本地缓存，不联网） */
    backtestWith(strategyCode, body) {
      if (USE_HTTP) return httpReq('/api/backtest', { method: 'POST', body: Object.assign({ strategy: strategyCode }, body) });
      return (async () => {
        const { code, period = BT_PERIOD, multi = false, limit = 200 } = body || {};
        if (!strategyCode || !String(strategyCode).trim()) throw new Error('该策略为空');
        const BT = window.Backtest;
        if (!BT) throw new Error('回测模块未加载');
        const spec = window.Specs ? Specs.get(code) : null;
        if (multi) {
          const k4h = SCR.readKlineCache(code, 240);
          const k1h = SCR.readKlineCache(code, 60);
          if (!k4h || !k1h) throw new Error('本地缺 4H/60分 缓存');
          return BT.runMultiPeriodBacktest(k4h, k1h, strategyCode, { spec });
        }
        const kl = SCR.readKlineCache(code, period);
        if (!kl || !kl.length) throw new Error('本地无该周期K线（请先拉取）');
        return BT.runBacktest(kl, strategyCode, { spec });
      })();
    },

    /* 8. 监控（本地轮询） */
    monitorStart(body) {
      if (USE_HTTP) return httpReq('/api/monitor/start', { method: 'POST', body });
      return Promise.resolve({ ok: true, running: true, codes: (body && body.codes) || [] });
    },
    monitorStop() {
      if (USE_HTTP) return httpReq('/api/monitor/stop', { method: 'POST' });
      return Promise.resolve({ ok: true, running: false });
    },

    /* 9. 清缓存 */
    cacheClear() {
      if (USE_HTTP) return httpReq('/api/cache/clear', { method: 'POST' });
      try {
        const n = Object.keys(localStorage).filter(k => k.indexOf(SCR.Store._k) === 0).length;
        Object.keys(localStorage).filter(k => k.indexOf(SCR.Store._k) === 0).forEach(k => localStorage.removeItem(k));
        return Promise.resolve({ ok: true, cleared: n });
      } catch (e) { return Promise.resolve({ ok: true, cleared: 0 }); }
    },

    /* 10. 健康检查（本地恒为就绪） */
    health() {
      if (USE_HTTP) return httpReq('/api/health');
      return Promise.resolve({ ok: true, mode: 'local-app', bridge: hasBridge(), scoring: !!SCORING });
    },

    /* 10b. 增量更新一批合约的K线（唯一批量联网入口，必须用户手动触发）
       语义：对每个 code × period，拉最新K线并与本地缓存**合并**（旧数据不删不动，只补新增）。
       返回：{ ok, total, done, added, updated, failed:[...], items:[...] }，onProgress 回调可用于进度条。 */
    async incrementalUpdate(codes, periods, onProgress) {
      const list = (codes || []).filter(Boolean);
      const ps = (periods && periods.length) ? periods : [101, 240, 60];
      const items = [];
      let done = 0, added = 0, updated = 0;
      const failed = [];
      const total = list.length * ps.length;
      for (const code of list) {
        for (const p of ps) {
          try {
            const r = await SCR.updateKlineIncremental(code, p, 300);
            if (r.ok) { added += r.added; updated += r.updated; items.push(r); }
            else failed.push(`${code}/${p}`);
          } catch (e) {
            failed.push(`${code}/${p}:${e.message}`);
          }
          done++;
          if (typeof onProgress === 'function') onProgress(done, total, code, p);
        }
      }
      // 记录最近一次增量更新时间（供界面显示）
      try { localStorage.setItem('fv2_last_update', new Date().toISOString()); } catch (e) { /* ignore */ }
      return { ok: true, total, done, added, updated, failed, items, at: new Date().toISOString() };
    },

    /* 10c. 记录/读取最近一次「行情列表」更新时间 */
    lastUpdate() {
      let t = null;
      try { t = localStorage.getItem('fv2_last_update'); } catch (e) { /* ignore */ }
      return Promise.resolve({ at: t });
    },

    /* 10d. 从本地合约清单选择主连或全部合约。 */
    _cachedCodes(opts) {
      const onlyMain = !(opts && opts.all);
      const fut = SCR.Store.loadFutures();
      if (!fut || !fut.data) throw new Error('本地还没有合约清单，请先点「📂 载入行情」');
      let codes = Object.keys(fut.data);
      if (onlyMain) codes = codes.filter(c => /m$/i.test(c));
      if (!codes.length) throw new Error(onlyMain ? '本地合约清单中没有主连合约' : '本地合约清单为空');
      return codes;
    },

    /* 一键增量更新：拉最近 300 根并合并，旧数据不删。 */
    async incrementalUpdateAll(periods, onProgress, opts) {
      const codes = this._cachedCodes(opts);
      return this.incrementalUpdate(codes, periods, onProgress);
    },

    /* 一键全量历史：日线 1000 根，4H/60分各 500 根，覆盖对应缓存。 */
    async fullHistoryAll(periods, onProgress, opts) {
      const codes = this._cachedCodes(opts);
      const ps = (periods && periods.length) ? periods : [101];
      const limits = { 101: 1000, 240: 500, 60: 500 };
      const items = [], failed = [];
      let done = 0, bars = 0;
      const total = codes.length * ps.length;
      for (const code of codes) {
        for (const p of ps) {
          try {
            const r = await SCR.updateKlineFull(code, p, limits[p] || 500);
            if (r.ok) { bars += r.total; items.push(r); }
            else failed.push(`${code}/${p}`);
          } catch (e) {
            failed.push(`${code}/${p}:${e.message}`);
          }
          done++;
          if (typeof onProgress === 'function') onProgress(done, total, code, p);
        }
      }
      try { localStorage.setItem('fv2_last_full_update', new Date().toISOString()); } catch (e) { /* ignore */ }
      return { ok: true, total, done, bars, failed, items, mode: 'full', at: new Date().toISOString() };
    },

    /* ═══ AI（走原生桥 httpPost；无桥则明确报错，不静默） ═══ */
    aiModels(baseUrl, key) {
      return aiCall({ baseUrl, key, pathname: '/models', method: 'GET' });
    },
    aiAnalyze(body) {
      const { baseUrl, key, model, candidates, topN } = body || {};
      if (!candidates || !candidates.length) return Promise.reject(new Error('缺少第一轮候选；AI 不得凭空选标的'));
      const sys = '你是商品期货的辅助研究助手。规则：1) 不得虚构财务数据，缺数据必须输出「无法判断」；2) 结论须给出来源；3) 只分析给定候选，不得新增标的；4) 只输出严格 JSON；5) 不构成投资建议。';
      const payload = {
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: buildAiPrompt(candidates, topN) }
        ]
      };
      return aiCall({ baseUrl, key, pathname: '/chat/completions', method: 'POST', json: payload })
        .then(data => {
          const raw = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
          const parsed = extractJson(raw);
          if (!parsed) throw new Error('AI 返回无法解析为 JSON');
          const record = { time: new Date().toISOString(), model, topN: Math.min(topN || 3, candidates.length), results: validateResult(parsed, candidates) };
          appendHistory(record);
          return record;
        });
    },
    aiHistory(limit) {
      try {
        const arr = JSON.parse(localStorage.getItem('fv2_ai_history') || '[]');
        return Promise.resolve({ history: arr.slice(-(limit || 10)).reverse() });
      } catch { return Promise.resolve({ history: [] }); }
    },

    _useHttp: USE_HTTP
  };

  /* ── AI 调用 / prompt / 解析：已拆到 js/ai-core.js（api.js 原 455 行超 §2.1 阈值） ── */
  const AICore = window.AICore;
  if (!AICore) throw new Error('ai-core.js 模块未加载（检查 index.html 脚本顺序）');
  const aiCall = AICore.aiCall;
  const buildAiPrompt = AICore.buildAiPrompt;
  const extractJson = AICore.extractJson;
  const validateResult = AICore.validateResult;

  function appendHistory(record) {
    try {
      const arr = JSON.parse(localStorage.getItem('fv2_ai_history') || '[]');
      arr.push(record);
      while (arr.length > 50) arr.shift();
      localStorage.setItem('fv2_ai_history', JSON.stringify(arr));
    } catch { /* 历史失败不影响主流程 */ }
  }

  window.API = API;
  window.API._extractJson = AICore.extractJson;
  window.API._validateResult = AICore.validateResult;
})();
