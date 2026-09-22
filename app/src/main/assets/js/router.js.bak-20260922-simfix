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

  function registerPage(name, opts) {
    pages[name] = opts || {};
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
