# 调用蓝图（CALL-GRAPH）— futures-terminal

> **主人钦定（2026-09-22）**：App **设计之初**就必须写这份调用蓝图，不能等出了 bug 再返工。
> 立这份文档的直接触发事件：模拟盘「策略」下拉永远为空 → 跑不了任何策略 → 归因为「策略未接通」，
> 根因却是中央路由的**注册覆盖**（详见 §5）。这类 bug 靠读单个文件看不出来，**只有蓝图能提前暴露**。
>
> 状态：生效中 ｜ 配套可执行自检：`scripts/ui-regression.js`（29 项断言，`node scripts/ui-regression.js`）

---

## 1. 蓝图要解决什么

| 只有「谁调用谁」不够 | 蓝图必须额外回答 |
|---|---|
| 模块 A 调用模块 B | **谁先加载**、**谁能覆盖谁**、**谁是唯一事实源**、**跨页数据从哪同步** |

本项目曾经的漏洞链：`registerPage` 是覆盖语义 + `app.js` 最后执行 + 视图导出对象不一定带 `onEnter`
→ 三条单独看都正常，凑一起才致命。**任何一份「只画调用关系」的文档都抓不到它。**

---

## 2. 模块清单与职责边界

| 文件 | 层 | 职责 | 禁止事项 |
|---|---|---|---|
| `js/router.js` | 基建 | 中央路由：`register` / `dispatch` / `registerPage` / `navigate` | 不得夹带业务逻辑 |
| `js/app.js` | 入口 | UI 工具、时钟、返回键、首次导航 | **禁止再统一 registerPage**（历史上的覆盖源） |
| `js/api.js` | 适配 | 界面统一走 `API.xxx()`；本地实现 | 不得自建存储键 |
| `js/strategy-library.js` | **数据（唯一事实源）** | 策略读写 + 变更广播 | 不得碰 DOM |
| `js/sim.js` | 引擎 | 模拟盘账户/下单/止损/汇总 | 不得碰 DOM |
| `js/views/sim-render.js` | 渲染 | 数据 → HTML / ECharts option | **不得碰 DOM、不得改状态** |
| `js/views/sim.js` | 控制器 | 模拟盘状态 + DOM + 事件注册 | 不得直接读写 localStorage 业务键 |

> 分层原则：**基建 → 数据 → 引擎 → 渲染 → 控制器**，依赖只能向下，不得回环。

### 2.1 模块化阈值（硬数字，超了就拆）

| 信号 | 阈值 | 处置 |
|---|---|---|
| 单文件行数 | **> 400 行** | 按「职责」拆，不按「行数」平均切 |
| 单文件字节 | **> 30 KB** | 同上 |
| 单函数行数 | **> 60 行** | 抽子函数或抽模块 |
| **渲染层**文件出现 `document.` | **必须为 0** | 渲染层是纯函数，碰 DOM 即违规 |
| **控制器**文件使用自己的私有存储键 | 允许 | 私有键（如 `fv2_sim_<code>_<period>`）归控制器所有 |
| 任一文件读写**共享键**（§3 表里的键） | **只能由该键的唯一所有方读写** | 出现即缺陷，收敛到事实源模块（见 §3） |

> ⚠️ 这两条是踩过坑改出来的：最初写成「同文件既有 DOM 又有 localStorage 即违规」——太粗，
> 会误伤合法控制器（它本来就要 DOM + 自己的私有键）。**判据必须是「有没有碰别人的共享键」，不是「有没有碰 localStorage」。**
> 判据的实现见 `scripts/ui-regression.js` 的 `SHARED_KEYS` 表，两边必须保持一致。

本文件 §2 表格里的「禁止事项」列就是这套阈值的落地形态：**渲染层禁止碰 DOM、数据层禁止碰 DOM、控制器禁止直接读写存储键。**

### 2.2 拆分方法（本项目实操，照抄即可）

模拟盘从 1 个 369 行文件（403 行）拆为 3 层，**每一层都能单独验证**：

| 拆分动作 | 拆出什么 | 怎么验证 |
|---|---|---|
| 数据层 | `strategy-library.js`（策略读写 + 变更广播） | 桩里直接调 `all()/get()/setList()`，不涉 DOM |
| 渲染层 | `views/sim-render.js`（纯函数：数据 → HTML / option） | 断言「源码里不含 `document.`」即可证明纯度 |
| 控制器 | `views/sim.js`（状态 + DOM + 事件注册） | 桩里 `navigate('vSim')` 后断言关键控件非空 |

**拆分收益**：本次 6 个缺陷里，①③④⑤ 全部落在「控制器与数据混住」的区域；拆开后，渲染改动不可能碰坏策略链路。

### 2.3 反模式清单（本项目真实踩过）

| 反模式 | 为什么坏 | 正确做法 |
|---|---|---|
| 入口文件统一 `registerPage` 全部页面 | 覆盖语义吞掉视图自己的钩子 | 谁拥有页面谁注册（§4.1） |
| 动态 HTML 拼 `onclick="Fn('名字')"` | 名字含引号直接炸页面 | `data-*` 属性 + 容器事件委托（§4.3） |
| 多处各自解析同一个 localStorage 键 | 改了 A 处 B 处不知道 → 「数据未接通」 | 唯一事实源模块 + 变更广播（§3） |
| 渲染函数里顺手改状态 | 无法单独验证渲染 | 渲染只返回字符串/对象，改状态留在控制器 |


---

## 3. 存储键唯一事实源表

| 键 | 含义 | 唯一读写方 | 其他模块 |
|---|---|---|---|
| `fv2_strategy` | 主策略文本 | `strategy-library.js` | 只经 `StrategyLibrary.get/setMain` |
| `fv2_cmp_strategies` | 对比页 N 套策略 | `strategy-library.js` | 只经 `getList/setList` |
| `fv2_sim_last_strategy` | 模拟盘上次选用 | `strategy-library.js` | 只经 `lastId/remember` |
| `fv2_sim_<code>_<period>` | 模拟盘账户快照 | `views/sim.js` | 私有，外部不读 |
| `fv2_kline_*` / `fv2_futures` | 行情缓存 | `screener.js` Store | 只经 `Screener.readKlineCache` |
| `ft_stars` | 收藏 | `views/list.js` | 私有 |
| `fv2_specs*` / `fv2_hithink_key` | 合约规格 / Key | `specs.js` | 只经 `Specs.*` |

**规则**：一个键只能有一个读写方，第二处出现即视为缺陷。

---

## 4. 中央路由契约（本项目的核心接口）

### 4.1 注册语义 = **组合**，不是覆盖

```js
// js/router.js（2026-09-22 修复后）
function registerPage(name, opts) {
  const prev = pages[name] || {};
  const next = Object.assign({}, prev, opts || {});
  const a = prev.onEnter, b = (opts || {}).onEnter;
  if (typeof a === 'function' && typeof b === 'function' && a !== b) {
    next.onEnter = function () {
      // 隔离：一个注册方抛错不得阻断其余注册方
      try { a.call(this); } catch (e) { console.error('...', e); }
      try { b.call(this); } catch (e) { console.error('...', e); }
    };
  } else if (typeof a === 'function' && typeof b !== 'function') {
    next.onEnter = a;
  }
  pages[name] = next;
}
```

与技能 `route-registry` 一致：**禁止覆写，改为注册**。

### 4.2 页面 → 注册方 → 进入动作

| 页面 | 注册方 | 进入动作 |
|---|---|---|
| `vList` 行情 | `views/list.js` | `loadStars()` |
| `vDetail` K线 | `views/detail.js` | 图表 `resize()` |
| `vStrategy` 策略 | `views/strategy.js` | 回填编辑器 + 刷新对比卡片 |
| ↳ 同页第二注册方 | `views/specs.js` | 渲染合约规格表 + Key 状态 |
| `vBacktest` 回测 | `views/backtest.js` | 权益曲线 `resize()` |
| `vSim` 模拟盘 | `views/sim.js` | **载入策略列表** + 带合约/周期 + 规格提示 + 结果区事件委托 |
| `vMonitor` 监控 | `views/monitor.js` | 无 |
| `vAI` AI | `views/ai.js` | `hydrateConfig()` |

> ⚠️ 任何新增视图**必须**自己 `registerPage('vX', { onEnter })`，且 `vX` 必须在 `index.html` 存在对应 `<section class="view" id="vX">`。
>
> **铁律：`AppView` 对象不得导出名为 `onEnter` 的键**（历史上 `app.js` 靠这个键反射调用，正是覆盖 bug 的成因之一）。动作请放中央路由或具名方法。

### 4.3 事件表（模拟盘，全部走中央路由）

| 事件 | 触发点 | 处理 |
|---|---|---|
| `sim-run` | 「▶ 按策略执行」 | 按选中策略逐根推演 |
| `sim-run-all` | 「▶ 对比模拟（全部策略）」 | 所有策略各跑一遍，出卡片 |
| `sim-pick` | 结果区卡片点击（**事件委托**，payload `{index}`） | 画买卖点+成交+权益 |
| `sim-buy` / `sim-sell` | 「▲ 买入」「▼ 卖出」 | 手动下单 |
| `sim-close` | 「平仓」 | 全平 |
| `sim-reset` | 「↺ 重置模拟盘」 | 资金回初始 |
| `sim-refresh-strategies` | 「⟳ 刷新策略」 | 重载下拉 |
| `sim-strategy-change` | 下拉 `onchange`（payload `id`） | 记住选择 + 回显 |
| `sim-code-change` | 合约输入 `onchange` | 刷新合约规格提示 |

**内联 `onclick` 只允许写 `RouteRegistry.dispatch(...)`，不得写业务表达式。**
动态生成的 HTML 用 `data-*` + 事件委托，禁止拼 `onclick="SimView.pick('名字')"`（名称含引号会直接炸页面）。

---

## 5. 已修缺陷台账（设计期缺失的代价）

| # | 现象 | 根因 | 修复 | 回归断言 |
|---|---|---|---|---|
| 1 | 模拟盘策略下拉永远为空 → 报「请选择要执行的策略」 | `app.js` 在 DOMContentLoaded 里对 7 页统一 `registerPage`，**整体覆盖**视图自己的 `onEnter` | `registerPage` 改组合语义 + 删除 `app.js` 覆盖源 | 验收 1、5 |
| 2 | 详情/回测/AI 页图表 resize、配置回填静默失效 | 同 #1 | 同 #1 | 验收 5 |
| 3 | 点对比卡片 → 「成交记录」永远「尚无成交」、权益虚线不出现 | `runAll` 只把 `marks` 塞进结果，`trades/equity/cash` 被丢弃 | 整账户 `account` 一并传递 | 验收 4 |
| 4 | 对比页改了策略，模拟盘仍用旧文本 | 模拟盘读 `sel._map` 快照 | 改为每次经 `StrategyLibrary.get(id)` 现取 | 验收 2 |
| 5 | 切页回来，选中的策略丢失 | 下拉每次重填都清空 | 记忆 `fv2_sim_last_strategy` 并回填 | 验收 3 |
| 6 | 一处异常拖垮同页其他注册方 | 组合钩子未隔离 | 每个注册方各包 `try/catch` | 验收 5 |

---

## 6. 改代码 / 审代码的检查清单

**新增或修改视图时：**
1. `index.html` 有对应 `<section id="vX">` 吗？脚本按「依赖在前」顺序引入了吗？
2. 自己 `registerPage('vX', {onEnter})` 了吗？导出对象里**没有** `onEnter` 键吧？
3. 页内交互是否全部走 `RouteRegistry.dispatch`？动态 HTML 是否用 `data-*` + 委托？
4. 用到的存储键在 §3 表里有唯一读写方吗？自己有没有偷偷新建第二个读写点？

**提交前必跑：**
```bash
node scripts/ui-regression.js      # 29 项断言，必须 0 失败
node --check app/src/main/assets/js/views/sim.js   # 逐个改动文件
```

---

## 7. 与全局规范的关系

| 文档 | 关系 |
|---|---|
| `/workspace/repos/Coomi/docs/APP-TEMPLATE-GITHUB-ACTIONS.md` | 全局 App 模板；本蓝图是其「设计期必备产物」要求在金融项目的实例 |
| `docs/ANDROID_SIGNING.md` | 签名资产（构建前必读） |
| `docs/DOCS_INDEX.md` | 本文档已登记 |

---

*创建：2026-09-22 ｜ 依据：模拟盘策略链路缺陷复盘 ｜ 回归：`scripts/ui-regression.js` **29 项断言全部通过**（含中央路由、策略链路、模块化阈值三组）*
