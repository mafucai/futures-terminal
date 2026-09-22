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

  const STRATEGY_KEY = 'fv2_strategy';
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

  /* ── 策略本地存取 ── */
  function getStrategy() {
    try { return localStorage.getItem(STRATEGY_KEY) || ''; } catch { return ''; }
  }
  function saveStrategy(code) {
    try {
      localStorage.setItem(STRATEGY_KEY, code);
      return { ok: true, bytes: code.length };
    } catch (e) { throw new Error('本地保存失败：' + e.message); }
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

    /* 4b. 策略库：主策略 + 对比页保存的多套策略（供模拟盘/对比选择） */
    listStrategies() {
      const out = [{ id: 'main', name: '主策略（编辑器）', code: getStrategy() }];
      try {
        const arr = JSON.parse(localStorage.getItem('fv2_cmp_strategies') || '[]');
        arr.forEach((s, i) => out.push({ id: s.id || ('cmp' + i), name: s.name || ('策略 ' + (i + 1)), code: s.code || '' }));
      } catch (e) { /* ignore */ }
      return Promise.resolve({ strategies: out });
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

    /* 10d. 一键增量更新【全部合约】：合约清单取自本地 futures 缓存（不联网）。
       仅当本地没有合约清单时才提示先「载入行情」。all=true 时含非主连。 */
    async incrementalUpdateAll(periods, onProgress, opts) {
      const onlyMain = !(opts && opts.all);
      const fut = SCR.Store.loadFutures();
      if (!fut || !fut.data) throw new Error('本地还没有合约清单，请先点「📂 载入行情」');
      let codes = Object.keys(fut.data);
      if (onlyMain) codes = codes.filter(c => /m$/.test(c)); // 主连
      if (!codes.length) throw new Error('本地合约清单为空');
      return this.incrementalUpdate(codes, periods, onProgress);
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

  /* ── AI 调用：优先原生桥 POST，其次 fetch（浏览器） ── */
  async function aiCall({ baseUrl, key, pathname, method = 'POST', json }) {
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw new Error('Base URL 必须是 http(s) 地址');
    const url = baseUrl.replace(/\/+$/, '') + pathname;
    const headers = key ? { Authorization: 'Bearer ' + key } : {};

    if (hasBridge() && window.Android.httpPost) {
      const body = json ? JSON.stringify(json) : '';
      const text = window.Android.httpPost(url, body, JSON.stringify(headers));
      if (text && text.indexOf('__ERR__') === 0) throw new Error(text.slice(7));
      try { return JSON.parse(text); } catch { throw new Error('AI 响应不是 JSON'); }
    }
    // 浏览器回退
    const res = await fetch(url, {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: json ? JSON.stringify(json) : undefined
    });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && (data.error && (data.error.message || data.error) || data.message)) || ('HTTP ' + res.status);
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  }

  function buildAiPrompt(candidates, topN) {
    const top = candidates.slice(0, Math.max(1, Math.min(20, topN || 3)));
    return [
      '策略第一轮候选（Top ' + top.length + '，请勿替换）：',
      JSON.stringify(top.map(c => ({ code: c.code, name: c.name, score: c.score, rank: c.rank, rules: c.rules })), null, 2),
      '',
      '请对每个候选输出第二轮分析，严格 JSON：',
      '{"results":[{"code","name","originalScore","rank","fundamentalMatch"(0-100或"无法判断"),"riskLevel"("低"|"中"|"高"|"无法判断"),"riskReason","supportFactors":[],"vetoFactors":[],"aiScore"(0-100或"无法判断"),"finalRank","verdict","evidence":[{"field","value","source","asOf"}],"missing":[]}]}',
      '',
      '注意：缺少可靠基本面数据时，fundamentalMatch 与 aiScore 设为「无法判断」，并在 missing 列出缺失字段。'
    ].join('\n');
  }

  function extractJson(text) {
    if (!text) return null;
    const s = String(text).trim();
    try { return JSON.parse(s); } catch { /* continue */ }
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) { try { return JSON.parse(fence[1]); } catch { /* continue */ } }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* continue */ } }
    return null;
  }

  function validateResult(parsed, candidates) {
    const src = Array.isArray(parsed) ? parsed : (parsed.results || parsed.items || []);
    const byCode = new Map(candidates.map(c => [String(c.code), c]));
    const out = [];
    const missingGlobal = [];
    for (const item of src) {
      const code = String(item.code || '');
      const orig = byCode.get(code);
      if (!orig) continue; // 防 AI 编造标的
      const isNum = v => typeof v === 'number' && isFinite(v);
      out.push({
        code, name: item.name || orig.name || code,
        originalScore: orig.score != null ? orig.score : null,
        rank: orig.rank != null ? orig.rank : null,
        fundamentalMatch: isNum(item.fundamentalMatch) ? item.fundamentalMatch : '无法判断',
        riskLevel: ['低', '中', '高'].indexOf(item.riskLevel) >= 0 ? item.riskLevel : '无法判断',
        riskReason: String(item.riskReason || ''),
        supportFactors: Array.isArray(item.supportFactors) ? item.supportFactors : [],
        vetoFactors: Array.isArray(item.vetoFactors) ? item.vetoFactors : [],
        aiScore: isNum(item.aiScore) ? item.aiScore : '无法判断',
        finalRank: isNum(item.finalRank) ? item.finalRank : null,
        verdict: String(item.verdict || ''),
        evidence: Array.isArray(item.evidence) ? item.evidence : [],
        missing: Array.isArray(item.missing) ? item.missing : [],
        provenance: 'ai-generated'
      });
      if (Array.isArray(item.missing)) missingGlobal.push.apply(missingGlobal, item.missing);
    }
    for (const c of candidates) {
      if (!out.find(x => x.code === String(c.code))) {
        out.push({
          code: String(c.code), name: c.name || '', originalScore: c.score != null ? c.score : null, rank: c.rank != null ? c.rank : null,
          fundamentalMatch: '无法判断', riskLevel: '无法判断', riskReason: '',
          supportFactors: [], vetoFactors: [], aiScore: '无法判断', finalRank: null,
          verdict: 'AI 未返回该候选，保留第一轮结果', evidence: [], missing: ['AI 未覆盖'],
          provenance: 'fallback-first-round'
        });
      }
    }
    return out;
  }

  function appendHistory(record) {
    try {
      const arr = JSON.parse(localStorage.getItem('fv2_ai_history') || '[]');
      arr.push(record);
      while (arr.length > 50) arr.shift();
      localStorage.setItem('fv2_ai_history', JSON.stringify(arr));
    } catch { /* 历史失败不影响主流程 */ }
  }

  window.API = API;
  window.API._extractJson = extractJson;
  window.API._validateResult = validateResult;
})();
