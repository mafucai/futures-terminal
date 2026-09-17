/* =============================================
   specs.js — 合约规格（乘数/保证金/手续费/最小变动价位）
   来源优先级：
     1) 本地缓存（localStorage['fv2_specs']）—— 由同花顺拉取后写入
     2) 内置兜底表（本文件 BUILTIN）—— 无 Key 也能用
     3) 品种级默认（10倍乘数/10%保证金）
   同花顺接口：GET https://fuyao.aicubes.cn/api/futures/varieties/list
              Header: X-api-key: <KEY>
   Key 仅存本机 localStorage['fv2_hithink_key']，**绝不入库**。
   详见 docs/HITHINK-FUYAO.md
   ============================================= */
window.Specs = (function () {
  'use strict';

  const SPECS_KEY = 'fv2_specs';
  const KEY_KEY = 'fv2_hithink_key';
  const API = 'https://fuyao.aicubes.cn/api/futures/varieties/list';

  /* 内置兜底表（交易所标准；乘数=每手每点盈亏，marginRate=保证金率，fee=元/手，feeRate=按成交额比例） */
  const BUILTIN = {
    // 上期所
    AG: { multiplier: 15, marginRate: 0.22, feeRate: 0.00005, unit: '千克/手' },
    AU: { multiplier: 1000, marginRate: 0.16, fee: 10, unit: '克/手' },
    CU: { multiplier: 5, marginRate: 0.11, feeRate: 0.00005, unit: '吨/手' },
    AL: { multiplier: 5, marginRate: 0.11, fee: 3, unit: '吨/手' },
    ZN: { multiplier: 5, marginRate: 0.11, fee: 3, unit: '吨/手' },
    PB: { multiplier: 5, marginRate: 0.11, feeRate: 0.00004, unit: '吨/手' },
    NI: { multiplier: 1, marginRate: 0.12, fee: 3, unit: '吨/手' },
    SN: { multiplier: 1, marginRate: 0.14, fee: 3, unit: '吨/手' },
    RB: { multiplier: 10, marginRate: 0.07, feeRate: 0.0001, unit: '吨/手' },
    HC: { multiplier: 10, marginRate: 0.07, feeRate: 0.0001, unit: '吨/手' },
    SS: { multiplier: 5, marginRate: 0.07, fee: 2, unit: '吨/手' },
    FU: { multiplier: 10, marginRate: 0.18, feeRate: 0.00005, unit: '吨/手' },
    BU: { multiplier: 10, marginRate: 0.12, feeRate: 0.0001, unit: '吨/手' },
    RU: { multiplier: 10, marginRate: 0.09, fee: 3, unit: '吨/手' },
    SP: { multiplier: 10, marginRate: 0.07, feeRate: 0.00005, unit: '吨/手' },
    SC: { multiplier: 1000, marginRate: 0.18, fee: 20, unit: '桶/手' },
    LU: { multiplier: 10, marginRate: 0.18, feeRate: 0.00001, unit: '吨/手' },
    NR: { multiplier: 10, marginRate: 0.09, feeRate: 0.00002, unit: '吨/手' },
    BC: { multiplier: 5, marginRate: 0.11, feeRate: 0.00001, unit: '吨/手' },
    AO: { multiplier: 20, marginRate: 0.11, feeRate: 0.0001, unit: '吨/手' },
    BR: { multiplier: 5, marginRate: 0.12, feeRate: 0.0001, unit: '吨/手' },
    EC: { multiplier: 50, marginRate: 0.22, feeRate: 0.00005, unit: '元/点' },
    // 大商所
    A: { multiplier: 10, marginRate: 0.07, fee: 2, unit: '吨/手' },
    B: { multiplier: 10, marginRate: 0.07, fee: 1, unit: '吨/手' },
    M: { multiplier: 10, marginRate: 0.07, fee: 1.5, unit: '吨/手' },
    Y: { multiplier: 10, marginRate: 0.07, fee: 2.5, unit: '吨/手' },
    P: { multiplier: 10, marginRate: 0.08, fee: 2.5, unit: '吨/手' },
    C: { multiplier: 10, marginRate: 0.07, fee: 1.2, unit: '吨/手' },
    CS: { multiplier: 10, marginRate: 0.06, fee: 1.5, unit: '吨/手' },
    I: { multiplier: 100, marginRate: 0.08, feeRate: 0.0001, unit: '吨/手' },
    J: { multiplier: 100, marginRate: 0.12, feeRate: 0.0001, unit: '吨/手' },
    JM: { multiplier: 60, marginRate: 0.12, feeRate: 0.0001, unit: '吨/手' },
    L: { multiplier: 5, marginRate: 0.07, fee: 1, unit: '吨/手' },
    V: { multiplier: 5, marginRate: 0.07, fee: 1, unit: '吨/手' },
    PP: { multiplier: 5, marginRate: 0.07, fee: 1, unit: '吨/手' },
    EG: { multiplier: 10, marginRate: 0.07, fee: 3, unit: '吨/手' },
    EB: { multiplier: 5, marginRate: 0.07, fee: 1, unit: '吨/手' },
    PG: { multiplier: 20, marginRate: 0.11, fee: 6, unit: '吨/手' },
    JD: { multiplier: 10, marginRate: 0.07, feeRate: 0.00015, unit: '吨/手' },
    LH: { multiplier: 16, marginRate: 0.08, feeRate: 0.0001, unit: '吨/手' },
    RR: { multiplier: 10, marginRate: 0.06, fee: 1, unit: '吨/手' },
    // 郑商所
    SR: { multiplier: 10, marginRate: 0.06, fee: 3, unit: '吨/手' },
    CF: { multiplier: 5, marginRate: 0.07, fee: 4.3, unit: '吨/手' },
    TA: { multiplier: 5, marginRate: 0.07, fee: 3, unit: '吨/手' },
    MA: { multiplier: 10, marginRate: 0.10, feeRate: 0.0001, unit: '吨/手' },
    FG: { multiplier: 20, marginRate: 0.09, fee: 6, unit: '吨/手' },
    SA: { multiplier: 20, marginRate: 0.08, feeRate: 0.0002, unit: '吨/手' },
    OI: { multiplier: 10, marginRate: 0.07, fee: 2, unit: '吨/手' },
    RM: { multiplier: 10, marginRate: 0.07, fee: 1.5, unit: '吨/手' },
    AP: { multiplier: 10, marginRate: 0.09, fee: 5, unit: '吨/手' },
    CJ: { multiplier: 5, marginRate: 0.08, fee: 3, unit: '吨/手' },
    UR: { multiplier: 20, marginRate: 0.08, feeRate: 0.0001, unit: '吨/手' },
    PF: { multiplier: 5, marginRate: 0.07, fee: 3, unit: '吨/手' },
    PK: { multiplier: 5, marginRate: 0.07, fee: 4, unit: '吨/手' },
    SF: { multiplier: 5, marginRate: 0.07, fee: 3, unit: '吨/手' },
    SM: { multiplier: 5, marginRate: 0.07, fee: 3, unit: '吨/手' },
    SH: { multiplier: 30, marginRate: 0.08, feeRate: 0.0001, unit: '吨/手' },
    PX: { multiplier: 5, marginRate: 0.07, feeRate: 0.0001, unit: '吨/手' },
    ZC: { multiplier: 100, marginRate: 0.50, fee: 150, unit: '吨/手' },
    // 广期所
    SI: { multiplier: 5, marginRate: 0.10, feeRate: 0.0001, unit: '吨/手' },
    LC: { multiplier: 1, marginRate: 0.15, feeRate: 0.00008, unit: '吨/手' },
    PS: { multiplier: 3, marginRate: 0.13, feeRate: 0.0001, unit: '吨/手' },
    // 中金所
    IF: { multiplier: 300, marginRate: 0.12, feeRate: 0.000023, unit: '元/点' },
    IC: { multiplier: 200, marginRate: 0.12, feeRate: 0.000023, unit: '元/点' },
    IH: { multiplier: 300, marginRate: 0.12, feeRate: 0.000023, unit: '元/点' },
    IM: { multiplier: 200, marginRate: 0.12, feeRate: 0.000023, unit: '元/点' },
    T: { multiplier: 10000, marginRate: 0.02, fee: 3, unit: '元/手' },
    TF: { multiplier: 10000, marginRate: 0.012, fee: 3, unit: '元/手' },
    TS: { multiplier: 20000, marginRate: 0.005, fee: 3, unit: '元/手' },
    TL: { multiplier: 10000, marginRate: 0.035, fee: 3, unit: '元/手' }
  };

  const DEFAULT_SPEC = { multiplier: 10, marginRate: 0.10, fee: 0, feeRate: 0, tickSize: 1, unit: '' };

  /* 合约代码 → 品种代码：取前导字母并大写，去掉主连/次主连后缀 m/s。
     agm/ags→AG, sc0→SC, SA609→SA, MA609→MA, i0→I */
  function varietyOf(code) {
    let s = String(code || '').toLowerCase();
    if (!s) return '';
    // 末尾 m/s（主连/次主连）且前面还有字母：去掉
    if (/^[a-z]{2,}[ms]$/.test(s)) s = s.slice(0, -1);
    const m = s.match(/^[a-zA-Z]+/);
    return m ? m[0].toUpperCase() : '';
  }

  function loadAll() {
    try { const s = localStorage.getItem(SPECS_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function saveAll(map) {
    try { localStorage.setItem(SPECS_KEY, JSON.stringify(map)); return true; } catch (e) { return false; }
  }

  /** 取某合约的规格：缓存 → 内置 → 默认 */
  function get(code) {
    const v = varietyOf(code);
    const cached = loadAll();
    let s = null, source = '默认';
    if (cached && v && cached[v]) { s = cached[v]; source = '同花顺缓存'; }
    else if (BUILTIN[v]) { s = BUILTIN[v]; source = '内置表'; }
    return Object.assign({ variety: v, source }, DEFAULT_SPEC, s || {});
  }

  function getKey() { try { return localStorage.getItem(KEY_KEY) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { localStorage.setItem(KEY_KEY, k || ''); return true; } catch (e) { return false; } }
  function maskKey(k) { return k ? ('****' + String(k).slice(-4)) : ''; }

  /**
   * 从同花顺拉取并缓存乘数表。
   * 需原生桥 httpGet（App 内）；浏览器回退 fetch。
   * @returns { ok, count, at } 或 throw
   */
  async function fetchFromHithink() {
    const key = getKey();
    if (!key) throw new Error('请先填写同花顺 API Key');
    let text;
    if (typeof window.Android !== 'undefined' && window.Android.httpGetWithHeadersJson) {
      // 同花顺必须走 X-api-key 请求头（query 参数不被接受）
      text = window.Android.httpGetWithHeadersJson(API, JSON.stringify({ 'X-api-key': key }));
      if (text && text.indexOf('__ERR__') === 0) throw new Error(text.slice(7));
    } else if (typeof window.Android !== 'undefined' && window.Android.httpGet) {
      // 旧桥兜底：无自定义头，很可能返回 Missing X-api-key
      text = window.Android.httpGet(API, 'Mozilla/5.0 (Linux; Android 13)', 'https://fuyao.aicubes.cn/');
      if (text && text.indexOf('__ERR__') === 0) throw new Error(text.slice(7));
    } else {
      const r = await fetch(API, { headers: { 'X-api-key': key } });
      text = await r.text();
    }
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('返回不是 JSON（可能 Key 无效或域名不通）'); }
    if (data.code !== 0) throw new Error('同花顺返回错误：' + (data.message || data.code));

    const items = (data.data && data.data.item) || [];
    const map = {};
    items.forEach(it => {
      const v = String(it.variety_code || '').toUpperCase();
      if (!v) return;
      map[v] = {
        multiplier: it.contract_multiplier != null ? it.contract_multiplier : 10,
        marginRate: it.margin_rate != null ? it.margin_rate : 0.10,
        fee: it.transaction_fee != null ? it.transaction_fee : 0,
        feeRate: it.transaction_fee_rate != null ? it.transaction_fee_rate / 10000 : 0,
        tickSize: it.tick_size != null ? it.tick_size : 1,
        unit: it.trade_unit || '',
        name: it.name || '',
        exchange: it.exchange_name || '',
        nightSession: !!it.has_night_session,
        mainContract: it.main_contract_thscode || ''
      };
    });
    saveAll(map);
    try { localStorage.setItem('fv2_specs_at', new Date().toISOString()); } catch (e) { /* ignore */ }
    return { ok: true, count: items.length, at: new Date().toISOString() };
  }

  function lastUpdate() { try { return localStorage.getItem('fv2_specs_at'); } catch (e) { return null; } }
  function cachedCount() { const m = loadAll(); return m ? Object.keys(m).length : 0; }

  return {
    BUILTIN, DEFAULT_SPEC, varietyOf, get, loadAll, saveAll,
    getKey, setKey, maskKey, fetchFromHithink, lastUpdate, cachedCount, API
  };
})();
