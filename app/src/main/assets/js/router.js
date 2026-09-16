/* =============================================
   router.js — 中央路由（RouteRegistry）
   所有页面切换、事件统一走这里，不覆写全局函数
   ============================================= */
window.RouteRegistry = (function () {
  const handlers = {};   // 事件名 -> [fn,...]
  const pageHandlers = {}; // 页面名 -> { onEnter: fn }

  function register(event, fn) {
    if (typeof fn !== 'function') return;
    if (!handlers[event]) handlers[event] = [];
    handlers[event].push(fn);
  }

  function dispatch(event, payload) {
    (handlers[event] || []).forEach(fn => {
      try { fn(payload); } catch (e) { console.error('[Route:' + event + ']', e.message); }
    });
  }

  // 页面注册
  function registerPage(name, { onEnter } = {}) {
    pageHandlers[name] = { onEnter };
  }

  // 切换页面
  function navigate(name, payload) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('page-hidden'));
    const el = document.getElementById(name);
    if (el) {
      el.classList.remove('page-hidden');
      const pg = pageHandlers[name];
      if (pg && pg.onEnter) { try { pg.onEnter(payload); } catch (e) { console.error('[Nav]', e.message); } }
    }
    // 同步 tab 高亮
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.page === name);
    });
    dispatch('navigate', name);
  }

  return { register, dispatch, registerPage, navigate, handlers };
})();