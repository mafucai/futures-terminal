const fs = require('fs'), path = require('path');
const BASE = './app/src/main/assets/js';
function check(name, fn) { try { fn(); console.log(`✅ ${name}`); return true; } catch (e) { console.log(`❌ ${name} → ${e.message}`); return false; } }
let pass = 0, fail = 0;
function ck(n, f) { if (check(n, f)) pass++; else fail++; }

ck('api.js 调用了 StrategyLibrary.own()', 
   () => fs.readFileSync(path.join(BASE,'api.js'),'utf8').includes('StrategyLibrary.own(\'fv2_strategy\')));
ck('strategy-compare.js 调用了 StrategyLibrary.own()',
   () => fs.readFileSync(path.join(BASE,'views/strategy-compare.js'),'utf8').includes('StrategyLibrary.own(\'fv2_cmp_strategies\')));
ck('strategy-library.js 实现了 own() 函数',
   () => fs.readFileSync(path.join(BASE,'strategy-library.js'),'utf8').includes('function own(key, ownerId)'));

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
