/* =============================================
   app.js — 主入口
   初始化路由、UI工具、导航
   ============================================= */
(function () {
  'use strict';

  // UI 工具
  window.UI = {
    loading: '<span class="loading"></span> <span style="color:var(--text-dim);font-size:12px">加载中...</span>',
    // HTML 转义：所有外部数据（行情名/合约名/错误信息/数据源返回）插入 innerHTML 前必须调用
    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
    setStatus: function (t) {
      const el = document.getElementById('statusText');
      if (el) el.textContent = t;
    },
    setTime: function () {
      const el = document.getElementById('currentTime');
      if (el) el.textContent = new Date().toLocaleTimeString('zh-CN');
    },
    // ISO时间 → 可读格式（MM-DD HH:mm:ss）
    fmtTime: function (isoStr) {
      if (!isoStr) return '-';
      try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '-';
        const pad = n => String(n).padStart(2, '0');
        return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      } catch (e) { return '-'; }
    },
    // 是否过期（超过指定分钟数）
    isStale: function (isoStr, maxMinutes) {
      if (!isoStr) return true;
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return true;
      return (Date.now() - d.getTime()) > (maxMinutes || 60) * 60000;
    }
  };

  // 初始化导航
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', function () {
      const page = this.dataset.page;
      if (page) RouteRegistry.navigate(page);
    });
  });

  // 搜索框回车触发筛选
  document.getElementById('searchInput').addEventListener('keyup', function (e) {
    if (e.key === 'Enter') {
      ListView.renderList();
    }
  });

  // 默认进入列表页
  RouteRegistry.navigate('pageList');

  // 更新时间
  setInterval(window.UI.setTime, 10000);
  window.UI.setTime();
})();