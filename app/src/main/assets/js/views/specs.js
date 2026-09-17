/* ═══ 视图：合约规格（同花顺 乘数/保证金/手续费）═══
   Key 仅存本机 localStorage，界面脱敏；无 Key 时用内置兜底表。
   ==================================================== */
(function () {
  'use strict';

  function saveKey() {
    const inp = document.getElementById('specKey');
    const st = document.getElementById('specStatus');
    const k = (inp && inp.value || '').trim();
    if (!k) { if (st) st.innerHTML = '<span style="color:var(--warn)">请输入 Key</span>'; return; }
    Specs.setKey(k);
    if (inp) inp.value = '';
    if (st) st.innerHTML = `<span>✅ 已保存（本机）：${UI.esc(Specs.maskKey(k))} · 点「⟳ 从同花顺刷新乘数」拉取</span>`;
    UI.status('同花顺 Key 已保存', '');
  }

  async function refresh() {
    const st = document.getElementById('specStatus');
    const btn = document.querySelector('#vStrategy .btn-p');
    if (!Specs.getKey()) { if (st) st.innerHTML = '<span style="color:var(--warn)">请先填写并保存同花顺 API Key</span>'; return; }
    if (st) st.innerHTML = '<span class="spin"></span>正在从同花顺拉取合约乘数…';
    UI.status('拉取合约规格中…', 'warn');
    try {
      const r = await Specs.fetchFromHithink();
      if (st) st.innerHTML = `<span>✅ 已刷新：${r.count} 个品种（本机缓存，界面脱敏）· ${UI.esc(String(r.at).slice(0, 19).replace('T', ' '))}</span>`;
      UI.status(`合约规格已刷新 · ${r.count} 品种`, '');
      renderTable();
    } catch (err) {
      if (st) st.innerHTML = `<span style="color:var(--danger)">刷新失败：${UI.esc(err.message)}</span>`;
      UI.status('合约规格刷新失败', 'err');
    }
  }

  function show(code) {
    const st = document.getElementById('specStatus');
    if (!code) code = (document.getElementById('simCode') && document.getElementById('simCode').value) || 'agm';
    const s = Specs.get(code);
    if (st) st.innerHTML = `<span>🔍 ${UI.esc(code)} → 品种 ${UI.esc(s.variety || '--')} · 乘数 <b style="color:var(--t1)">${s.multiplier}</b> · 保证金 ${(s.marginRate * 100).toFixed(1)}% · 手续费 ${s.fee} 元/手 + ${(s.feeRate * 10000).toFixed(2)}‱ · 来源 ${UI.esc(s.source)}</span>`;
  }

  function renderTable() {
    const box = document.getElementById('specTable');
    if (!box) return;
    const cached = Specs.loadAll();
    const src = cached || Specs.BUILTIN;
    const keys = Object.keys(src).sort();
    if (!keys.length) { box.innerHTML = '<div class="note">暂无数据，可点「⟳ 从同花顺刷新乘数」</div>'; return; }
    box.innerHTML = `<div class="note" style="margin-bottom:8px"><span>共 ${keys.length} 个品种 · ${cached ? '（同花顺缓存）' : '（内置兜底表，未联网）'}</span></div>
      <div style="max-height:280px;overflow:auto">
      <table style="width:100%;font-size:11.5px;font-family:var(--mono);border-collapse:collapse">
      <thead><tr style="color:var(--t3);text-align:left">
        <th style="padding:4px">品种</th><th style="padding:4px">名称</th><th style="padding:4px">乘数</th>
        <th style="padding:4px">保证金</th><th style="padding:4px">手续费</th>
      </tr></thead><tbody>
      ${keys.map(k => {
        const s = src[k];
        const feeTxt = (s.fee ? s.fee + '元/手' : '') + (s.feeRate ? (s.fee ? ' + ' : '') + (s.feeRate * 10000).toFixed(1) + '‱' : '') || '--';
        return `<tr style="border-top:1px solid var(--line)">
          <td style="padding:4px">${UI.esc(k)}</td><td style="padding:4px">${UI.esc(s.name || '')}</td>
          <td style="padding:4px">${s.multiplier}</td>
          <td style="padding:4px">${s.marginRate != null ? (s.marginRate * 100).toFixed(0) + '%' : '--'}</td>
          <td style="padding:4px">${feeTxt}</td></tr>`;
      }).join('')}
      </tbody></table></div>`;
  }

  window.SpecsView = { saveKey, refresh, show, renderTable };

  RouteRegistry.registerPage('vStrategy', {
    onEnter: () => {
      renderTable();
      const st = document.getElementById('specStatus');
      const c = Specs.cachedCount();
      const mask = Specs.maskKey(Specs.getKey());
      if (st && !st.dataset.done) {
        st.dataset.done = '1';
        st.innerHTML = `<span>🔒 Key ${mask ? '已保存 ' + UI.esc(mask) : '未设置'} · 缓存 ${c} 品种 · ${Specs.lastUpdate() ? '上次更新 ' + UI.esc(String(Specs.lastUpdate()).slice(0, 19).replace('T', ' ')) : '未联网更新过'}</span>`;
      }
    }
  });
})();
