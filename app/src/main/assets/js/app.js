/* ═══ 主入口 + 全局 UI 工具（App 版）═══ */
(function () {
  'use strict';

  const UI = {
    /** 数字安全格式化：空值显示 -- */
    num(v, digits = 2) {
      if (v === null || v === undefined || v === '') return '--';
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(digits) : '--';
    },
    /** 涨跌色类：红涨绿跌 */
    trend(v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n === 0) return 'flat';
      return n > 0 ? 'up' : 'down';
    },
    /** 时间戳格式化 MM-DD HH:mm */
    fmtTime(ts) {
      if (!ts) return '--';
      const d = new Date(Number(ts) || ts);
      if (Number.isNaN(d.getTime())) return '--';
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    /** 数据是否过期（分钟阈值） */
    isStale(ts, maxMinutes = 120) {
      if (!ts) return true;
      const t = new Date(Number(ts) || ts).getTime();
      if (Number.isNaN(t)) return true;
      return Date.now() - t > maxMinutes * 60000;
    },
    /** 全局状态栏 */
    status(text, kind) {
      const dot = document.getElementById('connDot');
      const el = document.getElementById('connText');
      if (el) el.textContent = text;
      if (dot) dot.className = 'dot' + (kind ? ' ' + kind : '');
    },
    /** 纯文本转义，防注入 */
    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  };

  function tickClock() {
    const el = document.getElementById('clock');
    if (!el) return;
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function bindNav() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => RouteRegistry.navigate(btn.dataset.view));
    });
  }

  /* 返回键处理（Android 硬件返回）：优先回行情页，其次退回系统 */
  window.__onBackPressed = function () {
    if (RouteRegistry.current && RouteRegistry.current !== 'vList') {
      RouteRegistry.navigate('vList');
      return true;
    }
    return false;
  };

  // 立即暴露 UI 工具（供其它视图在各自 DOMContentLoaded 中使用）
  window.UI = UI;

  document.addEventListener('DOMContentLoaded', () => {
    bindNav();
    tickClock();
    setInterval(tickClock, 1000);

    const pageMap = {
      vList: 'List', vDetail: 'Detail', vStrategy: 'Strategy',
      vBacktest: 'Backtest', vMonitor: 'Monitor', vAI: 'AI'
    };
    Object.keys(pageMap).forEach(id => {
      RouteRegistry.registerPage(id, {
        onEnter: () => {
          const v = window[pageMap[id] + 'View'];
          if (v && typeof v.onEnter === 'function') v.onEnter();
        }
      });
    });

    RouteRegistry.navigate('vList');

    // 环境探测：有原生桥 = App 内运行
    const inApp = typeof window.Android !== 'undefined' && window.Android.httpGet;
    UI.status(inApp ? 'App 就绪（离线可用）' : '浏览器预览模式', inApp ? '' : 'warn');
  });
})();
