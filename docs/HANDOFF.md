# 📈 期货终端 v2 · 完整交接文档

> **版本**：v1.0.3
> **生成时间**：2026-08-11 14:52
> **项目目录**：`/data/data/com.coomi.android/files/home/finance-v2/`
> **完整备份**：`/data/data/com.coomi.android/files/home/backups-v2/finance-v2-v1.0-full-20260810/`
> **旧文档备份**：`/data/data/com.coomi.android/files/home/backups-v2/old-docs/`
> **服务器运行中**：`http://127.0.0.1:3001`

---

## 一、项目概述

Android 手机本地运行的**期货监控 + 回测系统**，纯本地运行，策略不上传。

### 核心原则
- **中央路由（RouteRegistry）**：所有事件统一调度
- **模块化**：每个模块独立文件
- **策略文件永不联网**
- **本地服务器只监听 127.0.0.1**
- **改文件前必须备份**

### 已完成功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 期货行情列表 | ✅ | 967个合约，搜索/收藏/缓存 |
| K线详情页 | ✅ | 日线/4H/60分/30分/15分/5分/1分 |
| 技术指标 | ✅ | MA/EMA/MACD/RSI/KDJ/BOLL/ATR |
| 策略编辑器 | ✅ | 在线编辑 + 语法校验 + 行号提示 |
| 策略筛选 | ✅ | 默认扫967全合约，可只看主连 |
| 回测引擎 | ✅ | 单周期 + 多周期（4H+1H） |
| 实时监控 | ✅ | 定时轮询 + 策略命中报警 |
| 数据时间戳 | ✅ | 行情/K线显示数据时间，过期提醒 |
| 数据源降级 | ✅ | 新浪双域名自动降级 |

---

## 二、怎么启动

```bash
cd /data/data/com.coomi.android/files/home
source .node-install/setup.sh
cd finance-v2
node server/server.js
```

浏览器打开：**http://localhost:3001**

### 如果端口被占用
```bash
pkill -f "node server/server.js"
```
再重新启动。

---

## 三、项目结构

```
finance-v2/
├── config.json              ← 全局配置
├── package.json
├── HANDOFF.md               ← 本文档
├── server/
│   ├── server.js            ← Express 入口（所有 API 路由）
│   ├── data-source.js       ← 期货数据源（新浪双域名 + 东财备用）
│   ├── rate-limiter.js      ← 请求限速器（串行+间隔）
│   ├── indicators.js        ← 技术指标计算
│   ├── strategy-runner.js   ← 策略引擎
│   ├── screener.js          ← 策略筛选器（全合约+实时拉取）
│   ├── backtest.js          ← 回测引擎（单周期+多周期）
│   ├── monitor.js           ← 实时监控模块
│   └── prefetch.js          ← K线预取模块（并发控制）
├── public/
│   ├── index.html           ← 主页面（5个标签页）
│   ├── css/style.css        ← 深色主题样式
│   └── js/
│       ├── router.js        ← 中央路由（RouteRegistry）
│       ├── api.js           ← API 客户端
│       ├── app.js           ← 主入口（含 UI 工具）
│       └── views/
│           ├── list.js      ← 行情列表页
│           ├── detail.js    ← K线详情页
│           ├── strategy.js  ← 策略编辑器+筛选页
│           ├── backtest.js  ← 回测页
│           └── monitor.js   ← 监控页
├── strategies/
│   └── my_strategy.js       ← EMA26 多周期策略（默认）
├── cache/                   ← K线/列表缓存
├── logs/                    ← 监控日志
└── backups/                 ← 文件修改备份
```

---

## 四、已解决的问题清单

### 问题1：行情列表报错 `pct.toFixed is not a function`
- **根因**：`changePct` 可能为 null/undefined/字符串，前端直接 `.toFixed()` 报错
- **修复**：所有数值统一 `Number()` 强制转换，空值显示 `--`
- **文件**：`public/js/views/list.js`

### 问题2：策略编译错误 `Invalid or unexpected token`
- **根因**：`compileStrategy` 用的 `new Function('module','exports',code)` 传入 `module` 是 undefined
- **修复**：改用 Node `Module` 类创建模块实例，正确传参 `new Function('module','exports','require', code)`
- **文件**：`server/strategy-runner.js`
- **参考**：前任 `finance-system/screener.js` 第33行用 `new Module()` 方案

### 问题3：策略编译错误提示不友好
- **修复**：增加空策略检测、语法错误显示行号 + 上下文代码片段
- **文件**：`server/strategy-runner.js`

### 问题4：回测接口返回"无K线数据"
- **根因**：回测接口直接拉东财网络，但东财被封
- **修复**：改为优先读本地缓存，缓存有数据直接用
- **文件**：`server/server.js`

### 问题5：4小时/1小时等分钟K线无数据
- **根因**：东财 `push2his` 域名被封，分钟K线全返回0
- **修复**：数据源改为**新浪期货分钟K线接口** `getFewMinLine`，支持1/5/15/30/60分钟 + 聚合4小时
- **文件**：`server/data-source.js`
- **验证**：60分K线129根，4小时50根

### 问题6：策略与回测未打通
- **根因**：回测页直接从编辑器读策略，但如果没进过策略页，编辑器为空
- **修复**：回测页自动从后端加载已保存策略文件（`ensureStrategy()`）
- **文件**：`public/js/views/backtest.js`

### 问题7：策略筛选只扫51个主连，不是965个
- **根因**：前端"只看主连"复选框默认勾选（`checked`）
- **修复**：去掉默认勾选，默认扫描全部967个合约
- **文件**：`public/index.html`

### 问题8：数据时间过期无法判断
- **修复**：行情列表/K线详情增加数据时间戳（`MM-DD HH:mm:ss`），超1小时/2小时显示⚠️提醒
- **文件**：`public/js/app.js`（新增 `fmtTime()` / `isStale()`）、`list.js`、`detail.js`

### 问题9：刷新数据不清除旧K线缓存，回测/筛选还在用旧数据
- **根因**：`/api/futures/all?refresh=1` 只更新了 `futures.json`，没清 `kline_*.json`
- **修复**：刷新成功后自动清除所有 `kline_*.json` 旧缓存
- **文件**：`server/server.js`

---

## 五、数据源研究（系统性测试结果）

### ✅ 可用数据源（期货K线）

| 数据源 | 域名 | 日K | 分钟K | 说明 |
|--------|------|-----|-------|------|
| **新浪主源** | `stock2.finance.sina.com.cn` | ✅ | ✅ | 主源，稳定不封 |
| **新浪备用** | `stock.finance.sina.com.cn` | ✅ | ✅ | 备用域名，降级用 |
| 东财期货列表 | `push2.eastmoney.com` | - | - | 行情列表（非K线） |
| 东财降级 | `push2delay.eastmoney.com` | - | - | 行情列表（非K线） |

### ❌ 不可用数据源

| 数据源 | 原因 |
|--------|------|
| 东财 push2his | 被封（fetch failed） |
| 东财 push2his1/his2 | 返回HTML首页 |
| 东财 push2 | 被封 |
| 东财 push2delay (K线) | 返回200但 `klines: []` |
| 同花顺 `d.10jqka.com.cn` | 404 |
| 腾讯 `ifzq.gtimg.cn` | 接口改版，返回"No dispatch" |
| 网易 `money.163.com` | 502 |
| 雪球 `xueqiu.com` | 需登录 |
| 百度 `finance.pae.baidu.com` | 只支持 agm 一个代码 |
| 通达信 TCP | 服务器能连，但协议包未调通（前人的 `tdx-client.js`） |
| 第三方（91期货/文华等） | 404/超时/不可用 |

### 📌 待研究数据源

| 来源 | 来源 | 说明 |
|------|------|------|
| **QVeris** | qveris.ai | AI Agent 能力路由网络，可发现金融数据能力。HTTP REST API 直连可用（`POST /api/v1/search` 发现能力，`POST /api/v1/tools/execute` 调用）。需注册获取 API Key。 |
| **GitHub 仓库** | 用户提到 | 用户说"第2个是我"——有 GitHub 仓库存有大量期货数据，需后续拉取 |
| **易涨 easyup** | 抖音视频 | mootdx 替代品，通达信 HTTP 封装，五档盘口/分笔大单，27ms 延迟。未找到公开接口文档 |

### 🚀 重大发现（2026-08-11 实测验证）— 新浪全量K线可一次拉完，不封IP！

> **背景**：此前担心新浪一次性拉 900+ 会被封 IP。经多轮实测，**结论完全相反**——新浪 K 线接口**不封 IP**，965 个合约 17 秒拉完 811 个（84%），全程无限速！

#### 实测数据（3轮验证）

| 测试 | 结果 |
|------|------|
| 第1轮：965个，并发5，无间隔 | ✅ 813成功/152失败，19秒，**不封IP** |
| 第2轮：965个，并发3+间隔 | ✅ 533成功（误判），64秒 |
| 第3轮：修复后，并发5 | ✅ 811成功/154失败，17秒，**不封IP** |

**结论：新浪 K 线接口（`getDailyKLine`）可以放心全量拉取，无需担心封 IP！**

#### 两个关键 Bug 已修复（`data-source.js`）

1. **郑商所代码转换**：
   - ❌ 旧：`code.endsWith('m')` 只处理小写 → `SAM`（纯碱主连）不识别 → 失败
   - ✅ 新：`fixSinaCode()` 统一小写处理：
     - `sam`/`sas` → `sa0`（主连/次主连）
     - `sa` → `sa0`（纯品种）
     - `sa609` → `sa2609`（**郑商所 3 位补 2**，关键！）
     - `ag2610` → `ag2610`（4 位原样）

2. **新浪返回判断**：
   - ❌ 旧：`text.match(/\[(.*)\]/s)` 匹配失败就报错 → 新浪返回 `/*<script>location.href='//sina.com';</script>*/var _x=([{...` 时被误判失败
   - ✅ 新：先判断 `text.includes('var _x=') && text.includes('"d":')` 确认有真实数据，再解析

#### 失败 154 个的构成（非 bug，是正常现象）

| 类型 | 数量 | 说明 |
|------|------|------|
| **远期合约**（2707/2708+） | ~88 | 刚上市历史K线不足20根，本来就没数据 |
| **次主连** `*s` | 51 | 新浪没有"次主连"概念，映射到主连 `sa0` 后有的能取 |
| **上金所特殊**（Au9999/AGTD） | ~15 | 金交所现货，非期货 |

**这些都不影响使用**：主力连 51 个 + 活跃合约全都能拉到，回测/筛选数据充足。

#### 新增脚本：`server/prefetch-daily.js`（每日K线更新）

```bash
cd /data/data/com.coomi.android/files/home
source .node-install/setup.sh
cd finance-v2
node server/prefetch-daily.js 60 20 5
# 参数: limit=60(每合约拉60根), minBars=20(不足20根跳过), concurrency=5(并发)
# 实测: 965合约 → 811成功，17秒完成
```

- 每天收盘后运行一次，全市场K线更新到缓存
- 回测/筛选直接读缓存，无需逐个拉网络
- 失败的多为远期合约，不影响主力连和活跃合约

#### 实时报价也已修复（`data-source.js`）

- `futureQuote()` 主源改为新浪 `hq.sinajs.cn`（`nf_` 前缀），东财 push2 作兜底
- 新增 `sinaQuoteBatch(codes)` 批量实时报价（监控页轮询用）
- 新增 `toSinaCode()` 代码转换：`agm→AG0`、`sc0→SC0`、`ag2610→AG2610`
- 实测：agm 白银 15748、sc0 原油 563.8、m0 豆粕 3140 全部实时返回

### 📦 增量更新方案（2026-08-11 实施）— 历史保留，只追加新数据

> **核心思路**：首次全量拉历史K线缓存，之后每天只拉当天新增的几根K线追加到缓存，**不重新拉全部历史**。流量极小，不触发任何限速。

#### 为什么需要

| 方式 | 请求数 | 数据量 | 限速风险 |
|------|--------|--------|---------|
| 全量（每次重拉历史） | 967×3周期≈2900次 | 每合约200根历史 | ⚠️ 高 |
| **增量（只追加新K线）** | 967×3周期≈2900次 | 每合约只返回新增几根 | ✅ 极小 |

#### 三个脚本（`server/`）

| 脚本 | 用途 | 用时 | 用法 |
|------|------|------|------|
| `prefetch-daily.js` | 全量日K（首次/重建） | 17s | `node server/prefetch-daily.js 60 20 5` |
| `prefetch-multi-slow.js` | 全量4H+1H（首次/重建） | 3min | `node server/prefetch-multi-slow.js 5 300` |
| **`update-kline.js`** | **每日增量更新（推荐）** | **58s** | `node server/update-kline.js 5` |

#### update-kline.js 增量原理

```
1. 读缓存最后一根K线时间（如 agm 4H 最后是 08-11 15:00）
2. 拉取新浪最新K线（返回全部历史）
3. 只保留时间 > 缓存最后时间的K线（新增几根）
4. 写入缓存 = 旧历史（最多留500根） + 新增
```

#### 当前缓存现状（2026-08-11 全量拉取后）

| 周期 | 缓存数 | 数据量 |
|------|--------|--------|
| 101 日K | 901 个 | 60根/合约 |
| 240 4H | 883 个 | 60根/合约 |
| 60 1H | 883 个 | 120根/合约 |

数据均到 2026-08-11（当天），郑商所（SAM/SA609 等）已修复正常。

#### 每日操作流程

```bash
cd /data/data/com.coomi.android/files/home
source .node-install/setup.sh
cd finance-v2
node server/update-kline.js 5   # 58秒增量更新（收盘后跑一次）
```

> **注意**：点"刷新行情"（`/api/futures/all?refresh=1`）**不再清空K线缓存**（已修复），只更新行情列表快照。K线用 update-kline.js 单独增量更新。

---

## 六、当前架构设计

### 中央路由（RouteRegistry）

所有事件通过 `RouteRegistry.dispatch(event, payload)` 触发，页面切换用 `RouteRegistry.navigate(page)`。

**已注册事件**：`load-data`、`refresh-data`、`toggle-fav`、`search-code`、`open-detail`、`back-to-list`、`load-strategy`、`save-strategy`、`run-screen`、`backtest-code`、`run-backtest`、`monitor-start`、`monitor-stop`、`prefetch-data`

### 数据流

```
行情列表(futures.json缓存) → 搜索/收藏 → 点击 → K线详情(新浪双域名) → 指标计算
     ↓                                                        ↓
策略编辑器 → 保存(strategies/my_strategy.js) → 筛选(读缓存) → 命中合约
     ↓                                                        ↓
回测(4H+1H多周期) ← 自动加载策略 ← 从筛选结果一键直达
     ↓
update-kline.js(每日增量) → 只追加当天新K线到缓存（58秒）
```

### 后端 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/futures/all` | GET | 期货列表（刷新**不再清K线缓存**，`?clearKline=1` 才清） |
| `/api/quote` | GET | 实时行情 |
| `/api/kline` | GET | K线+指标 |
| `/api/strategy` | GET/POST | 读/写策略文件 |
| `/api/screen` | POST | 策略筛选 `{mainOnly, multi, liveFetch}` |
| `/api/backtest` | POST | 回测 `{code, period, multi}` |
| `/api/prefetch` | POST | 后台预取K线缓存 `{multi, full}` |
| `/api/monitor/start` | POST | 启动监控 |
| `/api/monitor/stop` | POST | 停止监控 |
| `/api/cache/clear` | POST | 清除缓存 |

---

## 七、EMA26 多周期策略（默认）

```
策略文件: finance-v2/strategies/my_strategy.js
```

**逻辑**：
- 4H 定方向：收盘价 > EMA26(4H) 只做多，< 只做空
- 1H 找入场：价格上穿/下穿 EMA26(1H) + ATR 安全距离 + 连续3根确认 + 阳/阴线
- 减仓：1H 跌破/突破 EMA26 减 1/3
- 清仓：4H 跌破/突破 EMA26 清仓
- 仓位：2% 风险预算 / 止损距离 × 10，最多3手

**已验证结果（agm 沪银，4H+1H，200根）**：
- 总收益 3.49%，交易28次，胜率71.4%，最大回撤0.71%

---

## 八、关键坑（必须知道）

### 1. 浏览器缓存旧 JS
前端 JS 加了版本号 `?v=N`，改代码后必须更新版本号或让用户强制刷新（`Ctrl+Shift+R`）。

### 2. 新浪双域名降级
`data-source.js` 的 `_sinaDailyKline` 和 `_sinaMinKline` 已实现双域名自动降级：
```javascript
const SINA_HOSTS = [
  'https://stock2.finance.sina.com.cn',
  'https://stock.finance.sina.com.cn',
];
```
第一个失败自动切第二个。

### 3. 预取全部数据很慢
965个合约 × 2周期 = 1930次请求，即使并发也要几分钟。已实现 `/api/prefetch` 后台慢慢拉取，不阻塞页面。

### 4. 筛选默认只读缓存
`screener.js` 默认 `liveFetch=false`（只读缓存，快）。需要实时拉取时传 `liveFetch=true`。

### 5. 沙盒没有后台进程
`nohup`、`&`、`disown` 无效，必须用 `local_shell` 持久会话或前台占用。

### 6. 通达信 TCP 协议
`finance-system/tdx-client.js` 能连通达信服务器但返回0根K线，协议包需调试。

### 7. QVeris 直连可用
`qveris.ai` 和 `api.qveris.ai` 可直接访问（无需梯子），但需要注册获取 API Key 才能调用。GitHub 需要梯子。

---

## 九、版本历史

| 版本 | 日期 | 内容 |
|------|------|------|
| v1.0.0 | 2026-08-10 | 第一个完整版：全部功能 + 完整文档 + 备份 |
| v1.0.1 | 2026-08-10 | 策略筛选默认扫全部967合约 |
| v1.0.2 | 2026-08-10 | 行情列表/K线详情增加数据时间戳 + 过期提醒 |
| v1.0.3 | 2026-08-11 | 刷新行情自动清K线缓存 + 新浪双域名降级 + 预取接口 |
| v1.0.4 | 2026-08-11 | **重大突破**：新浪全量K线不封IP（965→811，17秒）+ 修复郑商所代码转换 + 实时报价改新浪 |
| v1.0.5 | 2026-08-11 | **增量更新**：新增 update-kline.js（58秒增量，历史保留只追加）+ 刷新不再清K线缓存 + 全量4H/1H缓存（883个）|

---

## 十、未解决问题（下一轮做）

1. ~~**QVeris 集成**：注册 API Key，用其 REST API 发现并调用期货数据能力，作为第3个备用数据源~~ → ❌ 确认不支持期货（111个端点全A股/指数/基金），已放弃
2. **GitHub 仓库数据**：用户有一个 GitHub 仓库存有大量期货数据，需拉取（需梯子）→ 已验证可直连，待确认仓库地址
3. **易涨 easyup**：通达信 HTTP 替代方案，需找到接口文档
4. **通达信 tdx-client.js**：调试 TCP 协议，让它能正确返回K线数据
5. **预取状态提示**：前端显示预取进度（当前已拉多少个/总数）
6. **批量预取缓存**：一键"拉取全部数据"时显示进度条
7. ~~**akshare 集成**~~ → 实测确认 akshare = 新浪数据源，我们已直接使用相同接口，无需再绕一层
8. ~~**同花顺官方 HiThink**~~ → 实测确认不支持期货（111端点全A股），已放弃

---

## 十一、给下一个 AI 的提示

1. 先 `source .node-install/setup.sh` 激活环境
2. 再 `cd finance-v2 && node server/server.js` 启动
3. 页面在 `http://localhost:3001`
4. 完整备份在 `backups-v2/finance-v2-v1.0-full-20260810/`
5. **QVeris** 直连可用（`qveris.ai` HTTP 200），需注册获取 API Key；**已确认不支持期货**（111端点全A股）
6. **GitHub** 现在可直连（之前记录需梯子已过时），`simonlin1212/a-stock-data` 是 A 股工具（reference/ 有）
7. 新浪有2个域名可用（stock2/stock），**K线全量拉不封IP**（965→811，17秒）
8. **每日增量更新**：`node server/update-kline.js 5`（58秒，历史保留只追加）
9. **EMA26 策略是多周期**：筛选必须勾"多周期(4H+1H)"，需要 240/60 缓存
10. 点"刷新行情"**不再清K线缓存**（只更新行情列表）
11. 所有数据源测试结果详见第5节

> 📌 **启动命令**：
> ```bash
> cd /data/data/com.coomi.android/files/home
> source .node-install/setup.sh
> cd finance-v2
> node server/server.js
> ```