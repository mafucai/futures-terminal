/* ═══ 中央路由（RouteRegistry）═══
   文档 §六 既定约定：所有事件走 RouteRegistry.dispatch(event, payload)，
   页面切换用 RouteRegistry.navigate(page)。
   本文件保持与文档一致的 API 契约，供各视图注册/派发。
*/
(function () {
  'use strict';

  const handlers = Object.create(null);
  const pages = Object.create(null);
  let current = null;

  function register(event, fn) {
    if (typeof fn !== 'function') throw new Error('handler must be a function');
    handlers[event] = fn;
    return fn;
  }

  function dispatch(event, payload) {
    const fn = handlers[event];
    if (!fn) {
      console.warn('[RouteRegistry] no handler for event:', event);
      return undefined;
    }
    try {
      return fn(payload);
    } catch (err) {
      console.error('[RouteRegistry] handler error for', event, err);
      return undefined;
    }
  }

  /* 注册页面进入钩子。
     修复（2026-09-22）：原实现 `pages[name] = opts` 是**整体覆盖**语义——后注册者静默顶掉
     先注册者。app.js 曾在 DOMContentLoaded 里用 pageMap 对 7 个页面统一注册一遍（位置最后），
     于是各视图自己写的 registerPage('vX',{onEnter}) 全部失效：
       views/sim.js      → 策略下拉框永不加载（模拟盘跑不了任何策略）
       views/detail.js   → 图表 resize 永不触发
       views/backtest.js → 权益曲线 resize 永不触发
       views/ai.js       → 配置回填永不执行
       views/specs.js    → 合约规格表（注册在 vStrategy 上）与 strategy.js 互相顶掉
     现改为**组合**语义：多方各自保留，onEnter 按注册先后串行调用，同一函数只调一次。
     与技能 route-registry 的核心原则一致：禁止覆写，改为注册。 */
  function registerPage(name, opts) {
    const prev = pages[name] || {};
    const next = Object.assign({}, prev, opts || {});
    const a = prev.onEnter, b = (opts || {}).onEnter;
    if (typeof a === 'function' && typeof b === 'function' && a !== b) {
      next.onEnter = function () {
        // 隔离：一个注册方的钩子抛错不得阻断其余注册方（否则 specs.js 抛错会连累 strategy.js）
        try { a.call(this); } catch (e) { console.error('[RouteRegistry] page onEnter #1 error for ' + name + ':', e); }
        try { b.call(this); } catch (e) { console.error('[RouteRegistry] page onEnter #2 error for ' + name + ':', e); }
      };
    } else if (typeof a === 'function' && typeof b !== 'function') {
      next.onEnter = a;
    }
    pages[name] = next;
    return next;
  }

  function navigate(name) {
    // 1. 切换视图显隐
    document.querySelectorAll('.view').forEach(function (el) {
      el.classList.toggle('off', el.id !== name);
    });
    // 2. 同步导航高亮
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.classList.toggle('on', btn.dataset.view === name);
    });
    // 3. 触发页面进入钩子
    const page = pages[name];
    if (page && typeof page.onEnter === 'function') {
      try { page.onEnter(); } catch (err) { console.error('[RouteRegistry] onEnter error:', name, err); }
    }
    current = name;
  }

  window.RouteRegistry = { register, dispatch, registerPage, navigate, handlers, pages, get current() { return current; } };
})();
