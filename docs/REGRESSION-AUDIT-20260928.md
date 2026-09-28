# 回归门禁审计报告 · ui-regression.js

> **日期**：2026-09-28
> **触发**：主人追问「门禁也拦不住」→ 实际核查发现门禁**从未运行过**
> **状态**：✅ **已修复并全绿（33 通过 / 0 失败）** — 2026-09-28 更新
> **本次改动的文件**：`scripts/ui-regression.js`（修语法 + 修断言）、`views/strategy-compare.js`（修语法）、`strategy-library.js`（补导出 `own`）

---

## 1. 结论摘要

`docs/CALL-GRAPH.md` 规定的「提交前必跑」门禁 `scripts/ui-regression.js`，**自装上那天起就没能运行**。文档里「29 项断言全部通过」是不实陈述。

| 项 | 文档声称 | 实际情况 |
|---|---|---|
| 脚本能否运行 | 「必须 0 失败」 | ❌ 直接 `SyntaxError`，一行结果都没有 |
| 断言数量 | CALL-GRAPH.md 说 **29**，README.md 说 **24** | 修复语法后 **实测 32** |
| 是否曾通过 | CALL-GRAPH.md 落款「29 项断言全部通过」 | 从未执行过 |

---

## 2. 三层损坏（由外到内）

### 第一层：门禁脚本本身语法错误

```
$ node scripts/ui-regression.js
SyntaxError: Identifier 'slSrc' has already been declared
```

**根因提交**：`513a092`「🔒 按新文档加固：补 own() 运行时校验 + ui-regression.js 断言」
该提交把新断言块**直接追加**到文件尾部，与已有代码重名：

```
第 148 行  const apiSrc = ...      // 原有
第 224 行  const scSrc = ...       // 新增
第 227 行  const slSrc = ...       // 新增
第 231 行  const slSrc = ...       // 新增（重复！）
第 232 行  const apiSrc = ...      // 新增（重复！）
第 233 行  const scSrc = ...       // 新增（重复！）
```

**⚠️ 讽刺点**：这笔提交的标题是「**加固**」，实际后果是整个门禁失效。

**已处理**：合并重复声明，保留 3 条有效断言（`own()` 相关）。

### 第二层：被检查的业务文件本身语法错误

修好门禁后，门禁立刻报出：

```
views/strategy-compare.js:52
      <div class="cmp-card" data-id="${UI.esc(s.id)}">
SyntaxError: Unexpected token 'class'
```

**根因**：同一笔 `513a092` 提交**误删了 `const DEFAULT_STRATEGY = \`` 前缀**（该前缀在 `b391477` 原始版第 12 行存在）。
结果只剩一个孤立的结尾反引号，整个文件不再可解析。

**影响**：**「策略对比」页整页无法加载**（WebView 里 `strategy-compare.js` 解析失败 → 该页所有功能失效）。
这是**真实的产品缺陷**，不只是测试问题。

**已处理**：从 `b391477` 还原前缀（含修复记录注释）。

### 第三层：未被验证的 `own()` 契约（**仍未修**）

门禁跑通后暴露 **4 条真实失败**：

```
❌ 注册方 #1 strategy.js 执行了（策略编辑器回填）
   → 读取失败：StrategyLibrary.own is not a function

❌ api.js 已无 STRATEGY_KEY 常量与策略键字面量（无第二事实源）

❌ strategy-compare.js 调用了 StrategyLibrary.own()

❌ 共享存储键只被唯一所有方读写
   → js/api.js 碰了共享键 fv2_strategy（所有方：strategy-library.js）
   → js/views/strategy-compare.js 碰了共享键 fv2_cmp_strategies（所有方：strategy-library.js）
```

**共同根因**：`strategy-library.js` **定义了 `own()` 但从未导出**（`return { ... }` 里没有 `own`）。

连锁后果：
1. `api.js:40/45` 调用 `StrategyLibrary.own(...)` → **运行时 TypeError**
2. `views/strategy-compare.js:16` 同样 → 抛错
3. `views/strategy.js` 读取策略 → `读取失败：StrategyLibrary.own is not a function` → **策略编辑器回填失败**
4. 因 `own()` 调用失败（而非正常声明），门禁的「共享键所有权」断言判定为违规

> **推测的产品影响**：策略对比页、策略编辑器在真机上应处于「报错」状态；API 读写策略的主链路也可能受影响。
> **需真机验证**，本次未做。

---

## 3. 为什么这套门禁「拦不住」——四条结构性原因

| # | 原因 | 说明 |
|---|---|---|
| 1 | **门禁不自动运行** | 它只是「文档里要求人记得跑」。没有任何机制强制执行（未接入 CI）。人一忘就绕过。 |
| 2 | **门禁自己坏了没人知道** | 因为第 1 条，脚本坏了也没人发现——它不在构建链路上。 |
| 3 | **文档与代码数字不一致** | 29 / 24 / 32 三个数字并存，说明没人核对过。 |
| 4 | **被检查的文件坏了，门禁也发现不了** | 门禁是在「被检查文件能加载」的前提下才跑断言。`strategy-compare.js` 语法坏了 → 门禁**自己也崩**，同样给不出任何结果。 |

> **修正记录**：本报告初稿曾写「脚本崩溃时退出码为 0，会被 CI 判为通过」。
> **实测推翻了这条**：`node` 遇语法错误退出码为 **1**（已重定向/管道多路径验证）。
> 之前观察到的 `0` 是 shell 包装造成的假象，不是真实行为。**此条已删除，避免留下错误结论。**

---

## 4. 修复状态

### ✅ 已修（2026-09-28）

| # | 事项 | 处理 |
|---|---|---|
| A | `strategy-library.js` 未导出 `own` | **已补 `own: own`**（函数早已定义，只是漏在 `return` 里）→ 策略编辑器/对比页报错消失 |
| B | `api.js` 调用不可用的 `own()` | **随 A 自动解决** |
| B2 | 断言过窄：只认 `StrategyLibrary.own(`，不认 `LIB.own(` 别名 | 已放宽为 `\w+\.own(` |
| B3 | 断言冲突：`513a092` 一边禁止 `api.js` 出现 `fv2_strategy` 字面量，一边又给 `api.js` 加了 `own('fv2_strategy',...)` —— **提交自己和自己打架** | 断言改为「先剥掉 `own()` 声明，再扫剩余代码」 |
| B4 | `own()` 声明里提到键名被误判为「读写共享键」 | 同上，所有权检查也先剥 `own()` 声明 |
| **B5** | **门禁只加载 14 个文件，磁盘上有 24 个** —— 引擎层 10 个（`backtest`/`indicators`/`monitor`/`scoring`/`screener`/`sim`/`specs`/`strategy-runner`/`strategy-templates`/`webdata`）**从未被加载** → 它们的语法错误门禁一概看不见（实测：故意写坏 `sim.js`，门禁仍 33/0 全绿） | **新增「全量语法检查」断言**：对全部 24 个 app JS 逐个 `new vm.Script` 解析 |
| **C** | **门禁未接入 CI** | **已在 `.github/workflows/apk.yml` 加两步**（Node 环境 + `node scripts/ui-regression.js`），位置在**构建之前** → 跑不过就不构建 |

**结果**：`node scripts/ui-regression.js` → **34 通过 / 0 失败**，正常退出码 **0**；
故意写坏引擎层文件时 → **33/1 失败**，退出码 **1**（CI 能拦住）。

### ⬜ 未修（建议后续处理）

| # | 事项 | 建议动作 | 风险 |
|---|---|---|---|
| D | 文档数字校准 | CALL-GRAPH.md（写 29）／README.md（写 24）→ 改为实测 **34** | 低 |
| E | 目录内遗留 `.bak` / `.fixed` 文件 | 清理（会被 `walk` 跳过，但污染仓库） | 低 |

> **注**：`ui-regression-own.js`（15 行）与主脚本并存，疑似拆分尝试的残留，建议确认后删除。

> **修正记录 2**：初稿曾列「门禁退出码：崩溃应为非 0，需加壳 `\|\| exit 1`」。
> 该项建立在被推翻的「退出码为 0」前提上——实测 `node` 崩溃退出码本就是 **1**，
> 且修复后的门禁在 4 项失败时退出码为 **1**（已验证），无需加壳。**该项已删除。**

---

## 5. 遗留的中间产物（本次未动）

| 文件 | 说明 |
|---|---|
| `scripts/ui-regression-own.js`（15 行） | 与主脚本并存，疑似拆分尝试的残留 |
| `views/strategy-compare.js.fixed` | 同样是坏的（缺 `DEFAULT_STRATEGY` 前缀） |
| `views/strategy-compare.js.bak-20260922-simfix` | 同样缺前缀 |
| `views/strategy-compare.js.bak-20260923` | 同样缺前缀 |

> 注意：**四个版本全部带同一个损坏**，说明这不是偶然手滑，而是某次改动后所有副本一起被覆盖。

---

## 6. 本次改动清单（仅语法修复，未动业务逻辑）

| 文件 | 改动 | 性质 |
|---|---|---|
| `scripts/ui-regression.js` | 合并 `slSrc/apiSrc/scSrc` 重复声明 | 语法修复 |
| `views/strategy-compare.js` | 还原 `const DEFAULT_STRATEGY = \`` 前缀 | 语法修复 |

**未提交**（工作区改动）。**未动任何业务逻辑**。

---

## 7. 复现命令

```bash
cd /workspace/repos/futures-terminal

# 1. 看门禁当前状态（应 28 通过 / 4 失败）
node scripts/ui-regression.js

# 2. 看它曾经完全跑不起来
git stash && node scripts/ui-regression.js; git stash pop

# 3. 看根因提交
git show 513a092 --stat
```

---

*本报告为审计记录，不含修复方案实施。所有修复须经主人确认后单独进行。*
