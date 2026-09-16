/* =============================================
   views/list.js — 行情列表页
   RouteRegistry: list/load-data/refresh-data/toggle-fav
   ============================================= */
window.ListView = (function () {
  const FAV_KEY = 'fv2_favs';
  let allQuotes = [];
  let favOnly = false;
  let lastDataTime = null;   // 记录数据时间

  function getFavs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch(e) { return []; }
  }

  function saveFavs(favs) {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    renderFavBar();
    renderList();
  }

  function toggleFav(code) {
    let favs = getFavs();
    if (favs.includes(code)) favs = favs.filter(c => c !== code);
    else favs.push(code);
    saveFavs(favs);
  }

  function renderFavBar() {
    const bar = document.getElementById('favBar');
    const favs = getFavs();
    if (!favs.length) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = favs.map(c => {
      const found = allQuotes.find(q => q[0] === c);
      const n = found ? (found[1].name || c) : c;
      return `<span class="fav-tag" data-code="${c}" onclick="RouteRegistry.dispatch('search-code','${c}')">${n} <span class="del" data-code="${c}" onclick="event.stopPropagation();ListView.toggleFav(this.dataset.code)">✕</span></span>`;
    }).join('');
  }

  function renderList() {
    const kw = document.getElementById('searchInput').value.trim().toLowerCase();
    let filtered = allQuotes;
    if (favOnly) { const f = getFavs(); filtered = filtered.filter(q => f.includes(q[0])); }
    if (kw) filtered = filtered.filter(q => q[0].toLowerCase().includes(kw) || (q[1].name || '').toLowerCase().includes(kw));

    const container = document.getElementById('quoteContainer');
    const favs = getFavs();
    let html = '<div class="quote-grid">';
    for (const [code, q] of filtered) {
      const pct = Number(q.changePct) || 0;
      const price = Number(q.price) || 0;
      const open = Number(q.open) || 0;
      const high = Number(q.high) || 0;
      const low = Number(q.low) || 0;
      const lastClose = Number(q.lastClose) || 0;
      const changeAmt = Number(q.changeAmt) || 0;
      const isRise = pct >= 0;
      const cls = isRise ? 'rise' : 'fall';
      const arrow = isRise ? '▲' : '▼';
      const isFav = favs.includes(code);
      html += `<div class="quote-card${isFav ? ' fav' : ''}" data-code="${code}" onclick="RouteRegistry.dispatch('open-detail','${code}')">`
        + `<div class="quote-top"><div><div class="quote-name">${window.UI.esc(q.name || code)}</div><div class="quote-code">${code}</div></div>`
        + `<div style="text-align:right"><div class="quote-price">${price ? price.toFixed(2) : '--'}</div>`
        + `<div class="quote-change ${cls}">${arrow} ${Math.abs(pct).toFixed(2)}%</div>`
        + `<button class="btn-star ${isFav ? 'active' : ''}" onclick="event.stopPropagation();ListView.toggleFav('${code}')">${isFav ? '★' : '☆'}</button></div></div>`
        + `<div class="quote-meta">`
        + `<div class="quote-meta-item"><div class="quote-meta-label">今开</div><div class="quote-meta-value">${open || '-'}</div></div>`
        + `<div class="quote-meta-item"><div class="quote-meta-label">最高</div><div class="quote-meta-value">${high || '-'}</div></div>`
        + `<div class="quote-meta-item"><div class="quote-meta-label">昨收</div><div class="quote-meta-value">${lastClose || '-'}</div></div>`
        + `<div class="quote-meta-item"><div class="quote-meta-label">涨跌</div><div class="quote-meta-value">${changeAmt || 0}</div></div>`
        + `<div class="quote-meta-item"><div class="quote-meta-label">最低</div><div class="quote-meta-value">${low || '-'}</div></div>`
        + `<div class="quote-meta-item"><div class="quote-meta-label">涨幅</div><div class="quote-meta-value">${pct.toFixed(2)}%</div></div>`
        + `</div></div>`;
    }
    html += '</div>';
    container.innerHTML = html;
    window.UI.setStatus(`${allQuotes.length}个合约 · 显示${filtered.length}个${favOnly ? ' · ⭐只看收藏' : ''}`);
  }

  async function loadData(refresh) {
    const btn = document.getElementById('loadBtn');
    btn.disabled = true;
    btn.textContent = refresh ? '⏳ 拉取中...' : '⏳ 加载中...';
    document.getElementById('quoteContainer').innerHTML = window.UI.loading;
    window.UI.setStatus(refresh ? '正在拉取最新数据...' : '正在加载缓存...');
    try {
      const j = await window.API.getFutures(refresh);
      allQuotes = Object.entries(j.data);
      lastDataTime = j.time || null;
      renderList();
      renderFavBar();
      const tag = j.cached ? '📦 缓存数据' : '🌐 实时数据';
      const dataTime = window.UI.fmtTime(j.time);
      const stale = j.cached && window.UI.isStale(j.time, 60);
      window.UI.setStatus(`全市场期货 · 共${j.total}个合约 · ${tag} · 数据时间:${dataTime}${stale ? ' ⚠️已超1小时' : ''}${j.warn ? ' ⚠️' + j.warn : ''}`);
    } catch (e) {
      document.getElementById('quoteContainer').innerHTML = `<div style="color:var(--rise);padding:12px">❌ ${e.message}</div>`;
    }
    btn.disabled = false;
    btn.textContent = '📂 载入数据';
  }

  function toggleFavOnly() {
    favOnly = !favOnly;
    document.getElementById('favFilterBtn').classList.toggle('active', favOnly);
    renderList();
  }

  // 注册路由
  RouteRegistry.register('load-data', () => loadData(false));
  RouteRegistry.register('refresh-data', () => loadData(true));
  RouteRegistry.register('toggle-fav', () => toggleFavOnly());
  RouteRegistry.register('search-code', (code) => {
    document.getElementById('searchInput').value = code;
    renderList();
  });

  RouteRegistry.registerPage('pageList', {
    onEnter: () => {
      if (allQuotes.length === 0) loadData(false);
    }
  });

  return { toggleFav, toggleFavOnly, loadData };
})();