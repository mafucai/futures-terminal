/* ═══ 视图：行情列表 ═══ */
(function () {
  'use strict';

  const STATE = {
    all: [],            // 全量合约
    starOnly: false,    // 只看收藏
    stars: new Set(),   // 收藏代码
    loaded: false
  };
  const STAR_KEY = 'ft_stars';

  function loadStars() {
    try {
      const raw = localStorage.getItem(STAR_KEY);
      if (raw) STATE.stars = new Set(JSON.parse(raw));
    } catch { /* 忽略损坏数据 */ }
  }
  function saveStars() {
    try { localStorage.setItem(STAR_KEY, JSON.stringify([...STATE.stars])); } catch { /* 忽略 */ }
  }

  function toggleStar(code) {
    if (STATE.stars.has(code)) STATE.stars.delete(code);
    else STATE.stars.add(code);
    saveStars();
    renderList();
  }

  function toggleStarOnly() {
    STATE.starOnly = !STATE.starOnly;
    document.getElementById('favToggle').classList.toggle('on', STATE.starOnly);
    renderList();
  }

  function renderFavBar() {
    const bar = document.getElementById('favBar');
    const cnt = document.getElementById('favCount');
    if (cnt) cnt.textContent = STATE.stars.size ? STATE.stars.size + ' 个收藏' : '';
    if (!bar) return;
    if (!STATE.stars.size) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = [...STATE.stars].map(code =>
      `<span class="chip" onclick="RouteRegistry.dispatch('open-detail',{code:'${UI.esc(code)}'})">` +
      `${UI.esc(code)}<i onclick="event.stopPropagation();ListView.toggleStar('${UI.esc(code)}')">✕</i></span>`
    ).join('');
  }

  function card(q) {
    const chg = Number(q.changePct);
    const trend = UI.trend(chg);
    const star = STATE.stars.has(q.code) ? ' star' : '';
    const stale = UI.isStale(q.time || q.timestamp) ? '<span class="tag-old">⚠️过期</span>' : '';
    const sign = Number.isFinite(chg) && chg > 0 ? '+' : '';
    return `
      <div class="q${star}" data-code="${UI.esc(q.code)}">
        <div class="q-hd">
          <div>
            <div class="q-nm">${UI.esc(q.name || '--')}</div>
            <div class="q-cd">${UI.esc(q.code || '')}</div>
          </div>
          ${stale}
        </div>
        <div class="q-px">${UI.num(q.price ?? q.last ?? q.close)}</div>
        <div class="q-ch ${trend}">${sign}${UI.num(chg)}%</div>
        <div class="q-ft">
          <div><div class="k">最高</div><div class="v">${UI.num(q.high)}</div></div>
          <div><div class="k">最低</div><div class="v">${UI.num(q.low)}</div></div>
          <div><div class="k">持仓</div><div class="v">${UI.num(q.openInterest ?? q.hold, 0)}</div></div>
        </div>
      </div>`;
  }

  function renderList() {
    const box = document.getElementById('quoteContainer');
    if (!box) return;
    const kw = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();

    let list = STATE.all.slice();
    if (STATE.starOnly) list = list.filter(q => STATE.stars.has(q.code));
    if (kw) list = list.filter(q =>
      String(q.code).toLowerCase().includes(kw) || String(q.name || '').toLowerCase().includes(kw));

    renderFavBar();

    if (!list.length) {
      box.innerHTML = `<div class="blank"><div class="em">${STATE.loaded ? '🔍' : '📂'}</div>
        <div class="tx">${STATE.loaded ? '没有匹配的合约' : '点击「载入数据」开始'}</div></div>`;
      return;
    }
    box.innerHTML = `<div class="grid">${list.map(card).join('')}</div>`;
    box.querySelectorAll('.q').forEach(el => {
      el.addEventListener('click', () => RouteRegistry.dispatch('open-detail', { code: el.dataset.code }));
    });
  }

  async function loadData(refresh) {
    const box = document.getElementById('quoteContainer');
    const btn = document.getElementById('loadBtn');
    if (btn) btn.disabled = true;
    // 手动触发：refresh=true 才联网拉全量；否则优先读本地缓存（不自动联网）
    UI.status(refresh ? '正在联网刷新全量行情…' : '正在读取行情缓存…', 'warn');
    box.innerHTML = `<div class="note"><span class="spin"></span>${refresh ? '正在联网刷新全量行情…' : '正在读取本地缓存…'}</div>`;
    try {
      const data = await API.futuresAll(refresh);
      // 兼容后端三种形态：数组 / {list:[...]} / {data:{code:info}} 映射
      let arr = Array.isArray(data) ? data
        : Array.isArray(data?.list) ? data.list
        : Array.isArray(data?.data) ? data.data
        : (data?.data && typeof data.data === 'object') ? Object.entries(data.data).map(([code, v]) => ({ code, ...(v || {}) }))
        : [];
      STATE.all = arr.map(it => ({
        code: it.code || it.symbol || '',
        name: it.name || '',
        price: it.price ?? it.last ?? it.close,
        changePct: it.changePct ?? it.pct,
        high: it.high, low: it.low,
        openInterest: it.openInterest ?? it.hold ?? it.position,
        time: it.time ?? it.timestamp ?? it.updatedAt
      })).filter(x => x.code);
      STATE.loaded = true;
      UI.status(`行情就绪 · ${STATE.all.length} 个合约${refresh ? '（已联网刷新）' : '（来自缓存）'}`, '');
      renderList();
    } catch (err) {
      UI.status('行情获取失败：' + err.message, 'err');
      box.innerHTML = `<div class="blank"><div class="em">⚠️</div><div class="tx">${UI.esc(err.message)}</div></div>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* 手动「增量更新」：只补新K线，旧数据不删不动（唯一批量联网入口） */
  async function incrementalUpdate() {
    const raw = (document.getElementById('incrCodes')?.value || '').trim();
    const periods = (document.getElementById('incrPeriod')?.value || '101,240,60')
      .split(',').map(s => Number(s.trim())).filter(Boolean);
    const st = document.getElementById('incrStatus');
    const btn = document.getElementById('incrBtn');
    if (!raw) {
      if (st) st.innerHTML = '<span style="color:var(--warn)">请先填写要增量更新的合约代码（逗号分隔）</span>';
      return;
    }
    const codes = raw.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
    if (btn) btn.disabled = true;
    if (st) st.innerHTML = '<span class="spin"></span>正在增量更新（只补新K线）…';
    UI.status('增量更新中…', 'warn');
    try {
      const r = await API.incrementalUpdate(codes, periods, (done, total, code, p) => {
        if (st) st.innerHTML = `<span class="spin"></span>进度 ${done}/${total}（${UI.esc(code)} ${p}）…`;
      });
      if (st) st.innerHTML = `✅ 完成：新增 ${r.added} 根 · 更新末根 ${r.updated} 次 · 共 ${r.total} 项`
        + (r.failed.length ? ` · <span style="color:var(--warn)">${r.failed.length} 项无数据</span>` : '')
        + `（旧数据保留，未删除）`;
      UI.status(`增量更新完成 · 新增 ${r.added} 根`, '');
    } catch (err) {
      if (st) st.innerHTML = `<span style="color:var(--danger)">增量更新失败：${UI.esc(err.message)}</span>`;
      UI.status('增量更新失败：' + err.message, 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.ListView = { renderList, loadData, incrementalUpdate, toggleStar, toggleStarOnly, STATE };

  RouteRegistry.register('load-data', () => loadData(false));
  RouteRegistry.register('refresh-data', () => loadData(true));
  RouteRegistry.register('open-detail', p => {
    if (!p || !p.code) return;
    if (window.DetailView) DetailView.open(p.code);
  });
  RouteRegistry.register('back-to-list', () => RouteRegistry.navigate('vList'));
  RouteRegistry.register('toggle-fav', p => toggleStar(p?.code));

  loadStars();
})();
