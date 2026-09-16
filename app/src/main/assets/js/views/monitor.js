/* =============================================
   views/monitor.js — 实时监控页
   RouteRegistry: monitor-start/monitor-stop
   ============================================= */
window.MonitorView = (function () {
  let monitorRunning = false;
  let logTimer = null;

  async function startMonitor() {
    const contractsEl = document.getElementById('monitorContracts');
    const strategyEl = document.getElementById('strategyEditor');
    const status = document.getElementById('monitorStatus');
    const log = document.getElementById('monitorLog');

    let contracts = contractsEl.value.trim().split(/[\s,，]+/).filter(Boolean);
    if (!contracts.length) {
      // 默认用收藏列表
      const favs = JSON.parse(localStorage.getItem('fv2_favs') || '[]');
      if (favs.length) contracts = favs;
      else { status.innerHTML = '<span style="color:var(--rise)">请先输入合约代码或添加收藏</span>'; return; }
    }

    status.innerHTML = '<span class="loading"></span> 启动监控...';
    try {
      const j = await window.API.monitorStart(contracts, strategyEl.value);
      monitorRunning = true;
      status.innerHTML = `<span class="monitor-indicator running">● 运行中 · ${contracts.length}个合约 · 30秒轮询</span>`;
      log.innerHTML = `[${new Date().toLocaleTimeString('zh-CN')}] 监控已启动，监控 ${contracts.join(', ')}\n`;
      // 启动日志轮询
      if (logTimer) clearInterval(logTimer);
    } catch (e) {
      status.innerHTML = `<span style="color:var(--rise)">❌ ${window.UI.esc(e.message)}</span>`;
    }
  }

  async function stopMonitor() {
    const status = document.getElementById('monitorStatus');
    try {
      await window.API.monitorStop();
      monitorRunning = false;
      status.innerHTML = '<span class="monitor-indicator stopped">● 已停止</span>';
      document.getElementById('monitorLog').innerHTML += `[${new Date().toLocaleTimeString('zh-CN')}] 监控已停止\n`;
      if (logTimer) { clearInterval(logTimer); logTimer = null; }
    } catch (e) {
      status.innerHTML = `<span style="color:var(--rise)">❌ ${window.UI.esc(e.message)}</span>`;
    }
  }

  RouteRegistry.register('monitor-start', () => startMonitor());
  RouteRegistry.register('monitor-stop', () => stopMonitor());

  RouteRegistry.registerPage('pageMonitor', {
    onEnter: () => {
      const contractsEl = document.getElementById('monitorContracts');
      // 从收藏填充默认合约
      const favs = JSON.parse(localStorage.getItem('fv2_favs') || '[]');
      if (favs.length && !contractsEl.value) contractsEl.value = favs.join(', ');
    }
  });

  return { startMonitor, stopMonitor };
})();