/* ═══ 视图：策略编辑器 + 筛选 ═══ */
(function () {
  'use strict';

  async function loadStrategy() {
    const ta = document.getElementById('strategyEditor');
    const st = document.getElementById('strategyStatus');
    if (st) st.innerHTML = '<span class="spin"></span>正在读取策略…';
    try {
      const data = await API.getStrategy();
      const code = typeof data === 'string' ? data : (data?.code || data?.strategy || '');
      if (ta) ta.value = code || '';
      if (st) st.innerHTML = `<span>✅ 已读取（${code.length} 字符）· 保存在本地，永不联网</span>`;
    } catch (err) {
      if (st) st.innerHTML = `<span style="color:var(--danger)">读取失败：${UI.esc(err.message)}</span>`;
    }
  }

  async function saveStrategy() {
    const ta = document.getElementById('strategyEditor');
    const st = document.getElementById('strategyStatus');
    const code = ta?.value || '';
    if (!code.trim()) { if (st) st.innerHTML = '<span style="color:var(--warn)">策略为空，未保存</span>'; return; }
    if (st) st.innerHTML = '<span class="spin"></span>正在保存…';
    try {
      await API.saveStrategy(code);
      if (st) st.innerHTML = '<span>✅ 已保存到 strategies/my_strategy.js</span>';
      UI.status('策略已保存', '');
    } catch (err) {
      if (st) st.innerHTML = `<span style="color:var(--danger)">保存失败：${UI.esc(err.message)}</span>`;
    }
  }

  async function runScreen() {
    const box = document.getElementById('screenResult');
    const mainOnly = document.getElementById('screenMainOnly')?.checked || false;
    const multi = document.getElementById('screenMulti')?.checked || false;
    if (box) { box.style.display = 'block'; box.innerHTML = '<div class="note"><span class="spin"></span>正在筛选…</div>'; }
    UI.status('正在筛选策略…', 'warn');
    try {
      const data = await API.screen({ mainOnly, multi, liveFetch: false });
      const hits = Array.isArray(data) ? data : (data?.hits || data?.results || []);
      renderScreen(hits);
      UI.status(`筛选完成 · 命中 ${hits.length} 个`, '');
    } catch (err) {
      if (box) box.innerHTML = `<div class="blank"><div class="em">⚠️</div><div class="tx">筛选失败：${UI.esc(err.message)}</div></div>`;
      UI.status('筛选失败：' + err.message, 'err');
    }
  }

  function renderScreen(hits) {
    const box = document.getElementById('screenResult');
    if (!box) return;
    if (!hits.length) {
      box.innerHTML = '<div class="blank"><div class="em">📭</div><div class="tx">没有命中合约（多为缓存不足，可去行情页载入）</div></div>';
      return;
    }
    box.innerHTML = `<div class="stats">
      <div class="stat"><div class="k">命中数</div><div class="v">${hits.length}</div></div>
      <div class="stat"><div class="k">最高分</div><div class="v">${hits[0] && hits[0].score != null ? UI.num(hits[0].score) : '--'}</div></div>
    </div><div class="grid">${hits.map(h => {
      const sc = typeof h.score === 'number' ? h.score : null;
      const rules = Array.isArray(h.rules) ? h.rules : [];
      return `
      <div class="q" data-code="${UI.esc(h.code || '')}">
        <div class="q-hd">
          <div>
            <div class="q-nm">${UI.esc(h.name || h.code || '--')}</div>
            <div class="q-cd">${UI.esc(h.code || '')}${h.rank ? ' · rank ' + h.rank : ''}</div>
          </div>
          ${sc != null ? `<span class="badge info">${UI.num(sc)}</span>` : ''}
        </div>
        ${h.grade ? `<div class="note" style="margin-top:6px">${UI.esc(h.summary || ('等级 ' + h.grade))}</div>` : ''}
        ${rules.length ? `<div class="note" style="margin-top:6px;display:block">${rules.map(r =>
          `<div>${r.hit ? '✓' : '✗'} ${UI.esc(r.id)} ${UI.num(r.score)} <span style="color:var(--t3)">w${r.weight}</span></div>`).join('')}</div>` : ''}
        ${h.signal ? `<div class="note" style="margin-top:6px">信号：${UI.esc(h.signal.type || '')} ${h.signal.reason ? '· ' + UI.esc(h.signal.reason) : ''}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
    box.querySelectorAll('.q').forEach(el => {
      el.addEventListener('click', () => RouteRegistry.dispatch('open-detail', { code: el.dataset.code }));
    });
  }

  function onEnter() {
    const ta = document.getElementById('strategyEditor');
    if (ta && !ta.value) loadStrategy();
    // 策略对比：进入页面时刷新策略列表（动态 ＋ 号卡片）
    if (window.StrategyCompareView && typeof StrategyCompareView.enter === 'function') {
      try { StrategyCompareView.enter(); } catch (e) { /* 不阻断 */ }
    }
  }

  /* 一键把内置 JS 示例填进编辑器 */
  function loadExample(kind) {
    const ta = document.getElementById('strategyEditor');
    const st = document.getElementById('strategyStatus');
    if (!ta) return;
    const tpl = (window.StrategyTemplates || {})[kind];
    if (!tpl) { if (st) st.innerHTML = '<span style="color:var(--danger)">未找到示例</span>'; return; }
    if (ta.value.trim() && !confirm('编辑器里已有内容，确定用示例覆盖吗？')) return;
    ta.value = tpl;
    if (st) st.innerHTML = '<span>✅ 已载入示例（JavaScript）。记得点「💾 保存」后再筛选取用。</span>';
    UI.status('已载入示例策略', '');
  }

  window.StrategyView = { loadStrategy, saveStrategy, runScreen, onEnter, loadExample };

  RouteRegistry.register('load-strategy', loadStrategy);
  RouteRegistry.register('save-strategy', saveStrategy);
  RouteRegistry.register('run-screen', runScreen);
  RouteRegistry.registerPage('vStrategy', { onEnter });
})();
