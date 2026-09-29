# 分层审计报告 — 2026-09-29

> 触发：主人指令「把全部代码提交到 GitHub，然后**全模块检查错误**」→ 选定「**按 CALL-GRAPH 分层查**」→ 查出后指令「**检查出来的全部修**」。
> 范围：`/workspace/repos/futures-terminal`（期货 App，master 分支）
> 方法：以 `docs/CALL-GRAPH.md` 四张表（§2 模块边界 / §3 存储键 / §4 路由契约 / §6 检查清单）为判据逐项核查，**含实测验证**，不靠读代码猜。

---

## 一、审计前基线

| 项 | 结果 |
|---|---|
| `node scripts/ui-regression.js` | **34 通过 / 0 失败**，exit 0 |
| 全仓 JS 语法 | 24 个文件全部可解析 |
| 工作区 | 干净（仅 1 个未跟踪 `.bak`） |

**门禁全绿，但审计仍查出 6 类问题** —— 印证 CALL-GRAPH 自身立场：「只有『谁调用谁』不够」，也印证教训 R2：**静态全绿 ≠ 无缺陷**。

---

## 二、查出并修复的问题（6 类）

### P0-1 内联事件属性注入（实测确认）

**位置**：`views/list.js`（收藏栏）、`views/strategy-compare.js`（对比卡片）共 4 处。

**问题**：动态值直接拼进 `onclick`：
```js
`<span onclick="ListView.toggleStar('${UI.esc(code)}')">`
```

**关键判断（我最初判断错了）**：原以为 `UI.esc()` 转义了引号所以安全。
**实测推翻**：

```
输入: FC');alert(1);//
生成: onclick="ListView.toggleStar('FC&#39;);alert(1);//')"
浏览器解码 HTML 实体后: ListView.toggleStar('FC');alert(1);//')
→ ⚠️ alert(1) 可执行
```

**根因**：`onclick` 是 **HTML 属性**，浏览器**先解码 HTML 实体**（`&#39;` → `'`）再当 JS 执行。
**HTML 转义 ≠ JS 转义** —— 两个不同上下文，用 HTML 转义防 JS 注入是无效的。

**修复**：改为 `data-*` + 容器事件委托（CALL-GRAPH §4.3 原本就要求的做法）。

### P1-2 api.js 455 行超 §2.1 阈值

阈值：单文件 >400 行须按职责拆。`api.js` 455 行，且被门禁以「已知债务」豁免。

**修复**：抽 `js/ai-core.js`（`aiCall` / `buildAiPrompt` / `extractJson` / `validateResult`，纯逻辑、不碰存储键）。
`appendHistory`（读写 `fv2_ai_history`）**留在 api.js** —— 保持「一个键一个读写方」。
**结果**：api.js 455 → 370 行。

### P1-3 两个函数超 §2.1 的 60 行阈值

| 函数 | 原 | 现 | 拆法 |
|---|---|---|---|
| `views/strategy-compare.js` `run()` | 87 行 | 44 行 | 抽 `computeBest()` / `renderRows()` / `rankOverall()`（纯函数，可单测） |
| `sim.js` `runStrategy()` | 82 行 | 34 行 | 抽 `resolveEndIndex()` / `advanceOneBar()` |

### P1-4 §3 存储键表缺 4 个键

§3 表列 7 行，实际代码有 14 个键。**4 个键代码在用、表里没有**：

| 键 | 实际所有方 |
|---|---|
| `fv2_last_update` | `api.js` |
| `fv2_last_full_update` | `api.js` |
| `fv2_specs_at` | `specs.js` |
| `ft_ai_cfg` | `views/ai.js` |

**危害**：「一个键只能有一个读写方」这条规则**对它们完全失效**（查不到 = 不设防）。

**修复**：补进 §3 表 + `scripts/ui-regression.js` 的 `SHARED_KEYS`（两处一致）。

### P1-5 门禁手写加载清单（本次险些造成回归）

门禁原按**手写数组**加载被测文件：
```js
['strategy-library.js','router.js','api.js',...].forEach(load);
```

**本次暴露的危害**：我拆出 `ai-core.js` 后，手写清单**不含它** → `api.js` 抛错 → 门禁崩。
（手写清单原本还漏了 `screener.js` 等引擎文件。）

**修复**：改为**从 `index.html` 动态取加载顺序**（顺序即事实源）。
过程中发现真实 `screener.js` / `sim.js` 会覆盖门禁的桩 → 在**消费方（`views/sim.js`）加载前一刻**重装桩，并加注释说明为何必须在那个时机。

### P2-6 孤儿文件 `js/monitor.js`（新断言查出）

83 行，`window.FuturesMonitor` **全仓零引用**。实时监控实际由 `views/monitor.js` 走 `API.monitorStart/quote` 实现。
**属移植遗留死代码。**

**处置**：**不擅自删除**（删文件不可逆）。加入门禁 `KNOWN_ORPHANS` 白名单并标注「待主人处置」。

---

## 三、断言变化：34 → 39 项

新增 5 组，把本次问题固化为可回归检查：

| 新增断言 | 防的是什么 |
|---|---|
| 无内联事件属性里拼接动态值 | P0-1 注入（含 `UI.esc` 无效这一认知陷阱） |
| 无函数超 60 行 | P1-3 |
| index.html 列出的脚本全部存在 | P1-5 |
| 无磁盘孤儿脚本 | P2-6 |
| 渲染层/数据层/引擎层无 `document.` | §2 分层边界（此前只查 `sim-render.js`，现覆盖 3 个纯层文件） |

另：清空失效的 `SIZE_DEBT = { 'js/api.js': 461 }`（已清偿），断言文案不再硬编码行数。

---

## 四、最终验证

```
node scripts/ui-regression.js
══════ 结果：39 通过 / 0 失败 ══════
退出码：0
```

| 项 | 修复前 | 修复后 |
|---|---|---|
| 断言 | 34 通过 / 0 失败 | **39 通过 / 0 失败** |
| `api.js` | 455 行 | **370 行** |
| 超 60 行函数 | 2 个 | **0 个** |
| §3 表覆盖键 | 7 | **11 行（14 个键）** |
| 内联事件拼接 | 4 处 | **0 处** |
| 孤儿文件 | 1（未记录） | 1（**已记录待处置**） |

---

## 五、遗留（需主人决策）

1. **`js/monitor.js` 删不删？** 83 行死代码，删文件不可逆，故未擅动。
2. **`app/src/main/assets/js/` 下 6 个 `.bak` 文件** —— 污染源码目录，不参与运行。建议清理（`.gitignore` 已可覆盖，但需确认）。
3. **`docs/AUTOMATION-DESIGN.md.bak-20260928`** —— 未跟踪文件，工作区剩余项。

---

## 六、方法备注（写给下一个 AI）

1. **`UI.esc()` 不防 `onclick` 注入。** 这是本次最贵的一课：HTML 属性先解码实体再执行 JS。任何「转义了就安全」的判断都必须实测验证。
2. **门禁手写清单会静默失效。** 清单从事实源（`index.html`）动态取，并明写「桩必须在消费方加载前装」的原因 —— 否则下一个人会把它改回去。
3. **桩覆盖顺序是隐式契约。** 真实 `screener.js`/`sim.js` 自建 `window.X` 会覆盖桩；门禁以前靠「故意不加载」回避，这是脆弱约定，现改为显式重装 + 注释。
4. **不擅自删文件。** 孤儿代码记入白名单并报告，交主人决定。

---

*创建：2026-09-29 ｜ 依据：主人「按 CALL-GRAPH 分层查错 + 全部修」指令 ｜ 回归：`node scripts/ui-regression.js` **39 通过 / 0 失败***
