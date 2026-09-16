/* =============================================
   strategy-runner.js — 策略引擎（浏览器版）
   移植自 server/strategy-runner.js
   沙箱：浏览器端用 new Function，遮蔽 require/import
   ============================================= */
window.StrategyRunner = (function () {
  'use strict';

  // 从字符串编译策略（浏览器沙箱：不给任何宿主能力）
  // 兼容 module.exports = {...} 与 exports.onBar = ... 两种写法
  function compileStrategy(code) {
    if (!code || !code.trim()) {
      throw new Error('策略内容为空，请先在策略编辑器中编写策略');
    }
    try {
      const wrapped = `
        var module = { exports: {} };
        var exports = module.exports;
        var require = function(){ throw new Error('策略沙箱：禁止使用 require（安全限制）'); };
        var fetch = undefined, XMLHttpRequest = undefined, window = undefined, document = undefined;
        (function(){
          ${code}
        })();
        return module.exports;
      `;
      const fn = new Function(wrapped);
      const exportsObj = fn();
      if (!exportsObj || typeof exportsObj.onBar !== 'function') {
        throw new Error('策略必须导出 onBar 函数');
      }
      return exportsObj;
    } catch (e) {
      const lineMatch = e.message.match(/line (\d+)/i);
      const lineInfo = lineMatch ? `第${lineMatch[1]}行附近` : '';
      throw new Error(`策略语法错误: ${e.message}${lineInfo ? ' (' + lineInfo + ')' : ''}`);
    }
  }

  async function runStrategy(strategy, kline, ctx) {
    if (typeof strategy.onBar === 'function') {
      return await strategy.onBar(kline, ctx);
    }
    return null;
  }

  function createContext({ cash = 100000, code = '' } = {}) {
    return {
      cash, position: 0, avgPrice: 0,
      history: [], signals: [], trades: [],
      equity: [{ cash }], code,
    };
  }

  return { compileStrategy, runStrategy, createContext };
})();
