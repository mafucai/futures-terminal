/* AI 核心（纯逻辑层，从 api.js 拆出，遵守 CALL-GRAPH §2.1「单文件 ≤400 行」）
 *
 * 职责：AI 请求发送 + prompt 构造 + 返回解析/校验。**不碰任何存储键**（共享键归 api.js）。
 * 分层：本文件属「适配/引擎」层，向下依赖 WebData 之类，不碰 DOM、不碰 localStorage。
 * 依赖：需在 api.js 之前引入（api.js 通过 window.AICore 取用）。
 */
(function () {
  'use strict';

  /* ── AI 调用：优先原生桥 POST，其次 fetch（浏览器） ── */
  async function aiCall({ baseUrl, key, pathname, method = 'POST', json }) {
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw new Error('Base URL 必须是 http(s) 地址');
    const url = baseUrl.replace(/\/+$/, '') + pathname;
    const headers = key ? { Authorization: 'Bearer ' + key } : {};

    if (typeof window !== 'undefined' && window.Android && window.Android.httpPost) {
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

  window.AICore = { aiCall, buildAiPrompt, extractJson, validateResult };
})();
