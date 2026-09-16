/* =============================================
   scoring.js — 第一轮多信号加权评分（浏览器版 · 可解释）

   设计来源：借鉴 Polymarket 助手的「多信号 → 单一评分」思路，
             但标的/周期/数据源/用途全部为国内期货技术分析，
             措辞为「信号强度评分」而非「涨跌概率」（后者等于投资建议）。

   权重（用户钦定）：EMA 30 + MACD 25 + RSI 20 + KDJ 15 + ATR 10
   依赖：window.Indicators（本地指标模块）
   ============================================= */
window.Scoring = (function () {
  'use strict';

  const I = window.Indicators;
  const DEFAULT_WEIGHTS = { ema: 30, macd: 25, rsi: 20, kdj: 15, atr: 10 };
  const MIN_BARS = 30;

  const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const last = arr => {
    if (!Array.isArray(arr)) return null;
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = arr[i];
      if (v !== null && v !== undefined && Number.isFinite(v)) return v;
    }
    return null;
  };
  const at = (arr, i) => (Array.isArray(arr) && i >= 0 && i < arr.length && Number.isFinite(arr[i])) ? arr[i] : null;

  /* ── 各信号评分（0=极度看空, 50=中性, 100=极度看多；仅表示方向一致度）── */
  function scoreEma(klines, period) {
    const closes = klines.map(k => k.close);
    const emaArr = I.ema(closes, period);
    const price = closes[closes.length - 1];
    const line = last(emaArr);
    if (line === null || !Number.isFinite(price)) return { raw: null, score: 50, hit: false, detail: `EMA${period} 数据不足` };
    const dev = (price - line) / line * 100;
    let score = 50 + clamp(dev * 12, -50, 50);
    const ema12 = last(I.ema(closes, 12));
    const aligned = (ema12 !== null && line !== null) ? (ema12 > line ? 1 : -1) : 0;
    const dirUp = price > line;
    if (dirUp && aligned > 0) score += 6;
    if (!dirUp && aligned < 0) score -= 6;
    score = clamp(score);
    return {
      raw: { price, ema: Number(line.toFixed(2)), dev: Number(dev.toFixed(2)) },
      score, hit: dirUp,
      detail: `价 ${dirUp ? '>' : '<='} EMA${period}（偏离 ${dev >= 0 ? '+' : ''}${dev.toFixed(2)}%）`
    };
  }

  function scoreMacd(klines) {
    const closes = klines.map(k => k.close);
    const { dif, dea, hist } = I.macd(closes);
    const d0 = last(dif), e0 = last(dea), h0 = last(hist), h1 = at(hist, hist.length - 2);
    if (d0 === null || e0 === null) return { raw: null, score: 50, hit: false, detail: 'MACD 数据不足' };
    let score = 50;
    const golden = d0 > e0;
    score += golden ? 22 : -22;
    if (h0 !== null && h1 !== null) { if (h0 > h1) score += 8; else if (h0 < h1) score -= 8; }
    score += d0 > 0 ? 8 : -8;
    return {
      raw: { dif: Number(d0.toFixed(3)), dea: Number(e0.toFixed(3)), hist: h0 === null ? null : Number(h0.toFixed(3)) },
      score: clamp(score), hit: golden,
      detail: `DIF ${golden ? '>' : '<='} DEA（${golden ? '金叉' : '死叉'}，柱${h0 !== null && h1 !== null ? (h0 > h1 ? '放大' : '收缩') : '—'}）`
    };
  }

  function scoreRsi(klines, period) {
    const closes = klines.map(k => k.close);
    const r = last(I.rsi(closes, period));
    if (r === null) return { raw: null, score: 50, hit: false, detail: `RSI${period} 数据不足` };
    let score;
    if (r >= 70) score = 60;
    else if (r <= 30) score = 40;
    else score = 50 + (r - 50) * 1.6;
    const warn = r >= 75 ? '超买风险' : r <= 25 ? '超卖风险' : null;
    return {
      raw: { rsi: Number(r.toFixed(2)) }, score: clamp(score), hit: r > 50,
      detail: `RSI${period}=${r.toFixed(1)}（${r >= 70 ? '超买' : r <= 30 ? '超卖' : '中性'}）`,
      warning: warn
    };
  }

  function scoreKdj(klines, period) {
    const closes = klines.map(k => k.close);
    const { k: kArr, d: dArr, j: jArr } = I.kdj(closes, period);
    const k0 = last(kArr), d0 = last(dArr), j0 = last(jArr);
    const k1 = at(kArr, kArr.length - 2), d1 = at(dArr, dArr.length - 2);
    if (k0 === null || d0 === null) return { raw: null, score: 50, hit: false, detail: `KDJ(${period}) 数据不足` };
    let score = 50;
    const golden = k0 > d0;
    score += golden ? 15 : -15;
    let fresh = '';
    if (k1 !== null && d1 !== null) {
      const wasGolden = k1 > d1;
      if (golden && !wasGolden) { score += 12; fresh = '·新形成'; }
      if (!golden && wasGolden) { score -= 12; fresh = '·新形成'; }
    }
    if (j0 !== null) { if (j0 > 100) score -= 8; if (j0 < 0) score += 8; }
    return {
      raw: { k: Number(k0.toFixed(2)), d: Number(d0.toFixed(2)), j: j0 === null ? null : Number(j0.toFixed(2)) },
      score: clamp(score), hit: golden,
      detail: `K ${golden ? '>' : '<='} D（${golden ? '金叉' : '死叉'}${fresh}）`,
      warning: j0 !== null && j0 > 100 ? 'J值过高' : j0 !== null && j0 < 0 ? 'J值过低' : null
    };
  }

  function scoreAtr(klines, atrArr, period) {
    const a0 = last(atrArr);
    if (a0 === null) return { raw: null, score: 50, hit: false, detail: `ATR(${period}) 数据不足` };
    const price = klines[klines.length - 1].close;
    const pct = price ? (a0 / price) * 100 : null;
    if (pct === null) return { raw: null, score: 50, hit: false, detail: 'ATR 无法估值' };
    let score;
    if (pct < 0.5) score = 40;
    else if (pct <= 3) score = 70 + (pct - 0.5) / 2.5 * 20;
    else score = clamp(90 - (pct - 3) * 10, 20, 90);
    return {
      raw: { atr: Number(a0.toFixed(2)), atrPct: Number(pct.toFixed(2)) },
      score, hit: pct >= 0.5 && pct <= 3,
      detail: `ATR${period}=${a0.toFixed(1)}（占价 ${pct.toFixed(2)}%，${pct > 3 ? '波动偏大' : pct < 0.5 ? '波动偏小' : '波动适中'}）`,
      warning: pct > 5 ? '波动异常放大' : pct < 0.3 ? '波动过低' : null
    };
  }

  /* ── 主函数：多信号加权 → 单一评分（可解释）── */
  function scoreContract(klines, options) {
    options = options || {};
    const weights = Object.assign({}, DEFAULT_WEIGHTS, options.weights || {});
    const cfg = options.scoring || {};
    const emaPeriod = cfg.emaPeriod || 26;
    const rsiPeriod = cfg.rsiPeriod || 14;
    const kdjPeriod = cfg.kdjPeriod || 9;
    const atrPeriod = cfg.atrPeriod || 14;

    if (!Array.isArray(klines) || klines.length < MIN_BARS) {
      return {
        ok: false, score: null, grade: '无法判断', rules: [],
        summary: `K线不足（需 ≥${MIN_BARS} 根，实际 ${klines ? klines.length : 0} 根）`,
        warnings: ['数据不足']
      };
    }

    const ind = I.calculateAll(klines);
    const parts = [
      Object.assign({ id: 'ema', label: `EMA${emaPeriod} 趋势`, weight: weights.ema }, scoreEma(klines, emaPeriod)),
      Object.assign({ id: 'macd', label: 'MACD 动能', weight: weights.macd }, scoreMacd(klines)),
      Object.assign({ id: 'rsi', label: `RSI${rsiPeriod} 强弱`, weight: weights.rsi }, scoreRsi(klines, rsiPeriod)),
      Object.assign({ id: 'kdj', label: `KDJ(${kdjPeriod}) 拐点`, weight: weights.kdj }, scoreKdj(klines, kdjPeriod)),
      Object.assign({ id: 'atr', label: `ATR${atrPeriod} 波动`, weight: weights.atr }, scoreAtr(klines, ind.atr, atrPeriod))
    ];

    const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
    const weighted = parts.reduce((s, p) => s + p.score * p.weight, 0);
    const score = Math.round((weighted / totalWeight) * 10) / 10;

    const rules = parts.map(p => ({
      id: p.id, label: p.label, weight: p.weight,
      score: Math.round(p.score * 10) / 10,
      contribution: Math.round(p.score * p.weight / totalWeight * 10) / 10,
      hit: !!p.hit, detail: p.detail, raw: p.raw || null, warning: p.warning || null
    }));

    const grade = score >= 75 ? '强' : score >= 60 ? '偏强' : score >= 45 ? '中性' : score >= 30 ? '偏弱' : '弱';
    const bull = rules.filter(r => r.hit).length;
    const warnings = rules.filter(r => r.warning).map(r => `${r.label}：${r.warning}`);

    return {
      ok: true, score, grade, rules,
      summary: `${bull}/5 信号偏多 · ${grade}（${score}）`,
      warnings, bars: klines.length,
      lastPrice: klines[klines.length - 1].close,
      asOf: klines[klines.length - 1].time || null,
      disclaimer: '信号强度评分，非涨跌预测，不构成投资建议'
    };
  }

  /* ── 批量评分并排名 ── */
  function scoreAndRank(items, options) {
    const scored = items.map(it => Object.assign({ code: it.code, name: it.name, price: it.price }, scoreContract(it.klines, options)));
    const ok = scored.filter(s => s.ok).sort((a, b) => b.score - a.score);
    ok.forEach((s, i) => { s.rank = i + 1; });
    const bad = scored.filter(s => !s.ok);
    return ok.concat(bad);
  }

  return { scoreContract, scoreAndRank, DEFAULT_WEIGHTS, MIN_BARS };
})();
