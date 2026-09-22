/* =============================================
   strategy-templates.js — 内置示例策略（JavaScript）
   用途：策略页「载入示例」按钮，一键把可运行的 JS 策略填进编辑器。
   注意：本 App 运行的是 **JavaScript**，不是 Python。
   契约：module.exports.onBar = function(kline, ctx){ ... }
        返回 { type:'BUY'|'SELL'|'REDUCE'|'CLOSE', size?, ratio?, reason? } 或 null
        ctx.stopLoss = 价格  → 设置硬止损（引擎在下一根 high/low 判定，跳空按开盘认亏）
        ctx.state            → 持久对象（连亏计数/暂停方向等）
   多周期模式下：kline.period 为 '4H' 或 '1H'；1H 根才产生信号。
   ============================================= */
window.StrategyTemplates = (function () {
  'use strict';

  /* ────────────────────────────────────────────────────────────
     公共工具（内联在每个模板里，因为策略沙箱不共享外部变量）
     ──────────────────────────────────────────────────────────── */

  /* ════════════════════════════════════════════════════════════
     模板 A：EMA 原版（忠实翻译用户 Python 的 OriginalStrategy）
     特点：无硬止损；减仓/清仓靠 1H/4H EMA26；固定 point_value；
           手数 = 资金 × risk% ÷（|开仓价-4H EMA26| × 乘数），上限 maxLots。
     注意：App 里同样"收盘确认、下一根开盘执行"（引擎已保证不偷价）。
     ════════════════════════════════════════════════════════════ */
  const EMA_ORIGINAL = `// ═══ 原版 EMA 策略（JavaScript 版 · 无硬止损）═══
// 对应 Python OriginalStrategy：4H EMA26 定方向，1H EMA26 入场/减仓，ATR 过滤，前3根确认，阴阳线。
// 参数在下方 PARAMS 里改。
module.exports.onBar = function (kline, ctx) {
  var P = {
    emaPeriod: 26,
    atrPeriod: 14,
    atrMult: 1.5,      // 入场距离 ≤ 1.5 × ATR
    riskPct: 0.02,     // 单笔风险 2%
    maxLots: 3,        // 最大手数
    confirmBars: 3     // 入场前连续确认根数
  };

  function ema(arr, n) {
    if (arr.length < n) return null;
    var k = 2 / (n + 1), e = arr[0];
    for (var i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }
  function emaAt(arr, n, offset) { // 取"截止 offset 根之前"的 EMA（防未来）
    var sub = offset ? arr.slice(0, arr.length - offset) : arr;
    return ema(sub, n);
  }
  function atr(bars, n) {
    if (bars.length < n + 1) return null;
    var trs = [];
    for (var i = 1; i < bars.length; i++) {
      var h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    var k = 2 / (n + 1), a = trs[0];
    for (var j = 1; j < trs.length; j++) a = trs[j] * k + a * (1 - k);
    return a;
  }

  // ---- 拆 4H / 1H ----
  var hist = ctx.history || [];
  var b4 = hist.filter(function (b) { return b.period === '4H'; });
  var b1 = hist.filter(function (b) { return b.period !== '4H'; });
  if (!b4.length) b4 = b1;                       // 单周期降级
  if (b1.length < P.emaPeriod + P.confirmBars || b4.length < P.emaPeriod) return null;

  var c1 = b1.map(function (b) { return b.close; });
  var c4 = b4.map(function (b) { return b.close; });
  var ema1 = ema(c1, P.emaPeriod);
  var ema4 = ema(c4, P.emaPeriod);
  var a14 = atr(b1, P.atrPeriod);
  if (ema1 == null || ema4 == null || a14 == null) return null;

  var close1 = c1[c1.length - 1];
  var open1 = b1[b1.length - 1].open;
  var close4 = c4[c4.length - 1];
  var longDir = close4 > ema4;
  var shortDir = close4 < ema4;

  // 持有中：靠 EMA 减仓/清仓（对应 Python 的 reduce / close）
  if (ctx.position > 0) {
    if (close1 < ema1) return { type: 'REDUCE', ratio: 1 / 3, reason: '1H 收盘 < EMA26（减仓1/3）' };
    if (close4 < ema4) return { type: 'CLOSE', reason: '4H 收盘 < EMA26（清仓）' };
    return null;
  }
  if (ctx.position < 0) {
    if (close1 > ema1) return { type: 'REDUCE', ratio: 1 / 3, reason: '1H 收盘 > EMA26（减仓1/3）' };
    if (close4 > ema4) return { type: 'CLOSE', reason: '4H 收盘 > EMA26（清仓）' };
    return null;
  }

  // 空仓：找入场（前 confirmBars 根收盘都在 EMA 另一侧 + 阴阳线 + ATR 距离）
  function confirmBelow(n) {
    for (var i = 1; i <= n; i++) {
      var idx = c1.length - i;
      if (idx < 1) return false;
      var e = emaAt(c1, P.emaPeriod, i);
      if (e == null || !(c1[idx - 1] < e)) return false;
    }
    return true;
  }
  function confirmAbove(n) {
    for (var i = 1; i <= n; i++) {
      var idx = c1.length - i;
      if (idx < 1) return false;
      var e = emaAt(c1, P.emaPeriod, i);
      if (e == null || !(c1[idx - 1] > e)) return false;
    }
    return true;
  }

  if (longDir && close1 >= ema1 && (close1 - ema1) <= P.atrMult * a14 && confirmBelow(P.confirmBars) && close1 > open1) {
    // 手数由引擎按风险预算算（需设置 stopLoss 作为风险距离参考）——原版用 4H EMA 距离
    var dist = Math.abs(close1 - ema4);
    return { type: 'BUY', reason: '原版做多：4H多头 + 1H回踩 + 前' + P.confirmBars + '根在下方 + 阳线', riskDist: dist };
  }
  if (shortDir && close1 <= ema1 && (ema1 - close1) <= P.atrMult * a14 && confirmAbove(P.confirmBars) && close1 < open1) {
    var dist2 = Math.abs(close1 - ema4);
    return { type: 'SELL', reason: '原版做空：4H空头 + 1H回踩 + 前' + P.confirmBars + '根在上方 + 阴线', riskDist: dist2 };
  }
  return null;
};
`;

  /* ════════════════════════════════════════════════════════════
     模板 B：EMA 修正版（硬止损 + 减仓上移保本 + 连亏3次暂停）
     在模板 A 基础上补：
       - 开仓即设硬止损 = 开仓价 ∓ 1.5×ATR14（引擎盘中判定，跳空按开盘认亏）
       - 减仓后把止损上移到开仓价（保本）
       - 连亏 3 次（硬止损净亏）→ 暂停该方向，直到 4H 趋势重新确认
     ════════════════════════════════════════════════════════════ */
  const EMA_FIXED = `// ═══ EMA 修正版（JavaScript 版 · 硬止损+保本+连亏暂停）═══
// 对应"修正版"：核心信号同原版，另加硬止损/保本止损/连亏暂停/逐品种乘数(引擎层)。
module.exports.onBar = function (kline, ctx) {
  var P = {
    emaPeriod: 26, atrPeriod: 14, atrMult: 1.5,
    stopAtrMult: 1.5,   // 初始硬止损 = 1.5 × ATR14
    confirmBars: 3,
    maxLossStreak: 3    // 连亏 3 次暂停该方向
  };

  function ema(arr, n) {
    if (arr.length < n) return null;
    var k = 2 / (n + 1), e = arr[0];
    for (var i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }
  function emaAt(arr, n, offset) { var s = offset ? arr.slice(0, arr.length - offset) : arr; return ema(s, n); }
  function atr(bars, n) {
    if (bars.length < n + 1) return null;
    var trs = [];
    for (var i = 1; i < bars.length; i++) {
      var h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    var k = 2 / (n + 1), a = trs[0];
    for (var j = 1; j < trs.length; j++) a = trs[j] * k + a * (1 - k);
    return a;
  }

  // ---- 连亏暂停状态 ----
  ctx.state.longLoss = ctx.state.longLoss || 0;
  ctx.state.shortLoss = ctx.state.shortLoss || 0;
  ctx.state.pauseLong = ctx.state.pauseLong || false;
  ctx.state.pauseShort = ctx.state.pauseShort || false;

  // ---- 拆 4H / 1H ----
  var hist = ctx.history || [];
  var b4 = hist.filter(function (b) { return b.period === '4H'; });
  var b1 = hist.filter(function (b) { return b.period !== '4H'; });
  if (!b4.length) b4 = b1;
  if (b1.length < P.emaPeriod + P.confirmBars || b4.length < P.emaPeriod) return null;

  var c1 = b1.map(function (b) { return b.close; });
  var c4 = b4.map(function (b) { return b.close; });
  var ema1 = ema(c1, P.emaPeriod);
  var ema4 = ema(c4, P.emaPeriod);
  var a14 = atr(b1, P.atrPeriod);
  if (ema1 == null || ema4 == null || a14 == null) return null;

  var close1 = c1[c1.length - 1], open1 = b1[b1.length - 1].open;
  var close4 = c4[c4.length - 1];
  var longDir = close4 > ema4, shortDir = close4 < ema4;

  // ---- 结算上一笔平仓：更新连亏计数（引擎通过 ctx.lastExit 告知）----
  if (ctx.lastExit && ctx.position === 0) {
    if (ctx.lastExit.reason === '硬止损') {
      if (ctx.lastExit.pnl < 0) {
        // 用方向判断加哪个计数：由 lastExit.dir 提供
        if (ctx.lastExit.dir === 'long') ctx.state.longLoss++;
        else if (ctx.lastExit.dir === 'short') ctx.state.shortLoss++;
      }
    } else if (ctx.lastExit.reason === 'CLOSE') {
      // 趋势离场视为一段结束，清零两侧计数与暂停
      ctx.state.longLoss = 0; ctx.state.shortLoss = 0;
      ctx.state.pauseLong = false; ctx.state.pauseShort = false;
    }
  }
  if (ctx.state.longLoss >= P.maxLossStreak) ctx.state.pauseLong = true;
  if (ctx.state.shortLoss >= P.maxLossStreak) ctx.state.pauseShort = true;

  // ---- 持仓中：减仓（保本） / 清仓 ----
  if (ctx.position > 0) {
    if (close1 < ema1) {
      // 减仓 1/3，剩余仓位止损上移到开仓价（保本）
      if (ctx.entryPrice) ctx.stopLoss = ctx.entryPrice;
      return { type: 'REDUCE', ratio: 1 / 3, reason: '1H<EMA26 减1/3，剩余止损上移保本' };
    }
    if (close4 < ema4) return { type: 'CLOSE', reason: '4H<EMA26 清仓' };
    return null;
  }
  if (ctx.position < 0) {
    if (close1 > ema1) {
      if (ctx.entryPrice) ctx.stopLoss = ctx.entryPrice;
      return { type: 'REDUCE', ratio: 1 / 3, reason: '1H>EMA26 减1/3，剩余止损下移保本' };
    }
    if (close4 > ema4) return { type: 'CLOSE', reason: '4H>EMA26 清仓' };
    return null;
  }

  // ---- 空仓：入场（暂停方向不开）----
  function confirmBelow(n) {
    for (var i = 1; i <= n; i++) { var idx = c1.length - i; if (idx < 1) return false;
      var e = emaAt(c1, P.emaPeriod, i); if (e == null || !(c1[idx - 1] < e)) return false; }
    return true;
  }
  function confirmAbove(n) {
    for (var i = 1; i <= n; i++) { var idx = c1.length - i; if (idx < 1) return false;
      var e = emaAt(c1, P.emaPeriod, i); if (e == null || !(c1[idx - 1] > e)) return false; }
    return true;
  }

  if (longDir && !ctx.state.pauseLong && close1 >= ema1 && (close1 - ema1) <= P.atrMult * a14 && confirmBelow(P.confirmBars) && close1 > open1) {
    ctx.stopLoss = close1 - P.stopAtrMult * a14;   // 初始硬止损
    return { type: 'BUY', reason: '做多：4H多头+1H回踩+前3根在下方+阳线（止损 ' + ctx.stopLoss.toFixed(1) + '）' };
  }
  if (shortDir && !ctx.state.pauseShort && close1 <= ema1 && (ema1 - close1) <= P.atrMult * a14 && confirmAbove(P.confirmBars) && close1 < open1) {
    ctx.stopLoss = close1 + P.stopAtrMult * a14;
    return { type: 'SELL', reason: '做空：4H空头+1H回踩+前3根在上方+阴线（止损 ' + ctx.stopLoss.toFixed(1) + '）' };
  }
  return null;
};
`;

  /* ════════════════════════════════════════════════════════════
     模板 C：单周期 EMA26 穿越（最简，适合不想用多周期）
     ════════════════════════════════════════════════════════════ */
  const EMA_CROSS = `// ═══ 单周期 EMA26 穿越策略（JavaScript）═══
module.exports.onBar = function (kline, ctx) {
  var closes = ctx.history.map(function (k) { return k.close; });
  if (closes.length < 30) return null;
  function ema(a, n) { var k = 2 / (n + 1), e = a[0]; for (var i = 1; i < a.length; i++) e = a[i] * k + e * (1 - k); return e; }
  var e26 = ema(closes, 26);
  var prev = closes.slice(0, -1), e26p = ema(prev, 26);
  var c = closes[closes.length - 1], cp = prev[prev.length - 1];
  if (cp <= e26p && c > e26) return { type: 'BUY', reason: '上穿EMA26' };
  if (cp >= e26p && c < e26) return { type: 'SELL', reason: '下穿EMA26' };
  return null;
};
`;

  return { EMA_ORIGINAL, EMA_FIXED, EMA_CROSS, EMA26_MULTI: EMA_FIXED };
})();
