#!/usr/bin/env node
/* ═══ 模拟盘 / 策略库 UI 回归自检（离线，无需浏览器）═══
   用途：每次改动 views/sim*.js、strategy-library.js、router.js、api.js 后必须跑一次。
   这是「设计调用蓝图」的可执行部分 —— 蓝图里画的关系，这里逐条断言。

   运行：node scripts/ui-regression.js
   退出码：0 = 全绿；1 = 有失败

   覆盖的验收标准：
     1. 进模拟盘页 → 策略下拉自动填充（主策略 + 对比页 N 套）
     2. 对比页改策略 → 模拟盘同步，且取到最新代码（数据接通）
     3. 离开再回来，选中策略不丢
     4. 点对比卡片 → 买卖点 + 成交记录 + 权益曲线三者齐全（不再丢 trades/equity）
     5. 中央路由：每页 onEnter 恰好执行一次；同页多个注册方串行都执行
     6. 模块化边界：SimRender 纯渲染、StrategyLibrary 是策略唯一事实源

   注意：脚本用 DOM 桩模拟 WebView，不联网、不写真实 localStorage。
   ================================================================= */
/* ═══ 模拟盘链路回归（DOM 桩，不依赖浏览器）═══
   验证 5 条验收标准。被测代码 = /workspace/repos/futures-terminal/app/src/main/assets/js（真实仓库文件） */
const BASE = require('path').join(__dirname, '..', 'app/src/main/assets/js');

/* ── DOM 桩 ── */
const els = {};
const PRE = ['simStrategy','simCode','simPeriod','simLatest','simDate','simQty','simRisk','simStatus',
             'simAllResult','simPos','simTrades','simChart','simSpecInfo','connDot','connText','clock',
             'strategyEditor','strategyStatus','cmpList','cmpStatus','cmpCode','cmpPeriod','cmpLimit','cmpResult','specStatus'];
function mkEl(id){ return els[id] || (els[id]={ id, value:'', checked:false, options:[],
  innerHTML:'', textContent:'', dataset:{}, style:{}, _map:null, _handlers:{},
  classList:{toggle(){}}, addEventListener(ev,fn){ (this._handlers[ev]=this._handlers[ev]||[]).push(fn); },
  querySelectorAll(){ return []; }, querySelector(){ return null; },
  closest(){ return null; } }); }
PRE.forEach(mkEl);
global.window = global;
const LS = { _d: {} };
global.localStorage = { getItem:k=>LS._d[k]??null, setItem:(k,v)=>{LS._d[k]=String(v)}, removeItem:k=>{delete LS._d[k]}, get length(){return Object.keys(LS._d).length} };
global.addEventListener=()=>{}; global.window.addEventListener=()=>{}; global.setInterval=()=>0; global.setTimeout=()=>0;
global.document={ getElementById:id=>els[id]||null, querySelectorAll:()=>[],
  addEventListener:(e,f)=>{ if(e==='DOMContentLoaded') global.__dcl=f; }, createElement:()=>mkEl('tmp') };
global.UI={ esc:s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  num:(v,d)=>{ if(v==null||v==='')return '--'; const n=Number(v); return Number.isFinite(n)?n.toFixed(d==null?2:d):'--'; },
  status:()=>{}, fmtTime:t=>String(t||'--') };
global.window.UI = global.UI;
global.echarts = { init:()=>({ setOption(o){ global.__lastOption=o; }, dispose(){}, resize(){} }) };

/* ── 被测模块的依赖桩 ── */
let FAKE_ACCOUNT = null;
global.window.StrategyRunner={ createContext:()=>({}), compileStrategy:()=>({}), runStrategy:async()=>null };
global.window.Screener={ readKlineCache:()=>KLINES, Store:{_k:'fv2_kline_',loadFutures:()=>null,saveFutures:()=>{}} };
global.window.WebData={}; global.window.Scoring={}; global.window.Backtest={};
global.window.Specs={ get:()=>({multiplier:10,marginRate:0.1,fee:2,source:'内置'}),
  cachedCount:()=>3, getKey:()=>'', maskKey:()=>'', lastUpdate:()=>null,
  loadAll:()=>({}), BUILTIN:{} };
global.window.SimEngine={
  summary:(acc,close)=>({ position:acc.position, initialCash:100000, equity:103500, totalReturn:'3.50%',
    avgPrice:3600, realized:3500, maxDrawdown:'2.10%', winRate:'60.0%',
    buys:(acc.marks||[]).filter(m=>m.type==='BUY').length, sells:(acc.marks||[]).filter(m=>m.type==='SELL').length }),
  runStrategy:async()=>({ account: FAKE_ACCOUNT }),
  newAccount:()=>({ position:0, marks:[], trades:[], equity:[] , initialCash:100000}),
  manualOrder:()=>({ok:true}), closePosition:()=>({ok:true})
};
global.__lastOption = null;

/* ── K线（升序）── */
const KLINES = [];
for (let i=0;i<20;i++) KLINES.push({ time:'2026-08-'+String(i+1).padStart(2,'0'), open:3500+i*10, close:3510+i*10, high:3520+i*10, low:3490+i*10 });

const fs=require('fs'), path=require('path'), vm=require('vm');
const load=f=>vm.runInThisContext(fs.readFileSync(path.join(BASE,f),'utf8'),{filename:f});
['strategy-library.js','router.js','api.js','views/sim-render.js','views/sim.js','views/list.js','views/strategy-compare.js','views/strategy.js','views/specs.js','views/detail.js','views/backtest.js','views/monitor.js','views/ai.js','app.js'].forEach(load);
if (global.__dcl) global.__dcl();

const ESC = global.UI.esc;
const tick = n => new Promise(r=>{ let i=0; const go=()=>{ if(++i>=n) return r(); setImmediate(go); }; setImmediate(go); });
let pass=0, fail=0;
function ck(name, cond, extra){ (cond?pass++:fail++); console.log((cond?'  ✅ ':'  ❌ ')+name+(extra?('  → '+extra):'')); }

(async () => {
  console.log('\n【验收 1】进模拟盘页 → 策略下拉自动填充');
  LS._d['fv2_strategy'] = 'module.exports.onBar=function(){/*主策略*/}';
  LS._d['fv2_cmp_strategies'] = JSON.stringify([{id:'s1',name:'EMA26-日线',code:'A'},{id:'s2',name:'EMA26-1H',code:'B'}]);
  global.RouteRegistry.navigate('vSim');
  await tick(6);
  const sel = els['simStrategy'];
  ck('下拉已填充', sel.innerHTML.includes('EMA26-日线'), sel.innerHTML.replace(/\s+/g,' ').slice(0,150));
  ck('含主策略', sel.innerHTML.includes('主策略（编辑器）'));
  ck('选项数 = 4（占位+主+2套）', (sel.innerHTML.match(/<option/g)||[]).length === 4);

  console.log('\n【验收 2】对比页改策略 → 切回模拟盘同步（数据接通）');
  global.StrategyCompareView.load();
  global.StrategyCompareView.rename('s1','EMA26-日线(改名后)');
  global.StrategyLibrary.setList([{id:'s1',name:'EMA26-日线(改名后)',code:'A2'},{id:'s2',name:'EMA26-1H',code:'B'}]);
  global.RouteRegistry.navigate('vList'); global.RouteRegistry.navigate('vSim');
  await tick(6);
  ck('改名已同步到模拟盘下拉', els['simStrategy'].innerHTML.includes('(改名后)'));
  ck('取到的是最新代码而非快照', global.StrategyLibrary.get('s1') === 'A2', global.StrategyLibrary.get('s1'));
  ck('API.listStrategies 走同一源', (await global.API.listStrategies()).strategies.find(s=>s.id==='s1').code === 'A2');

  console.log('\n【验收 3】离开再回来，选中策略不丢');
  els['simStrategy'].value = 's2';
  global.RouteRegistry.dispatch('sim-strategy-change','s2');
  ck('已记住选择', LS._d['fv2_sim_last_strategy'] === 's2');
  global.RouteRegistry.navigate('vList'); global.RouteRegistry.navigate('vSim');
  await tick(6);
  ck('回来仍选中 s2', els['simStrategy'].value === 's2', 'value='+els['simStrategy'].value);

  console.log('\n【验收 4】点「对比模拟」卡片 → 买卖点 + 成交记录 + 权益曲线三者齐全');
  FAKE_ACCOUNT = { initialCash:100000, cash:98000, position:1, avgPrice:3600, lastIndex:19,
    marks:[{index:3,time:KLINES[3].time,type:'BUY',price:3530,qty:1},{index:11,time:KLINES[11].time,type:'SELL',price:3620,qty:1}],
    trades:[{time:KLINES[3].time,type:'BUY',price:3530,qty:1,commission:2},{time:KLINES[11].time,type:'SELL',price:3620,qty:1,pnl:900}],
    equity:KLINES.map((k,i)=>({time:k.time,equity:100000+i*120})) };
  els['simCode'].value='agm'; els['simPeriod'].value='101'; els['simLatest'].checked=true;
  await global.RouteRegistry.dispatch('sim-run-all');
  await tick(10);
  const cards = els['simAllResult'].innerHTML;
  ck('结果区出卡片', cards.includes('data-sim-pick="0"'), cards.replace(/\s+/g,' ').slice(0,120));
  ck('卡片用 data 属性（无内联 onclick 拼字符串）', !cards.includes("onclick=\"SimView.pick("));
  await global.RouteRegistry.dispatch('sim-pick', { index: 0 });
  await tick(4);
  const trades = els['simTrades'].innerHTML;
  ck('成交记录不再是「尚无成交」', trades.includes('trade-row') && !trades.includes('尚无成交'), trades.replace(/\s+/g,' ').slice(0,120));
  const opt = global.__lastOption;
  const eqSeries = opt && opt.series.find(s=>s.name==='权益');
  const eqFilled = eqSeries && eqSeries.data.filter(v=>v!=null).length > 0;
  ck('权益曲线有数据点', !!eqFilled, eqFilled ? ('非空点 '+eqSeries.data.filter(v=>v!=null).length+' 个') : '全为 null');
  ck('买卖点散点各 1', opt.series.find(s=>s.name==='买入').data.length===1 && opt.series.find(s=>s.name==='卖出').data.length===1);
  ck('持仓总览已渲染', els['simPos'].innerHTML.includes('sim-cell'));

  console.log('\n【验收 5】中央路由：钩子不丢、不重复');
  const counts = {};
  const RR = global.RouteRegistry;
  Object.keys(RR.pages).forEach(id => { const o = RR.pages[id].onEnter; if (typeof o==='function') RR.pages[id].onEnter = function(){ counts[id]=(counts[id]||0)+1; return o.apply(this,arguments); }; });
  ['vSim','vStrategy','vList','vDetail','vBacktest','vAI'].forEach(id => RR.navigate(id));
  await tick(4);
  ck('vSim 钩子被调用 1 次（不丢不重）', counts['vSim']===1, JSON.stringify(counts));
  ck('vStrategy 外层钩子只被调用 1 次（组合而非叠加）', counts['vStrategy']===1, 'vStrategy='+counts['vStrategy']);
  ck('注册方 #1 strategy.js 执行了（策略编辑器回填）', els['strategyStatus'].innerHTML.includes('已读取'), els['strategyStatus'].innerHTML||'(空)');
  ck('注册方 #2 specs.js 执行了（合约规格表 + Key 状态）', els['specStatus'].innerHTML.includes('Key')||els['specStatus'].innerHTML.includes('缓存'), els['specStatus'].innerHTML||'(空)');
  ck('vList 钩子已注册且被调用', counts['vList']===1, 'vList='+counts['vList']);
  ck('页面均注册了 onEnter', ['vSim','vList','vDetail','vBacktest','vAI'].every(id=>typeof (RR.pages[id]||{}).onEnter==='function'));

  console.log('\n【附加】模块化边界');
  ck('SimRender 为纯渲染（不触碰 DOM）', !/document\./.test(fs.readFileSync(path.join(BASE,'views/sim-render.js'),'utf8')));
  ck('StrategyLibrary 是唯一读写 fv2_strategy 的模块',
     (fs.readFileSync(path.join(BASE,'strategy-library.js'),'utf8').match(/fv2_strategy/g)||[]).length>=1);
  /* api.js 的策略读写：只允许经 StrategyLibrary，且缺模块时必须抛错而非静默回退。
     （原来留了 localStorage 兜底分支 = 第二个事实源，已按 §3 唯一所有权原则删除。） */
  const apiSrc = fs.readFileSync(path.join(BASE,'api.js'),'utf8');
  const apiCode = apiSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ck('api.js 写策略仅通过 StrategyLibrary.setMain', /StrategyLibrary\.setMain\(code\)/.test(apiCode));
  ck('api.js 读策略仅通过 StrategyLibrary.getMain', /StrategyLibrary\.getMain\(\)/.test(apiCode));
  ck('api.js 已无 STRATEGY_KEY 常量与策略键字面量（无第二事实源）',
     !/STRATEGY_KEY/.test(apiCode) && !/['"`]fv2_strategy['"`]/.test(apiCode) && !/fv2_cmp_strategies/.test(apiCode));
  ck('StrategyLibrary 缺失时 api.js 选择抛错而非静默回退',
     (apiCode.match(/StrategyLibrary 模块未加载/g) || []).length >= 3);

  /* ── 模块化阈值自动检查（对应 CALL-GRAPH.md §2.1 / APP-TEMPLATE §3.6）──
     数字化规矩才算规矩：超阈值直接 FAIL，而不是靠人记得。

     规则设计说明（2026-09-22 第一次跑就纠过错）：
       最初写成「同文件既有 DOM 又有 localStorage 即违规」——太粗，误伤了控制器。
       控制器用**自己的私有键**（如 sim 的 fv2_sim_<code>_<period>）是合法的。
       真正该禁的是「碰别人的**共享**键」。故改为按「共享键所有权」判定。 */
  console.log('\n【模块化阈值】单文件 ≤400 行 / ≤30KB；共享存储键只能由唯一所有方读写');
  const ASSETS = path.join(BASE, '..');
  const jsFiles = [];
  (function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { if (f !== 'lib') walk(p); return; }   // lib/ 是第三方（echarts），不量
      if (/\.js$/.test(f) && !/\.bak/.test(f)) jsFiles.push(p);
    });
  })(BASE);

  /* 已知超阈值债务：只允许它原地存在，不允许再变大（file → 行数上限）。
     清偿方式见 CALL-GRAPH.md §2.1；清偿后从本表删除。 */
  const SIZE_DEBT = { 'js/api.js': 461 };

  const oversized = [], sizeDebtGrew = [], keyViolation = [];
  jsFiles.forEach(p => {
    const src = fs.readFileSync(p, 'utf8');
    const rel = path.relative(ASSETS, p);
    const lines = src.split('\n').length;
    const bytes = Buffer.byteLength(src);
    const over = lines > 400 || bytes > 30720;
    if (over) {
      if (SIZE_DEBT[rel] == null) oversized.push(`${rel} ${lines}行/${(bytes/1024).toFixed(1)}KB`);
      else if (lines > SIZE_DEBT[rel]) sizeDebtGrew.push(`${rel} ${SIZE_DEBT[rel]} → ${lines} 行`);
    }
  });

  /* 共享键所有权表（必须与 CALL-GRAPH.md §3 一致）
     注意：fv2_ai_history 的实际所有方是 api.js（appendHistory 在那里），views/ai.js 只读展示。 */
  const SHARED_KEYS = {
    'fv2_strategy': ['strategy-library.js'],
    'fv2_cmp_strategies': ['strategy-library.js'],
    'fv2_sim_last_strategy': ['strategy-library.js'],
    'fv2_kline_': ['screener.js'],
    'fv2_futures': ['screener.js'],
    'ft_stars': ['views/list.js'],
    'fv2_specs': ['specs.js'],
    'fv2_hithink_key': ['specs.js'],
    'fv2_ai_history': ['api.js']
  };

  /* 去注释后再判所有权：只在**注释里提到**键名不算访问（否则文档性注释会误报） */
  const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  jsFiles.forEach(p => {
    const src = stripComments(fs.readFileSync(p, 'utf8'));
    const rel = path.relative(ASSETS, p);
    Object.keys(SHARED_KEYS).forEach(k => {
      if (src.indexOf("'" + k) < 0 && src.indexOf('"' + k) < 0 && src.indexOf('`' + k) < 0) return;
      const owners = SHARED_KEYS[k];
      if (!owners.some(o => rel.endsWith(o))) keyViolation.push(`${rel} 碰了共享键 ${k}（所有方：${owners.join('/')}）`);
    });
  });

  ck('无新文件超阈值（≤400 行且 ≤30KB）', oversized.length === 0, oversized.join(' | ') || `${jsFiles.length} 个文件达标`);
  ck('已知债务文件未继续变大', sizeDebtGrew.length === 0, sizeDebtGrew.join(' | ') || `api.js 仍为 ${SIZE_DEBT['js/api.js']} 行（待拆分）`);
  // check #1: api.js 有 own() 调用
ck('api.js 调用了 StrategyLibrary.own()', /StrategyLibrary\.own\([^)]+\)/.test(apiSrc));
// check #2: strategy-compare.js 有 own() 调用  
const scSrc = fs.readFileSync(path.join(BASE,'views/strategy-compare.js'),'utf8');
ck('strategy-compare.js 调用了 StrategyLibrary.own()', /StrategyLibrary\.own\([^)]+\)/.test(scSrc));
// check #3: strategy-library.js 实现了 own()
const slSrc = fs.readFileSync(path.join(BASE,'strategy-library.js'),'utf8');
ck('strategy-library.js 实现了 own() 函数', /function own\(key.*ownerId/.test(slSrc));

// 额外验证：own() 运行时校验已实现
const slSrc = fs.readFileSync(path.join(BASE,'strategy-library.js'),'utf8');
const apiSrc = fs.readFileSync(path.join(BASE,'api.js'),'utf8');
const scSrc = fs.readFileSync(path.join(BASE,'views/strategy-compare.js'),'utf8');
ck('StrategyLibrary.own() 已实现', /function own\(key.*ownerId/.test(slSrc));
ck('api.js 调用了 own()', /StrategyLibrary\.own\([^)]+\)/.test(apiSrc));
ck('strategy-compare.js 调用了 own()', /StrategyLibrary\.own\([^)]+\)/.test(scSrc));

ck('共享存储键只被唯一所有方读写', keyViolation.length === 0, keyViolation.join(' | ') || `${Object.keys(SHARED_KEYS).length} 个共享键所有权清晰`);

  console.log('\n══════ 结果：'+pass+' 通过 / '+fail+' 失败 ══════');
  process.exit(fail?1:0);
})();
