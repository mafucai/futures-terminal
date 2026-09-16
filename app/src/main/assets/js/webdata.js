/* =============================================
   webdata.js — 期货数据源（浏览器版）
   原 server/data-source.js + rate-limiter.js 合体
   网络请求走 Android 原生桥（绕开 CORS + 支持 GBK）
   ============================================= */
window.WebData = (function () {
  'use strict';

  const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36";

  // ── 限速器（原 rate-limiter.js） ──
  const limiter = {
    intervalMs: 300, maxPerMin: 60,
    _queue: Promise.resolve(), _ts: [], _count: 0,
    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
    async schedule(fn) {
      const now = Date.now();
      this._ts = this._ts.filter(t => now - t < 60000);
      if (this._ts.length >= this.maxPerMin) {
        await this._sleep(60000 - (now - this._ts[0]));
      }
      this._ts.push(Date.now());
      const task = this._queue.then(async () => {
        await this._sleep(this.intervalMs);
        this._count++;
        return await fn();
      });
      this._queue = task.catch(() => {});
      return task;
    }
  };

  // ── 网络：优先走 Android 原生桥，其次浏览器 fetch ──
  function hasBridge() {
    return typeof window.Android !== 'undefined' && window.Android.httpGet;
  }

  async function httpGet(url, referer) {
    if (hasBridge()) {
      const ref = referer || 'https://quote.eastmoney.com/';
      // 原生同步阻塞实现，返回字符串
      const text = window.Android.httpGet(url, UA, ref);
      if (text && text.startsWith('__ERR__')) throw new Error(text.slice(7));
      return text;
    }
    // 回退：浏览器直接 fetch（仅本地/开发可行）
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': referer || 'https://quote.eastmoney.com/' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  }

  async function fetchJson(url, timeoutMs = 8000) {
    const text = await httpGet(url);
    return JSON.parse(text);
  }

  // ── 市场代码映射 ──
  const MARKET_MAP = {
    sc:142, lu:142, ec:142, nr:142, bc:142,
    l:114, v:114, pp:114, eg:114, eb:114, pg:114,
    m:114, y:114, p:114, c:114, cs:114, a:114, b:114,
    jd:114, lh:114, rr:114, fb:114, bb:114, i:114,
    sr:115, ta:115, ma:115, fg:115, cf:115, zc:115,
    rm:115, oi:115, ap:115, sa:115, ur:115, cj:115,
    pk:115, jr:115, lr:115, cy:115, gn:115, px:115,
    sh:115, pf:115, si:115, sm:115, sf:115,
  };
  function getMarket(code) {
    return MARKET_MAP[(code || '').toLowerCase().slice(0, 2)] || 113;
  }

  // ── 1. 全部期货列表 ──
  async function futureList() {
    return limiter.schedule(async () => {
      const hosts = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com'];
      const markets = ['m:113', 'm:142', 'm:114', 'm:115', 'm:118'];
      let all = [];
      for (const host of hosts) {
        try {
          for (const market of markets) {
            const items = await _fetchMarket(host, market);
            all = all.concat(items);
          }
          break;
        } catch (e) { /* 降级 */ }
      }
      const seen = new Set();
      return all.filter(item => {
        if (seen.has(item.code)) return false;
        seen.add(item.code);
        return true;
      });
    });
  }

  async function _fetchMarket(host, market) {
    const all = [];
    const qs = `?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${market}&fields=f2,f3,f4,f12,f14,f15,f16,f17,f18`;
    const d1 = await fetchJson(host + '/api/qt/clist/get' + qs);
    const total = (d1.data || {}).total || 0;
    const page1 = (d1.data || {}).diff || [];
    all.push(...(Array.isArray(page1) ? page1 : Object.values(page1)));
    const pages = Math.ceil(total / 100);
    for (let pn = 2; pn <= pages; pn++) {
      const q = `?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${market}&fields=f2,f3,f4,f12,f14,f15,f16,f17,f18`;
      const dn = await fetchJson(host + '/api/qt/clist/get' + q);
      const diff = (dn.data || {}).diff || [];
      all.push(...(Array.isArray(diff) ? diff : Object.values(diff)));
    }
    return all.map(it => ({
      code: it.f12 || '', name: it.f14 || '',
      price: it.f2, changePct: it.f3, changeAmt: it.f4,
      open: it.f15, high: it.f16, low: it.f17, lastClose: it.f18
    }));
  }

  // ── 新浪代码转换 ──
  function fixSinaCode(code) {
    const c = String(code || '').toLowerCase();
    if (c.endsWith('m') || c.endsWith('s')) return c.slice(0, -1) + '0';
    if (/^[a-z]+$/.test(c)) return c + '0';
    const m = c.match(/^([a-z]+)(\d+)$/);
    if (m) {
      if (m[2].length === 3) return m[1] + '2' + m[2];
      return c;
    }
    return c;
  }

  function toSinaCode(code) {
    const c = String(code || '').toUpperCase();
    if (!c) return '';
    if (/^[A-Z]+\d+$/.test(c)) return c;
    if (c.endsWith('M')) return c.slice(0, -1) + '0';
    return c + '0';
  }

  const SINA_HOSTS = [
    'https://stock2.finance.sina.com.cn',
    'https://stock.finance.sina.com.cn',
  ];

  async function _sinaDailyKline(sinaCode, limit) {
    let lastErr = null;
    for (const host of SINA_HOSTS) {
      try {
        const url = `${host}/futures/api/jsonp.php/var%20_x=/InnerFuturesNewService.getDailyKLine?symbol=${sinaCode}`;
        const text = await httpGet(url, 'https://finance.sina.com.cn/');
        if (!text.includes('var _x=') || !text.includes('"d":')) throw new Error('无数据');
        const m = text.match(/\[(.*)\]/s);
        if (!m) throw new Error('解析失败');
        const raw = JSON.parse('[' + m[1] + ']');
        if (raw && raw.length) {
          return raw.slice(-limit).map(item => ({
            time: item.d, open: parseFloat(item.o), close: parseFloat(item.c),
            high: parseFloat(item.h), low: parseFloat(item.l),
            volume: parseFloat(item.v), amount: 0,
          }));
        }
      } catch (e) { lastErr = e; }
    }
    throw new Error('新浪日K全部失败: ' + (lastErr && lastErr.message));
  }

  async function _sinaMinKline(sinaCode, period, limit) {
    let lastErr = null;
    for (const host of SINA_HOSTS) {
      try {
        const url = `${host}/futures/api/jsonp.php/var%20_x=/InnerFuturesNewService.getFewMinLine?symbol=${sinaCode}&type=${period}`;
        const text = await httpGet(url, 'https://finance.sina.com.cn/');
        if (!text.includes('var _x=') || !text.includes('"d":')) throw new Error('无数据');
        const m = text.match(/\[(.*)\]/s);
        if (!m) throw new Error('解析失败');
        const raw = JSON.parse('[' + m[1] + ']');
        if (raw && raw.length) {
          return raw.slice(-limit).map(item => ({
            time: item.d, open: parseFloat(item.o), close: parseFloat(item.c),
            high: parseFloat(item.h), low: parseFloat(item.l),
            volume: parseFloat(item.v), amount: 0,
          }));
        }
      } catch (e) { lastErr = e; }
    }
    throw new Error('新浪分钟K全部失败: ' + (lastErr && lastErr.message));
  }

  async function _emKlineFallback(code, period, limit) {
    const mkt = getMarket(code);
    const hosts = ['https://push2his.eastmoney.com', 'https://push2delay.eastmoney.com'];
    for (const host of hosts) {
      try {
        const url = `${host}/api/qt/stock/kline/get?secid=${mkt}.${code}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&klt=${period}&fqt=1&end=20500101&lmt=${limit}`;
        const d = await fetchJson(url);
        const klines = (d.data || {}).klines || [];
        if (klines.length) {
          return klines.map(line => {
            const p = line.split(',');
            return { time: p[0], open: parseFloat(p[1]), close: parseFloat(p[2]),
                     high: parseFloat(p[3]), low: parseFloat(p[4]),
                     volume: parseFloat(p[5]), amount: parseFloat(p[6]) };
          });
        }
      } catch (e) { /* 下一个 */ }
    }
    return [];
  }

  // ── 2. K线（周期：101日 240四小时 60/30/15/5/1分钟） ──
  async function futureKline(code, period = 101, limit = 200) {
    return limiter.schedule(async () => {
      const sinaCode = fixSinaCode(code);

      if (period === 101) {
        try { return await _sinaDailyKline(sinaCode, limit); }
        catch (e) { return _emKlineFallback(code, period, limit); }
      }

      if (period === 240) {
        try {
          const hour60 = await _sinaMinKline(sinaCode, 60, limit * 4);
          if (!hour60.length) return [];
          const agg = [];
          for (let i = 0; i < hour60.length; i += 4) {
            const group = hour60.slice(i, i + 4);
            if (!group.length) break;
            agg.push({
              time: group[group.length - 1].time,
              open: group[0].open,
              close: group[group.length - 1].close,
              high: Math.max(...group.map(g => g.high)),
              low: Math.min(...group.map(g => g.low)),
              volume: group.reduce((a, g) => a + g.volume, 0),
              amount: group.reduce((a, g) => a + (g.amount || 0), 0)
            });
          }
          return agg;
        } catch (e) { return _emKlineFallback(code, period, limit); }
      }

      if ([1, 5, 15, 30, 60].includes(period)) {
        try { return await _sinaMinKline(sinaCode, period, limit); }
        catch (e) { return _emKlineFallback(code, period, limit); }
      }

      return _emKlineFallback(code, period, limit);
    });
  }

  // ── 3. 实时行情 ──
  function parseSinaQuote(code, line) {
    const vals = line.split(',');
    if (!vals || vals.length < 18) return null;
    const trade = parseFloat(vals[5]);
    const preSettle = parseFloat(vals[10]) || 0;
    return {
      code, name: vals[0] || code, price: trade,
      open: parseFloat(vals[2]), high: parseFloat(vals[3]), low: parseFloat(vals[4]),
      close: parseFloat(vals[8]), lastClose: preSettle,
      changeAmt: trade - preSettle,
      changePct: preSettle ? ((trade - preSettle) / preSettle * 100) : 0,
      bid: parseFloat(vals[6]), ask: parseFloat(vals[7]),
      position: parseFloat(vals[13]), volume: parseFloat(vals[14]),
      exchange: vals[15], product: vals[16], date: vals[17],
      time: vals[1], source: 'sina-hq'
    };
  }

  async function sinaQuoteBatch(codes) {
    const list = codes.map(toSinaCode).map(c => 'nf_' + c).join(',');
    if (!list) return {};
    try {
      const url = `https://hq.sinajs.cn/rn=${Date.now()}&list=${list}`;
      // 关键：新浪返回 GBK，走原生桥的 GBK 解码
      let text;
      if (hasBridge() && window.Android.httpGetGbk) {
        text = window.Android.httpGetGbk(url, UA, 'https://vip.stock.finance.sina.com.cn/');
        if (text && text.startsWith('__ERR__')) throw new Error(text.slice(7));
      } else {
        text = await httpGet(url, 'https://vip.stock.finance.sina.com.cn/');
      }
      const result = {};
      codes.forEach((origCode) => {
        const m = text.match(new RegExp(`hq_str_nf_${toSinaCode(origCode)}="([^"]*)"`));
        if (m && m[1]) {
          const q = parseSinaQuote(origCode, m[1]);
          if (q) result[origCode] = q;
        }
      });
      return result;
    } catch (e) {
      return {};
    }
  }

  async function futureQuote(code) {
    return limiter.schedule(async () => {
      try {
        const qs = await sinaQuoteBatch([code]);
        if (qs[code]) return qs[code];
      } catch (e) { /* 降级 */ }

      const mkt = getMarket(code);
      const hosts = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com'];
      for (const host of hosts) {
        try {
          const url = `${host}/api/qt/stock/get?fltt=2&invt=2&secid=${mkt}.${code}&fields=f43,f44,f45,f46,f47,f48,f60,f57,f58,f169,f170`;
          const d = await fetchJson(url, 5000);
          const data = d.data || {};
          if (data.f58) {
            return { code: data.f57 || '', name: data.f58 || '', price: data.f43,
                     high: data.f44, low: data.f45, open: data.f46,
                     lastClose: data.f47, changePct: data.f170 || 0,
                     volume: data.f60, changeAmt: data.f169 || 0, source: 'em' };
          }
        } catch (e) { /* 下一个 */ }
      }
      return null;
    });
  }

  return { futureList, futureKline, futureQuote, sinaQuoteBatch, toSinaCode, fixSinaCode, limiter };
})();
