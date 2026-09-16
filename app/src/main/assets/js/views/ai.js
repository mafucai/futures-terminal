/* ═══ 视图：AI 二轮分析 ═══
   设计要点（对齐需求）：
   - Key 只存本机（localStorage），日志/UI 全程脱敏（只显示后 4 位）
   - 拉模型 / 连接测试 / 超时 / 错误提示
   - Top N 可配置；复用第一轮筛选结果
   - 结构化 JSON 展示；失败时保留第一轮，不阻断
*/
(function () {
  'use strict';

  const CFG_KEY = 'ft_ai_cfg';

  function mask(key) {
    if (!key) return '（未设置）';
    if (key.length <= 8) return '••••';
    return key.slice(0, 3) + '••••' + key.slice(-4);
  }

  function loadConfig() {
    let cfg = { baseUrl: '', key: '', model: '', topN: 3 };
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) cfg = Object.assign(cfg, JSON.parse(raw));
    } catch { /* 忽略损坏 */ }
    return cfg;
  }

  function saveConfig() {
    const cfg = {
      baseUrl: document.getElementById('aiBaseUrl')?.value.trim() || '',
      key: document.getElementById('aiKey')?.value.trim() || '',
      model: document.getElementById('aiModel')?.value || '',
      topN: Number(document.getElementById('aiTopN')?.value || 3)
    };
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
      setConfigStatus(`✅ 已保存 · Key ${mask(cfg.key)} · Top ${cfg.topN}`, 'ok');
    } catch (err) {
      setConfigStatus('保存失败：' + err.message, 'bad');
    }
  }

  function hydrateConfig() {
    const cfg = loadConfig();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('aiBaseUrl', cfg.baseUrl);
    set('aiKey', cfg.key);
    set('aiTopN', cfg.topN);
    if (cfg.model) {
      const sel = document.getElementById('aiModel');
      if (sel) sel.innerHTML = `<option value="${UI.esc(cfg.model)}" selected>${UI.esc(cfg.model)}</option>`;
    }
    setConfigStatus(`Key ${mask(cfg.key)} · 仅存本机，日志脱敏`, cfg.key ? 'info' : '');
  }

  function setConfigStatus(text, kind) {
    const el = document.getElementById('aiConfigStatus');
    if (!el) return;
    el.innerHTML = `<span class="badge ${kind || 'info'}">${UI.esc(text)}</span>`;
  }

  function setAnalysisStatus(text, kind) {
    const el = document.getElementById('aiAnalysisStatus');
    if (!el) return;
    el.innerHTML = kind ? `<span class="badge ${kind}">${UI.esc(text)}</span>` : UI.esc(text);
  }

  /* ── 拉取模型列表 ── */
  async function fetchModels() {
    const baseUrl = document.getElementById('aiBaseUrl')?.value.trim();
    const key = document.getElementById('aiKey')?.value.trim();
    if (!baseUrl) { setConfigStatus('请先填写 API Base URL', 'warn'); return; }
    setConfigStatus('正在拉取模型列表…', 'info');
    try {
      const data = await API.aiModels(baseUrl, key);
      const list = (data?.data || data?.models || []).map(m => m.id || m.name || m).filter(Boolean);
      const sel = document.getElementById('aiModel');
      if (!list.length) throw new Error('接口未返回模型列表');
      sel.innerHTML = list.map(id => `<option value="${UI.esc(id)}">${UI.esc(id)}</option>`).join('');
      setConfigStatus(`✅ 已拉取 ${list.length} 个模型`, 'ok');
    } catch (err) {
      setConfigStatus('拉取失败：' + err.message, 'bad');
    }
  }

  /* ── 连接测试 ── */
  async function testConnection() {
    const baseUrl = document.getElementById('aiBaseUrl')?.value.trim();
    const key = document.getElementById('aiKey')?.value.trim();
    if (!baseUrl) { setConfigStatus('请先填写 API Base URL', 'warn'); return; }
    setConfigStatus('正在测试连接…', 'info');
    const t0 = Date.now();
    try {
      await API.aiModels(baseUrl, key);
      setConfigStatus(`✅ 连接正常（${Date.now() - t0}ms）`, 'ok');
    } catch (err) {
      setConfigStatus('❌ 连接失败：' + err.message, 'bad');
    }
  }

  /* ── 运行二轮分析 ── */
  async function runAnalysis() {
    const cfg = loadConfig();
    const topN = Number(document.getElementById('aiTopN')?.value || cfg.topN || 3);
    const model = document.getElementById('aiModel')?.value || cfg.model;
    const baseUrl = document.getElementById('aiBaseUrl')?.value.trim() || cfg.baseUrl;
    const key = document.getElementById('aiKey')?.value.trim() || cfg.key;
    const box = document.getElementById('aiResult');

    // 前置校验
    if (!baseUrl) { setAnalysisStatus('请先配置 API Base URL', 'warn'); return; }
    if (!model) { setAnalysisStatus('请先选择模型', 'warn'); return; }

    // 取第一轮候选（来自策略筛选缓存）
    let candidates = [];
    try {
      const screen = await API.screen({ mainOnly: false, multi: true, liveFetch: false });
      const hits = Array.isArray(screen) ? screen : (screen?.hits || screen?.results || []);
      candidates = hits.slice(0, topN).map(h => ({
        code: h.code || h.symbol || '',
        name: h.name || '',
        score: h.score ?? null,
        rank: h.rank ?? null,
        rules: h.rules || h.reason || null
      }));
    } catch (err) {
      setAnalysisStatus('第一轮筛选不可用：' + err.message + '（原功能不受影响）', 'warn');
    }

    if (!candidates.length) {
      setAnalysisStatus('暂无第一轮候选；AI 不会凭空选标的。请先运行策略筛选。', 'warn');
      box.innerHTML = '<div class="blank"><div class="em">🔬</div><div class="tx">缺少第一轮结果，AI 分析已跳过</div></div>';
      return;
    }

    setAnalysisStatus(`正在分析 Top ${candidates.length}…`, 'info');
    box.innerHTML = `<div class="note"><span class="spin"></span>AI 二轮分析中，请稍候…</div>`;

    try {
      const payload = {
        baseUrl, key, model, topN,
        candidates: candidates.map(c => ({ code: c.code, name: c.name, score: c.score, rank: c.rank, rules: c.rules }))
      };
      const data = await API.aiAnalyze(payload);
      renderAnalysis(data, candidates);
      setAnalysisStatus(`✅ 分析完成 · 模型 ${model}`, 'ok');
    } catch (err) {
      // 失败降级：保留第一轮，不阻断
      renderFallback(candidates, err.message);
      setAnalysisStatus('AI 分析失败，已保留第一轮结果：' + err.message, 'bad');
    }
  }

  function renderFallback(candidates, errMsg) {
    const box = document.getElementById('aiResult');
    box.innerHTML = `
      <div class="note" style="color:var(--warn)">⚠️ AI 不可用（${UI.esc(errMsg)}）——以下为第一轮原始结果，功能未中断。</div>
      <div class="grid">${candidates.map(renderCard).join('')}</div>`;
  }

  function renderCard(c) {
    const riskKind = c.riskLevel === '高' ? 'bad' : c.riskLevel === '中' ? 'warn' : 'ok';
    const verdict = c.verdict || '';
    return `
      <div class="q">
        <div class="q-hd">
          <div>
            <div class="q-nm">${UI.esc(c.name || c.code)}</div>
            <div class="q-cd">${UI.esc(c.code)}</div>
          </div>
          ${c.riskLevel ? `<span class="badge ${riskKind}">风险 ${UI.esc(c.riskLevel)}</span>` : ''}
        </div>
        <div class="q-ft" style="grid-template-columns:1fr 1fr">
          <div><div class="k">策略评分</div><div class="v">${UI.num(c.originalScore ?? c.score)}</div></div>
          <div><div class="k">基本面匹配</div><div class="v">${UI.num(c.fundamentalMatch)}</div></div>
          <div><div class="k">AI 评分</div><div class="v">${UI.num(c.aiScore)}</div></div>
          <div><div class="k">最终排名</div><div class="v">${UI.num(c.finalRank, 0)}</div></div>
        </div>
        ${c.riskReason ? `<div class="note" style="margin-top:10px">风险：${UI.esc(c.riskReason)}</div>` : ''}
        ${verdict ? `<div class="note" style="margin-top:6px;color:var(--brand)">结论：${UI.esc(verdict)}</div>` : ''}
      </div>`;
  }

  function renderAnalysis(data, candidatesById) {
    const box = document.getElementById('aiResult');
    const items = data?.results || data?.items || (Array.isArray(data) ? data : []);
    if (!items.length) {
      box.innerHTML = '<div class="blank"><div class="em">🤖</div><div class="tx">AI 未返回可解析结果</div></div>';
      return;
    }
    const meta = [];
    if (data?.model) meta.push('模型 ' + UI.esc(data.model));
    if (data?.asOf || data?.dataDate) meta.push('数据日期 ' + UI.esc(data.asOf || data.dataDate));
    if (data?.missing && data.missing.length) meta.push('缺失字段：' + UI.esc(data.missing.join('、')));
    box.innerHTML = `
      ${meta.length ? `<div class="note" style="margin-bottom:12px">${meta.join(' · ')}</div>` : ''}
      <div class="grid">${items.map(renderCard).join('')}</div>
      <div class="note" style="margin-top:14px;color:var(--warn)">
        ⚠️ AI 结论基于有限数据，仅供参考，不构成投资建议；数据不足时模型应输出「无法判断」。
      </div>`;
  }

  /* ── 历史记录 ── */
  async function loadHistory() {
    const box = document.getElementById('aiResult');
    box.innerHTML = '<div class="note"><span class="spin"></span>读取历史…</div>';
    try {
      const data = await API.aiHistory(10);
      const list = Array.isArray(data) ? data : (data?.history || []);
      if (!list.length) {
        box.innerHTML = '<div class="blank"><div class="em">🕘</div><div class="tx">暂无历史记录</div></div>';
        return;
      }
      box.innerHTML = list.map(rec => `
        <div class="panel" style="margin-bottom:10px">
          <div class="note">
            <span class="badge info">${UI.esc(rec.time || rec.timestamp || '--')}</span>
            <span>${UI.esc(rec.model || '')}</span>
            <span>Top ${UI.num(rec.topN, 0)}</span>
          </div>
          <div class="grid" style="margin-top:10px">${(rec.results || []).map(renderCard).join('')}</div>
        </div>`).join('');
    } catch (err) {
      box.innerHTML = `<div class="blank"><div class="em">⚠️</div><div class="tx">历史读取失败：${UI.esc(err.message)}</div></div>`;
    }
  }

  window.AIView = { fetchModels, testConnection, saveConfig, runAnalysis, loadHistory, mask };

  RouteRegistry.registerPage('vAI', { onEnter: hydrateConfig });
  // 注意：不在加载时调用 hydrateConfig —— UI 工具由 app.js 末尾赋值，
  // 本文件先于 app.js 加载，此刻 UI 尚不存在。改为 DOMContentLoaded 后执行。
  document.addEventListener('DOMContentLoaded', hydrateConfig);
})();
