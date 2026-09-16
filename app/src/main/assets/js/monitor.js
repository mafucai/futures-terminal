/* =============================================
   monitor.js — 实时监控模块（浏览器版）
   移植自 server/monitor.js，日志改到内存 + 回调
   ============================================= */
window.FuturesMonitor = (function () {
  'use strict';
  const SR = window.StrategyRunner;
  const WD = window.WebData;

  class Monitor {
    constructor({ intervalSec = 30, onLog = null } = {}) {
      this.interval = intervalSec * 1000;
      this._timer = null;
      this._running = false;
      this._onLog = onLog;
      this._logs = [];
    }

    log(msg) {
      const line = `[${new Date().toLocaleString('zh-CN')}] ${msg}`;
      this._logs.push(line);
      if (this._logs.length > 500) this._logs.shift();
      if (this._onLog) this._onLog(line);
    }

    getLogs() { return this._logs; }

    async start({ contracts = [], strategyCode = null } = {}) {
      if (this._running) return this;
      this._running = true;
      this.log('监控启动，轮询间隔 ' + (this.interval / 1000) + ' 秒，监控 ' + contracts.length + ' 个合约');

      const run = async () => {
        if (!this._running) return;
        try {
          let strategy = null;
          if (strategyCode) {
            try { strategy = SR.compileStrategy(strategyCode); }
            catch (e) { this.log('策略编译错误: ' + e.message); }
          }

          for (const code of contracts) {
            if (!this._running) return;
            const quote = await WD.futureQuote(code);
            if (!quote) continue;
            const msg = `${quote.name}(${code}) 现价:${quote.price} 涨跌:${(quote.changePct || 0).toFixed(2)}% 今开:${quote.open} 昨收:${quote.lastClose}`;
            this.log(msg);

            if (strategy) {
              try {
                const klines = await WD.futureKline(code, 101, 60);
                if (klines && klines.length > 20) {
                  const ctx = SR.createContext({ cash: 100000, code });
                  for (const k of klines) ctx.history.push(k);
                  const signal = await SR.runStrategy(strategy, klines[klines.length - 1], ctx);
                  if (signal) this.log(`⚠️ 策略命中 ${code}: ${signal.type} ${signal.reason || ''}`);
                }
              } catch (e) {
                this.log(`策略分析 ${code} 失败: ${e.message}`);
              }
            }
          }
        } catch (e) {
          this.log('监控循环错误: ' + e.message);
        }
      };

      await run();
      this._timer = setInterval(run, this.interval);
      return this;
    }

    stop() {
      this._running = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this.log('监控已停止');
    }

    isRunning() { return this._running; }
  }

  return { Monitor };
})();
