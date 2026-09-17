/* =============================================
   strategy-templates.js — 内置示例策略（JavaScript）
   用途：策略页「载入示例」按钮，一键把可运行的 JS 策略填进编辑器。
   注意：本 App 运行的是 **JavaScript**，不是 Python。
        策略契约：module.exports.onBar = function(kline, ctx){ return {type,reason} | null }
   ============================================= */
window.StrategyTemplates = (function () {
  'use strict';

  /* EMA26 多周期策略（对应你文档里的"修正版"核心信号）
     - 多周期模式下：kline.period 为 '4H' 或 '1H'
     - 单周期模式下：只用当前周期当作"1H"，方向/入场都在同周期（降级但仍可跑）

     做多：4H收盘 > 4H EMA26；1H收盘 ≥ 1H EMA26；(收盘-EMA26) ≤ 1.5×ATR14；
           前3根收盘 < EMA26；当前阳线
     做空：镜像
     减仓：1H 收盘 反向穿过 EMA26  → 返回 {type:'REDUCE'}
     清仓：4H 收盘 反向穿过 EMA26  → 返回 {type:'CLOSE'}
     （App 回测/模拟只识别 BUY / SELL；REDUCE/CLOSE 会被当作 SELL/BUY 平仓处理，见说明）
  */
  const EMA26_MULTI = `// ═══ EMA26 多周期策略（JavaScript 版 · 可直接运行）═══
// 契约：module.exports.onBar = function(kline, ctx){ return {type:'BUY'|'SELL', reason} | null }
// 提示：在「策略筛选/回测/模拟盘」勾选「多周期(4H+1H)」效果最好。
module.exports.onBar = function (kline, ctx) {
  // ---- 指标工具 ----
  function ema(arr, n) {
    if (arr.length < n) return null;
    var k = 2 / (n + 1), e = arr[0];
    for (var i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
    return e;
  }
  function emaAt(arr, n, offset) { // 用于取过去第 offset 根的 EMA（不含未来）
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

  // ---- 拆分 4H / 1H（多周期模式下 kline.period 有标记）----
  var hist = ctx.history || [];
  var bars4 = hist.filter(function (b) { return b.period === '4H'; });
  var bars1 = hist.filter(function (b) { return b.period !== '4H'; }); // 1H 或单周期
  if (!bars4.length) bars4 = bars1; // 单周期降级：用同周期当方向

  if (bars1.length < 26 || bars4.length < 26) return null;

  var closes1 = bars1.map(function (b) { return b.close; });
  var closes4 = bars4.map(function (b) { return b.close; });

  var ema26_1h = ema(closes1, 26);
  var ema26_4h = ema(closes4, 26);
  var atr14_1h = atr(bars1, 14);
  if (ema26_1h == null || ema26_4h == null || atr14_1h == null) return null;

  // 方向：用 4H 最近一根已收盘K线（不含当前1H）
  var close4 = closes4[closes4.length - 1];
  var longDir = close4 > ema26_4h;
  var shortDir = close4 < ema26_4h;

  // 1H 当前与前三根
  var c = closes1[closes1.length - 1];
  var o = bars1[bars1.length - 1].open;
  var p1 = closes1[closes1.length - 2], p2 = closes1[closes1.length - 3], p3 = closes1[closes1.length - 4];
  var e1 = emaAt(closes1, 26, 1), e2 = emaAt(closes1, 26, 2), e3 = emaAt(closes1, 26, 3);
  if (p3 == null || e3 == null) return null;

  var below3 = (p1 < e1) && (p2 < e2) && (p3 < e3);
  var above3 = (p1 > e1) && (p2 > e2) && (p3 > e3);

  // ---- 做多 ----
  if (longDir && ctx.position <= 0) {
    var near = (c - ema26_1h) <= 1.5 * atr14_1h;
    if (c >= ema26_1h && near && below3 && c > o) {
      return { type: 'BUY', reason: '4H多头 + 1H上穿EMA26回踩不超1.5ATR + 前3根在下方 + 阳线' };
    }
  }
  // ---- 做空 ----
  if (shortDir && ctx.position >= 0) {
    var near2 = (ema26_1h - c) <= 1.5 * atr14_1h;
    if (c <= ema26_1h && near2 && above3 && c < o) {
      return { type: 'SELL', reason: '4H空头 + 1H下穿EMA26回踩不超1.5ATR + 前3根在上方 + 阴线' };
    }
  }

  // ---- 减仓/清仓（用 SELL/BUY 平掉/反手表达；如需精确减仓见 README）----
  if (ctx.position > 0) {
    // 1H 跌破 EMA26 → 平多；4H 跌破 → 也平多
    if (c < ema26_1h) return { type: 'SELL', reason: '1H跌破EMA26(减仓/离场)' };
    if (close4 < ema26_4h) return { type: 'SELL', reason: '4H跌破EMA26(清仓)' };
  } else if (ctx.position < 0) {
    if (c > ema26_1h) return { type: 'BUY', reason: '1H升破EMA26(减仓/离场)' };
    if (close4 > ema26_4h) return { type: 'BUY', reason: '4H升破EMA26(清仓)' };
  }

  return null;
};
`;

  /* 简单单周期示例（EMA26 穿越），适合不想用多周期的场景 */
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

  return { EMA26_MULTI, EMA_CROSS };
})();
