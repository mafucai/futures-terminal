/* =============================================
   strategy-runner.js — 策略引擎（浏览器版）
   移植自 server/strategy-runner.js
   沙箱：浏览器端用 new Function，遮蔽 require/import
   ============================================= */
window.StrategyRunner = (function () {
  'use strict';

  // 从字符串编译策略（浏览器沙箱：不给任何宿主能力）
  // 兼容 module.exports = {...} 与 exports.onBar = ... 两种写法
  // 说明：本 App 的策略是 **JavaScript**（不是 Python）。若粘贴 Python 会在此报错。
  function looksLikePython(code) {
    const s = String(code);
    return /^\s*(import\s+\w|from\s+\w+\s+import|def\s+\w+\s*\(|class\s+\w+\s*\(|@dataclass)/m.test(s)
      || /:\s*$/m.test(s) && /^\s{2,}(return|if|for|while)\b/m.test(s)
      || /pd\.DataFrame|np\.|\.ewm\(|\.rolling\(/.test(s);
  }

  function compileStrategy(code) {
    if (!code || !code.trim()) {
      throw new Error('策略内容为空，请先在策略编辑器中编写策略');
    }
    if (looksLikePython(code)) {
      throw new Error('检测到这是 Python 代码，本 App 只能运行 JavaScript 策略。请改用 module.exports.onBar = function(kline, ctx){ ... } 形式（可在「策略」页用示例改写）。');
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
        throw new Error('策略必须导出 onBar 函数（module.exports.onBar = function(kline, ctx){...}）');
      }
      return exportsObj;
    } catch (e) {
      const lineMatch = e.message.match(/line (\d+)/i);
      const lineInfo = lineMatch ? `第${lineMatch[1]}行附近` : '';
      throw new Error(`策略语法错误: ${e.message}${lineInfo ? ' (' + lineInfo + ')' : ''}`
        + (/\b(invalid|unexpected)\b/i.test(e.message) ? ' · 请确认是 JavaScript（Python 无法运行）' : ''));
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
