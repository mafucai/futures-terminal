/* ═══ 视图：实时监控 ═══ */
(function () {
  'use strict';

  let timer = null;

  function appendLog(line) {
    const el = document.getElementById('monitorLog');
    if (!el) return;
    const stamp = UI.fmtTime(Date.now());
    el.textContent = `[${stamp}] ${line}\n` + (el.textContent === '监控日志将显示在这里' ? '' : el.textContent);
  }

  function setIndicator(running) {
    const el = document.getElementById('monitorStatus');
    if (!el) return;
    el.innerHTML = running
      ? '<span class="pill run">● 运行中</span>'
      : '<span class="pill stop">● 未启动</span>';
  }

  async function start() {
    const raw = document.getElementById('monitorContracts')?.value.trim() || '';
    const codes = raw ? raw.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
    if (!codes.length) { appendLog('⚠️ 请先填写合约代码'); return; }
    try {
      await API.monitorStart({ codes });
      setIndicator(true);
      appendLog(`▶ 监控已启动：${codes.join(', ')}`);
      UI.status('监控运行中', '');
      pollQuotes(codes);
    } catch (err) {
      appendLog('❌ 启动失败：' + err.message);
      UI.status('监控启动失败', 'err');
    }
  }

  async function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    try { await API.monitorStop(); } catch { /* 后端可能未启动，忽略 */ }
    setIndicator(false);
    appendLog('⏹ 监控已停止');
    UI.status('已停止', '');
  }

  function pollQuotes(codes) {
    if (timer) clearInterval(timer);
    timer = setInterval(async () => {
      for (const code of codes) {
        try {
          const q = await API.quote(code);
          const item = Array.isArray(q) ? q[0] : q;
          if (!item) continue;
          const chg = Number(item.changePct ?? item.pct);
          const mark = Number.isFinite(chg) ? (chg > 0 ? '▲' : chg < 0 ? '▼' : '·') : '·';
          appendLog(`${mark} ${code}  ${UI.num(item.price ?? item.last ?? item.close)}  ${UI.num(chg)}%`);
        } catch (err) {
          appendLog(`⚠️ ${code} 报价失败：${err.message}`);
        }
      }
    }, 30000);
  }

  window.MonitorView = { start, stop };

  RouteRegistry.register('monitor-start', start);
  RouteRegistry.register('monitor-stop', stop);
  RouteRegistry.registerPage('vMonitor', { onEnter: () => {} });
})();
