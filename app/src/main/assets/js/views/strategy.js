/* =============================================
   views/strategy.js — 策略编辑器 + 筛选页
   RouteRegistry: load-strategy/save-strategy/run-screen/backtest-code
   ============================================= */
window.StrategyView = (function () {
  const DEFAULT_STRATEGY = `// 期货策略示例：均线突破
// onBar 在每根K线收盘后被调用
// 返回 { type: 'BUY' | 'SELL', reason: '说明' } 表示信号
// 上下文 ctx: { history, position, avgPrice, cash }
module.exports = {
  onBar: function(k, ctx) {
    const h = ctx.history;
    if (h.length < 20) return null;

    // 计算快线(5)与慢线(20)
    const closes = h.map(x => x.close);
    const fast = closes.slice(-5).reduce((a,b)=>a+b,0) / 5;
    const slow = closes.slice(-20).reduce((a,b)=>a+b,0) / 20;
    const prevFast = closes.slice(-6,-1).reduce((a,b)=>a+b,0) / 5;
    const prevSlow = closes.slice(-21,-1).reduce((a,b)=>a+b,0) / 20;

    // 金叉：快线上穿慢线
    if (prevFast <= prevSlow && fast > slow && ctx.position <= 0) {
      return { type: 'BUY', reason: '均线金叉' };
    }
    // 死叉：快线下穿慢线
    if (prevFast >= prevSlow && fast < slow && ctx.position >= 0) {
      return { type: 'SELL', reason: '均线死叉' };
    }
    return null;
  }
};`;

  async function loadStrategy() {
    const ta = document.getElementById('strategyEditor');
    const status = document.getElementById('strategyStatus');
    status.innerHTML = '<span class="loading"></span> 读取中...';
    try {
      const j = await window.API.getStrategy();
      ta.value = j.content || DEFAULT_STRATEGY;
      status.innerHTML = '<span style="color:var(--fall)">✅ 已加载' + (j.content ? '' : '（默认模板）') + '</span>';
    } catch (e) {
      status.innerHTML = `<span style="color:var(--rise)">❌ ${window.UI.esc(e.message)}</span>`;
    }
  }

  async function saveStrategy() {
    const content = document.getElementById('strategyEditor').value;
    const status = document.getElementById('strategyStatus');
    status.innerHTML = '<span class="loading"></span> 保存中...';
    try {
      const j = await window.API.saveStrategy(content);
      status.innerHTML = `<span style="color:var(--fall)">✅ ${window.UI.esc(j.message)}</span>`;
    } catch (e) {
      status.innerHTML = `<span style="color:var(--rise)">❌ ${window.UI.esc(e.message)}</span>`;
    }
  }

  async function runScreen() {
    const box = document.getElementById('screenResult');
    box.style.display = 'block';
    box.innerHTML = '<span class="loading"></span> <span style="color:var(--text-dim)">策略筛选中（读本地缓存，不联网）...</span>';
    const content = document.getElementById('strategyEditor').value;
    if (!content.trim()) { box.innerHTML = '<span style="color:var(--rise)">策略为空，请先写策略</span>'; return; }
    try {
      const mainOnly = !!(document.getElementById('screenMainOnly') && document.getElementById('screenMainOnly').checked);
      const multi = !!(document.getElementById('screenMulti') && document.getElementById('screenMulti').checked);
      const j = await window.API.screen(content, 101, { mainOnly, multi });
      if (!j.results || !j.results.length) {
        box.innerHTML = `<span style="color:var(--text-dim)">扫描 ${j.totalTargets} 个合约，${j.skipped} 个无缓存。当前无信号。</span>`;
        return;
      }
      // 按 EMA26 符合度评分从高到低排序
      const sorted = j.results.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
      let h = `<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px">扫描 ${j.totalTargets} 个合约 · 命中 ${j.results.length} 个（按 EMA26 符合度评分排序）</div>`;
      sorted.forEach(x => {
        const isBuy = x.signal.type === 'BUY';
        const c = isBuy ? 'var(--rise)' : 'var(--fall)';
        const tag = isBuy ? '\u25B2 做多' : '\u25BC 做空';
        const sc = x.score !== undefined && x.score !== null ? x.score : '--';
        const sd = x.scoreDetail && x.scoreDetail.conditions;
        const dirTxt = sd ? (sd.direction === 'LONG' ? '多' : '空') : '-';
        const hitTxt = sd ? ['dirHit','crossHit','distHit','confirmHit','candleHit'].filter(k => sd[k]).length + '/5' : '';
        const scoreColor = (typeof sc === 'number') ? (sc >= 80 ? 'var(--rise)' : (sc >= 60 ? '#f0a020' : 'var(--text-dim)')) : 'var(--text-dim)';
        h += '<div style="padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">'
          + '<div style="cursor:pointer;flex:1" onclick="RouteRegistry.dispatch(\'open-detail\',\'' + window.UI.esc(x.code) + '\')">'
          + '<div style="font-weight:600">' + window.UI.esc(x.name) + ' (' + window.UI.esc(x.code) + ')</div>'
          + '<div style="font-size:12px;color:var(--text-dim)">' + window.UI.esc(x.signal.reason) + '</div></div>'
          + '<div style="text-align:right"><div style="font-weight:700;color:' + scoreColor + ';font-size:18px">' + window.UI.esc(String(sc)) + '<span style="font-size:10px">分</span></div>'
          + '<div style="font-size:11px;color:var(--text-dim)">方向' + window.UI.esc(dirTxt) + ' ' + window.UI.esc(hitTxt) + '</div>'
          + '<div style="color:' + c + ';font-weight:600;font-size:13px">' + tag + '</div>'
          + '<div style="font-size:12px;color:var(--text-dim)">' + x.price + ' · ' + x.signals + '信号</div>'
          + '<button class="btn btn-secondary" style="margin-top:4px;font-size:10px;padding:3px 8px" onclick="RouteRegistry.dispatch(\'backtest-code\',\'' + window.UI.esc(x.code) + '\')">\uD83D\uDCCA 回测</button></div></div>';
      });
      box.innerHTML = h;
    } catch (e) {
      box.innerHTML = '<span style="color:var(--rise)">❌ ' + window.UI.esc(e.message) + '</span>';
    }
  }

  // 注册路由
  RouteRegistry.register('load-strategy', () => loadStrategy());
  RouteRegistry.register('save-strategy', () => saveStrategy());
  RouteRegistry.register('run-screen', () => runScreen());
  RouteRegistry.register('backtest-code', (code) => {
    // 自动填入回测页并跳转
    const btCode = document.getElementById('btCode');
    if (btCode) btCode.value = code;
    RouteRegistry.navigate('pageBacktest');
  });

  RouteRegistry.registerPage('pageStrategy', {
    onEnter: () => {
      const ta = document.getElementById('strategyEditor');
      if (!ta.value) ta.value = DEFAULT_STRATEGY;
    }
  });

  return { loadStrategy, saveStrategy, runScreen };
})();