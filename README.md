# futures-terminal — 期货终端

> Android 手机本地运行的**期货行情 + 策略筛选 + 回测**工具。纯本地，策略不上传。
> 架构：**WebView + 原生桥**（零第三方依赖、完全离线）
> 编译：GitHub Actions 云端（`.github/workflows/apk.yml`，推 `master` 触发）
> 应用 ID：`com.mafucai.futuresterminal`
> 固定签名：已启用；任何 AI 修改构建前必须先读 [`docs/ANDROID_SIGNING.md`](docs/ANDROID_SIGNING.md)，禁止重新生成签名替换现有密钥。

---

## 1. 核心原则

- **纯本地** —— 无后端服务器，无 `/api/*`；数据直接经原生桥取
- **零第三方依赖** —— `app/build.gradle` 的 `dependencies {}` 为空
- **完全离线** —— 图表库本地内置，无任何 CDN 引用
- **中央路由（RouteRegistry）** —— 所有事件统一调度
- **模块化** —— 每个模块独立文件
- **策略文件永不联网**
- **改文件前必须备份**

---

## 2. 已完成功能

| 功能 | 状态 | 说明 |
|---|---|---|
| 期货行情列表 | ✅ | 全市场合约，搜索/收藏/缓存 |
| K线详情页 | ✅ | 日线/4H/60分/30分/15分 |
| 技术指标 | ✅ | MA/EMA/MACD/RSI/KDJ/BOLL/ATR |
| **5 信号加权评分** | ✅ | **EMA30+MACD25+RSI20+KDJ15+ATR10，完全可解释** |
| 策略编辑器 | ✅ | 在线编辑，`module.exports.onBar` 契约 |
| 策略筛选 | ✅ | 全合约扫描，可只看主连/多周期 |
| **策略对比（＋号，N 套）** | ✅ | 一处点「＋」可无限添加策略，对比回测并标出每项最优 |
| 回测引擎 | ✅ | 单周期 + 多周期（4H+1H），含收益曲线 |
| **模拟期货盘** | ✅ | 手动买/卖/平仓 + 按策略执行；选日期或最新；K线标注买卖点 + 权益曲线 |
| **手动拉取 / 增量更新** | ✅ | 不自动联网；所有拉取手动触发，只补新K线、旧数据不删不动 |
| 实时监控 | ✅ | 定时轮询 + 命中日志 |
| **AI 二轮分析** | ✅ | OpenAI 兼容接口；Key 仅存本机 + 脱敏 |
| 数据时间戳 | ✅ | 行情/K线显示数据时间，过期提醒 |
| 数据源降级 | ✅ | 新浪双域名自动降级 |

---

## 3. 编译与安装

**不本地编译**——推送到 GitHub 后由 Actions 自动构建：

```bash
git push origin master      # 触发 .github/workflows/apk.yml
```

构建完成后在仓库 **Releases** 下载 APK，手机上直接安装。
（也可在 Actions 页面用 `workflow_dispatch` 手动触发。）

---

## 4. 项目结构

```
futures-terminal/
├── app/src/main/
│   ├── assets/                    ← 前端（纯静态，离线运行）
│   │   ├── index.html             ← 6 标签 + 7 视图
│   │   ├── css/style.css          ← 自研设计系统
│   │   └── js/
│   │       ├── router.js          ← 中央路由（RouteRegistry）
│   │       ├── api.js             ← 本地适配层（无需后端）
│   │       ├── app.js             ← 入口 + UI 工具
│   │       ├── scoring.js         ← 5 信号加权评分
│   │       ├── webdata.js         ← 数据源（新浪/东财，经原生桥）
│   │       ├── indicators.js      ← 技术指标
│   │       ├── strategy-runner.js ← 策略引擎
│   │       ├── screener.js        ← 策略筛选（含增量合并 mergeKline）
│   │       ├── backtest.js        ← 回测引擎
│   │       ├── sim.js            ← 模拟盘引擎（策略执行 + 手动下单）
│   │       ├── monitor.js         ← 监控模块
│   │       ├── lib/echarts.min.js ← 图表（本地，无 CDN）
│   │       └── views/             ← list / detail / strategy / strategy-compare / backtest / sim / monitor / ai
│   ├── java/com/mafucai/futuresterminal/
│   │   └── MainActivity.java      ← WebView 壳 + 原生桥
│   ├── res/                       ← 图标 / 主题 / 字符串
│   └── AndroidManifest.xml
├── docs/
│   ├── HANDOFF.md                 ← 完整交接文档
│   ├── DOCS_INDEX.md              ← 文档索引
│   └── HITHINK-FUYAO.md           ← 同花顺数据对接（合约乘数）
└── .github/workflows/apk.yml      ← APK 云端构建
```

---

## 5. 原生桥（JS ↔ Android）

`MainActivity` 暴露 `window.Android.*`，前端借它绕过 CORS 并处理 GBK：

| 方法 | 用途 |
|---|---|
| `httpGet(url, ua, referer)` | GET，UTF-8 |
| `httpGetGbk(url, ua, referer)` | GET，GBK（新浪行情） |
| `httpGetWithHeaders(url, ua, referer, charset)` | GET，自定义 |
| **`httpPost(url, body, headersJson)`** | **POST（AI 调用用，支持 JSON body + 自定义头）** |

失败一律返回 `__ERR__` 前缀字符串，**不抛异常到 JS**。

---

## 6. 数据源（关键结论）

### ✅ 可用
| 数据源 | 域名 | 日K | 分钟K | 合约规格* |
|---|---|---|---|---|
| **新浪主源** | `stock2.finance.sina.com.cn` | ✅ | ✅ | ❌ |
| **新浪备用** | `stock.finance.sina.com.cn` | ✅ | ✅ | ❌ |
| 东财行情列表 | `push2.eastmoney.com` | - | - | ❌ |
| **同花顺 fuyao** | `fuyao.aicubes.cn` | ✅ | ❌ | ✅ |

> \* 合约规格 = **合约乘数 / 保证金率 / 手续费 / 最小变动价位**。
> **新浪没有这些字段**（实测确认），由**同花顺**提供（需 API Key，免费注册）。详见 [`docs/HITHINK-FUYAO.md`](docs/HITHINK-FUYAO.md)。

### ❌ 不可用
东财 push2his（被封）、腾讯（接口改版）、网易（502）、雪球（需登录）、百度（仅 agm）、通达信 TCP（协议未调通）

> 📌 **修正历史结论**：早期记录「同花顺 404」是**旧版股票接口**的判断，**已过时**。
> 同花顺官方新服务 `fuyao.aicubes.cn` **可用**，且是**唯一提供期货合约乘数的来源**。

### 🚀 重大发现
**新浪 K 线不封 IP** —— 965 合约 17 秒拉完 811 个（84%），无限速。

**两个已修复的 Bug**：
1. **郑商所代码转换**：`sa609` → `sa2609`（**3 位补 2**）
2. **新浪返回判断**：先判 `var _x=` + `"d":` 再解析

---

## 7. 5 信号加权评分（可解释）

**权重（用户钦定）**：`EMA 30 + MACD 25 + RSI 20 + KDJ 15 + ATR 10 = 100`

每条规则输出四要素，便于复核：

```
ema   w=30 分= 67.8 贡献=20.3 ✓ 价 > EMA26（偏离 +0.99%）
macd  w=25 分=   72 贡献=  18 ✓ DIF > DEA（金叉，柱收缩）
rsi   w=20 分=   60 贡献=  12 ✓ RSI14=100.0（超买）
kdj   w=15 分=   57 贡献= 8.6 ✓ K > D（金叉）
atr   w=10 分=   40 贡献=   4 ✗ ATR14=17.0（占价 0.23%，波动偏小）
```

`weight` 权重 · `score` 该项得分 · `contribution` 对总分净贡献 · `hit` 是否命中 · `detail` 说明

> ⚠️ 输出是「**信号强度评分**」，**不是涨跌预测，不构成投资建议**。

---

## 8. AI 二轮分析

- **配置**：API Base URL / API Key / 模型 / Top N
- **拉模型**：`POST {baseUrl}/models`（同时充当连接测试）
- **分析**：`POST {baseUrl}/chat/completions`
- **候选只来自第一轮筛选** —— AI 不得凭空选标的
- **失败降级**：AI 不可用时保留第一轮结果，不阻断原功能
- **安全**：Key 仅存本机（`localStorage`），UI/日志全程脱敏（只显后 4 位）
- **Schema 校验**：AI 返回的编造标的会被剔除；缺数据的候选标记「无法判断」

---

## 9. EMA26 多周期策略（示例）

`strategies/my_strategy.js` 提供示例；契约：

```js
module.exports.onBar = function (kline, ctx) {
  // 返回 { type, reason } 表示信号；返回 null 表示无信号
  return null;
};
```

**参考逻辑**：
- **4H 定方向**：收盘价 > EMA26(4H) 只做多，< 只做空
- **1H 找入场**：上穿/下穿 EMA26(1H) + ATR 安全距离 + 连续3根确认 + 阳/阴线
- **减仓**：1H 跌破/突破 EMA26 减 1/3；**清仓**：4H 跌破/突破 EMA26 清仓
- **仓位**：2% 风险预算 / 止损距离 × 10，最多 3 手

---

## 9b. 手动拉取 / 增量更新（v2.1.0 起）

**原则：App 不会自动联网。** 一切联网都必须手动点按钮：

| 入口 | 位置 | 行为 |
|---|---|---|
| 📂 载入行情(缓存优先) | 行情页 | 有缓存直接读；没有才联网拉一次 |
| ⟳ 刷新行情(全量) | 行情页 | 联网刷新全市场合约列表（快照） |
| ⤓ 增量更新 | 行情页 | 对指定合约×周期**只补新K线**，旧数据保留 |
| ⤓ 拉取全部合约 | 行情页 | 一键对本地全部主连（或全部）做增量更新，带进度条与耗时 |
| ⤓ 拉取K线(增量) | K线详情页 | 单合约单周期增量合并 |

**增量合并（`Screener.mergeKline`）语义**：
1. 以 `time` 为唯一键；旧缓存已有的时间点一律保留，**不删除**；
2. 只有时间 > 缓存最后一根K线的，才算新数据，追加；
3. 相同时间点仅当是「最后一根」且数值变化时覆盖（未收盘K线刷新）；更早的历史永不改动；
4. 幂等：重复拉取同一批数据不会重复追加。

## 9c. 策略对比（＋号，可放 N 套）

策略页底部「＋ 添加一套策略」，点一次多一套，**没有上限**。填入同一合约/周期后点
「▶ 对比回测」，输出每套的总收益/胜率/最大回撤/盈亏比/夏普，并**标出每项谁更好**，
最后给出一句话综合排序（收益 − 0.5×回撤 + 0.05×胜率）。策略列表存
`localStorage['fv2_cmp_strategies']`，模拟盘可直接选用。

## 9d. 模拟期货盘

- **策略执行**：选合约/周期/策略/手数，选日期或「用最新日期」，逐根推演，生成买卖点。
- **多套策略**：下拉可选「主策略」+ 所有「＋」号策略；点「▶ 对比模拟（全部策略）」一次跑完并列出收益/买卖次/胜率/回撤，🏆 标出最优。
- **手动下单**：▲买入 / ▼卖出 / 平仓，在当前最新K线上成交。
- **K线标注**：主图用 ▲红=买入、▼绿=卖出 明显标出，叠加虚线权益曲线（右轴）。
- 账户按 `合约_周期` 持久化在 `localStorage['fv2_sim_<code>_<period>']`。
- 数据全部来自本地缓存（不联网）。

## 9e. 策略必须是 JavaScript（不是 Python）

本 App 的策略引擎在浏览器沙箱里用 `new Function` 执行，**只能跑 JavaScript**。
若粘贴 Python（`import pandas`、`def ema(...)`、`@dataclass` 等），会报
「策略语法错误: Invalid or unexpected token」——这是**语言不对**，不是 App 的 bug。

正确写法（策略契约）：

```js
module.exports.onBar = function (kline, ctx) {
  // kline: 当前K线 {time,open,high,low,close,volume,period?}
  // ctx.history: 截止当前的K线数组；ctx.position: 当前持仓（回测/模拟时）
  // 返回 { type:'BUY'|'SELL', reason } 表示信号；返回 null 表示无信号
  return null;
};
```

策略页顶部有 **「📄 载入示例(多周期)」/「📄 示例(单周期)」** 两个按钮，一键把可运行的
JS 示例填进编辑器（多周期示例即 4H EMA26 定方向 + 1H EMA26 入场 + ATR 过滤 + 前3根确认 + 阴阳线）。

## 9f. 合约规格数据（同花顺 · 合约乘数）

策略算手数/成本需要 **合约乘数、保证金率、手续费**——**新浪没有这些字段**（实测确认）。
来源改为 **同花顺 fuyao**（免费注册 API Key）：

```
GET https://fuyao.aicubes.cn/api/futures/varieties/list
Header: X-api-key: <KEY>     # 仅存本机 localStorage['fv2_hithink_key']
```

实测返回 **91 个品种**，每项含 `contract_multiplier`（乘数）、`margin_rate`（保证金）、
`transaction_fee`/`transaction_fee_rate`（手续费，两种计法）、`tick_size`、`has_night_session`。

**数据分工**：合约规格 ← 同花顺；4H/1H 分钟K ← 新浪（同花顺**不提供分钟K**）。
完整接口契约 + 安全约定见 [`docs/HITHINK-FUYAO.md`](docs/HITHINK-FUYAO.md)。

**安全**：API Key 只存本机 `localStorage`，界面/日志脱敏，**绝不写入代码或提交到 Git**。

## 9g. 引擎能力（v2.2.0 忠实还原版）

策略信号契约扩展（sim.js 与 backtest.js **同一套口径**）：

| 信号 | 含义 |
|---|---|
| `{type:'BUY'/'SELL', size?, reason?}` | 开多/开空（持反向仓先平后反手） |
| `{type:'REDUCE', ratio?}` | **按比例减仓**（默认 1/3），保留剩余仓位 |
| `{type:'CLOSE', reason?}` | 全部平仓 |

策略可写 `ctx` 上的额外字段：

| 字段 | 作用 |
|---|---|
| `ctx.stopLoss = 价格` | **硬止损**：引擎在下一根K线的 `high/low` 判定；**跳空按开盘价认亏** |
| `ctx.state = {}` | 跨K线持久状态（连亏计数 / 暂停方向），策略自管理 |
| `ctx.spec` | 该合约规格 `{multiplier, marginRate, fee, feeRate, tickSize}` |
| `ctx.lastExit` | 引擎写入的最近一次平仓 `{reason, pnl}`，便于实现「连亏3次暂停」 |

**成本模型**：手续费 = `fee×手数`（固定元/手） + `成交额×feeRate`（比例），两种可同时。
**手数**：勾选「风险模式」时 = `资金 × 0.5% ÷（止损距离 × 合约乘数）`，否则用固定手数。

策略页「📄 载入修正版(推荐)」= 忠实还原的 EMA26 修正版（4H方向 + 1H入场 + ATR过滤 +
前3根确认 + 阴阳线 + 硬止损 + 减1/3 + 清仓 + 连亏3次暂停）。

## 10. 关键坑

1. **WebView 缓存旧 JS** —— 前端 JS 加版本号 `?v=N`，改代码后必须更新
2. **新浪双域名降级** —— 主源失败自动切备用
3. **筛选默认只读缓存** —— 需实时传 `liveFetch=true`
4. **新契约**：策略须导出 `onBar`（旧版 `module.exports = function` 会报「策略必须导出 onBar 函数」）
5. **无后端** —— 所有 `/api/*` 调用走 `assets/js/api.js` 的本地适配层

---

## 11. 版本历史

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0.0 | 2026-08-10 | 第一个完整版（Node 后端 + 浏览器前端） |
| v1.0.3 | 2026-08-11 | 刷新清缓存 + 双域名降级 + 预取接口 |
| v1.0.4 | 2026-08-11 | **重大突破**：新浪不封 IP + 郑商所代码修复 |
| v1.0.5 | 2026-08-11 | **增量更新**：update-kline.js（58秒） |
| **v2.0.0** | **2026-09-16** | **架构改为纯前端 App**：界面重做 + 5 信号评分 + AI 二轮分析 + 原生桥 `httpPost` |
| **v2.1.0** | **2026-09-16** | **全部改为手动拉取**（不再自动联网）+ **增量合并**（`mergeKline`，旧数据不删不动）+ **策略对比（＋号，N 套）** + **模拟期货盘**（策略执行/手动买卖、选日期或最新、K线标注买卖点） |
| **v2.1.1** | **2026-09-16** | 一键**拉取全部合约**（进度条+耗时）+ 模拟盘**对比模拟（全部 ＋ 策略）**+ 识别 **Python 策略并给出清晰报错** + 内置 **JS 示例策略**（载入即可跑） |
| **v2.2.0** | **2026-09-17** | **引擎三项能力**（按比例减仓 REDUCE / 盘中硬止损·跳空认亏 / ctx.state 连亏暂停）+ **接入同花顺合约规格**（乘数/保证金/手续费，Key 仅存本机）+ **成本双计法** + **风险模式手数** + **修正版策略（忠实还原）一键载入** |
| **v2.3.0** | **2026-09-20** | 行情页拆分**全部历史覆盖 / 全部增量合并 / 指定合约增量**；默认仅主连、默认日线；历史上限为日线 1000、4H/60分各 500；缓存写满时明确报错，禁止假成功。 |

---

## 12. 文档

| 文档 | 路径 |
|---|---|
| 完整交接文档 | `docs/HANDOFF.md` |
| 文档索引 | `docs/DOCS_INDEX.md` |
| **同花顺数据对接（合约乘数）** | `docs/HITHINK-FUYAO.md` |
| 全局索引（本机） | `/workspace/inbox/INDEX_ALL.md` |

---

*README 校准：2026-09-16 · 反映纯前端 App 架构（此前版本误述为 Node 后端）*
