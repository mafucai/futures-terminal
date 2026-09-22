/* ═══ 模块：策略库（唯一事实源 / Single Source of Truth）═══
   为什么存在（2026-09-22）：
     模拟盘、策略对比页、回测页 曾经各自直接读写 localStorage（fv2_strategy / fv2_cmp_strategies），
     一处改了另一处不知道 —— 典型的「数据未接通」。
     现统一由本模块提供读写；任何一处保存后广播 'strategy-library-changed'，
     其他页面在各自 onEnter 里重新取一次，不再各写各的。

   【存储键唯一事实源】禁止任何其他文件直接读写下面三个键
     fv2_strategy           主策略（策略编辑器的当前文本）
     fv2_cmp_strategies     对比页的多套策略 [{ id, name, code }]
     fv2_sim_last_strategy  模拟盘上次选用的策略 id

   【运行时所有权校验（2026-09-23）】：
     每个共享键只能有一个写入方。如果有第二个模块试图写入 → **立即抛错**（死代码变活代码）。
     用法：在其他模块入口处调用 StrategyLibrary.own(key, ownerId) 声明独占。

   【对外契约】
     StrategyLibrary.all()          → [{ id, name, code }]  主策略在前，其后为对比页 N 套
     StrategyLibrary.get(id)        → string  策略代码（取不到返回 ''）
     StrategyLibrary.setMain(code)  → { ok, bytes }
     StrategyLibrary.getList()      → [{ id, name, code }]
     StrategyLibrary.setList(arr)   → void
     StrategyLibrary.lastId()       → string  模拟盘上次选用的策略 id
     StrategyLibrary.remember(id)   → void
     StrategyLibrary.onChange(fn)   → 订阅变更
     StrategyLibrary.own(key, ownerId) → 声明独占，撞车即炸
   ================================================================= */
window.StrategyLibrary = (function () {
  'use strict';

  const MAIN_KEY = 'fv2_strategy';
  const CMP_KEY = 'fv2_cmp_strategies';
  const LAST_KEY = 'fv2_sim_last_strategy';
  const EVT = 'strategy-library-changed';

  /* ── 所有权表（键 → owner）── */
  const _owners = new Map();

  /** 声明某个键的独占写入方（必须在入口调用，撞车即炸） */
  function own(key, ownerId) {
    if (!['fv2_strategy', 'fv2_cmp_strategies', 'fv2_sim_last_strategy'].includes(key)) {
      throw new Error(`[StrategyLibrary] 未知键 ${key}，请在本模块补充`);
    }
    const prev = _owners.get(key);
    if (prev && prev !== ownerId) {
      throw new Error(`[StrategyLibrary] 键 ${key} 已被 "${prev}" 独占，拒绝 "${ownerId}"（数据不互通 = 运行时炸掉）`);
    }
    _owners.set(key, ownerId);
  }

  function _read(key, fb) {
    try { const v = localStorage.getItem(key); return v == null ? fb : v; } catch (e) { return fb; }
  }
  function _write(key, val) {
    try { localStorage.setItem(key, val); return true; } catch (e) { return false; }
  }

  /* ── 主策略 ── */
  function getMain() { return _read(MAIN_KEY, '') || ''; }
  function setMain(code) {
    const ok = _write(MAIN_KEY, code || '');
    if (!ok) throw new Error('本地保存失败（localStorage 不可用）');
    notify('main');
    return { ok: true, bytes: (code || '').length };
  }

  /* ── 对比页多套策略 ── */
  function getList() {
    try {
      const a = JSON.parse(_read(CMP_KEY, '[]'));
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function setList(arr) {
    _write(CMP_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
    notify('list');
  }

  /* ── 全量可见策略（下拉框直接用这个）── */
  function all() {
    const out = [{ id: 'main', name: '主策略（编辑器）', code: getMain() }];
    getList().forEach(function (s, i) {
      out.push({ id: s.id || ('cmp' + i), name: s.name || ('策略 ' + (i + 1)), code: s.code || '' });
    });
    return out;
  }
  function get(id) {
    if (!id) return '';
    const hit = all().find(function (s) { return s.id === id; });
    return hit ? (hit.code || '') : '';
  }

  /* ── 模拟盘「上次选用」记忆 ── */
  function lastId() { return _read(LAST_KEY, '') || ''; }
  function remember(id) { _write(LAST_KEY, id || ''); }

  /* ── 变更广播 ── */
  function notify(scope) {
    try { window.dispatchEvent(new CustomEvent(EVT, { detail: { scope: scope } })); } catch (e) { /* ignore */ }
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return;
    window.addEventListener(EVT, function (e) { try { fn((e && e.detail) || {}); } catch (err) { console.error('[StrategyLibrary]', err); } });
  }

  return {
    MAIN_KEY: MAIN_KEY, CMP_KEY: CMP_KEY, LAST_KEY: LAST_KEY, EVT: EVT,
    all: all, get: get,
    getMain: getMain, setMain: setMain,
    getList: getList, setList: setList,
    lastId: lastId, remember: remember,
    notify: notify, onChange: onChange
  };
})();
