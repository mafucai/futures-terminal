/* =============================================
   indicators.js — 技术指标计算（浏览器版，纯本地）
   原样移植自 server/indicators.js
   ============================================= */
window.Indicators = (function () {
  'use strict';

  function sma(data, period) {
    const arr = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      arr[i] = sum / period;
    }
    return arr;
  }

  function ema(data, period) {
    const arr = new Array(data.length).fill(null);
    const k = 2 / (period + 1);
    arr[0] = data[0];
    for (let i = 1; i < data.length; i++) {
      arr[i] = data[i] * k + arr[i - 1] * (1 - k);
    }
    return arr;
  }

  function macd(data, fast = 12, slow = 26, signal = 9) {
    const emaF = ema(data, fast);
    const emaS = ema(data, slow);
    const dif = emaF.map((v, i) => v !== null && emaS[i] !== null ? v - emaS[i] : null);
    const dea = ema(dif.map(v => v || 0), signal);
    const hist = dif.map((v, i) => v !== null && dea[i] !== null ? v - dea[i] : null);
    return { dif, dea, hist };
  }

  function rsi(data, period = 14) {
    const arr = new Array(data.length).fill(null);
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const diff = data[i] - data[i - 1];
      if (diff > 0) gain += diff; else loss -= diff;
    }
    let avgGain = gain / period, avgLoss = loss / period;
    arr[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < data.length; i++) {
      const diff = data[i] - data[i - 1];
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
      arr[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return arr;
  }

  function kdj(data, period = 9) {
    const kArr = new Array(data.length).fill(null);
    const dArr = new Array(data.length).fill(null);
    const jArr = new Array(data.length).fill(null);
    let k = 50, d = 50;
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) continue;
      let low = Infinity, high = -Infinity;
      for (let j = i - period + 1; j <= i; j++) {
        if (data[j] < low) low = data[j];
        if (data[j] > high) high = data[j];
      }
      const rsv = high === low ? 50 : (data[i] - low) / (high - low) * 100;
      k = 2 / 3 * k + 1 / 3 * rsv;
      d = 2 / 3 * d + 1 / 3 * k;
      const j = 3 * k - 2 * d;
      kArr[i] = k; dArr[i] = d; jArr[i] = j;
    }
    return { k: kArr, d: dArr, j: jArr };
  }

  function boll(data, period = 20, multiplier = 2) {
    const mid = sma(data, period);
    const upper = new Array(data.length).fill(null);
    const lower = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += Math.pow(data[j] - mid[i], 2);
      const std = Math.sqrt(sum / period);
      upper[i] = mid[i] + multiplier * std;
      lower[i] = mid[i] - multiplier * std;
    }
    return { upper, mid, lower };
  }

  function atr(klines, period = 14) {
    const arr = new Array(klines.length).fill(null);
    let trSum = 0;
    for (let i = 1; i <= period && i < klines.length; i++) {
      const high = klines[i].high, low = klines[i].low;
      const prevClose = klines[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trSum += tr;
      if (i === period) arr[i] = trSum / period;
    }
    for (let i = period + 1; i < klines.length; i++) {
      const high = klines[i].high, low = klines[i].low, prevClose = klines[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      arr[i] = (arr[i - 1] * (period - 1) + tr) / period;
    }
    return arr;
  }

  function calculateAll(klines) {
    const closes = klines.map(k => k.close);
    return {
      ma5: sma(closes, 5), ma10: sma(closes, 10), ma20: sma(closes, 20), ma60: sma(closes, 60),
      ema12: ema(closes, 12), ema20: ema(closes, 20), ema26: ema(closes, 26), ema60: ema(closes, 60),
      macd: macd(closes),
      rsi6: rsi(closes, 6), rsi14: rsi(closes, 14), rsi24: rsi(closes, 24),
      kdj: kdj(closes), boll: boll(closes), atr: atr(klines),
    };
  }

  return { sma, ema, macd, rsi, kdj, boll, atr, calculateAll };
})();
