# futures-terminal — 期货终端

> Android 手机本地运行的**期货行情 + 策略筛选 + 回测**工具。纯本地，策略不上传。
> 架构：**WebView + 原生桥**（零第三方依赖、完全离线）
> 编译：GitHub Actions 云端（`.github/workflows/apk.yml`，推 `master` 触发）
> 应用 ID：`com.mafucai.futuresterminal`

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
| 回测引擎 | ✅ | 单周期 + 多周期（4H+1H），含收益曲线 |
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
│   │   ├── index.html             ← 5 标签 + 6 视图
│   │   ├── css/style.css          ← 自研设计系统
│   │   └── js/
│   │       ├── router.js          ← 中央路由（RouteRegistry）
│   │       ├── api.js             ← 本地适配层（无需后端）
│   │       ├── app.js             ← 入口 + UI 工具
│   │       ├── scoring.js         ← 5 信号加权评分
│   │       ├── webdata.js         ← 数据源（新浪/东财，经原生桥）
│   │       ├── indicators.js      ← 技术指标
│   │       ├── strategy-runner.js ← 策略引擎
│   │       ├── screener.js        ← 策略筛选（已接评分）
│   │       ├── backtest.js        ← 回测引擎
│   │       ├── monitor.js         ← 监控模块
│   │       ├── lib/echarts.min.js ← 图表（本地，无 CDN）
│   │       └── views/             ← list / detail / strategy / backtest / monitor / ai
│   ├── java/com/mafucai/futuresterminal/
│   │   └── MainActivity.java      ← WebView 壳 + 原生桥
│   ├── res/                       ← 图标 / 主题 / 字符串
│   └── AndroidManifest.xml
├── docs/
│   ├── HANDOFF.md                 ← 完整交接文档
│   └── DOCS_INDEX.md              ← 文档索引
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
| 数据源 | 域名 | 日K | 分钟K |
|---|---|---|---|
| **新浪主源** | `stock2.finance.sina.com.cn` | ✅ | ✅ |
| **新浪备用** | `stock.finance.sina.com.cn` | ✅ | ✅ |
| 东财行情列表 | `push2.eastmoney.com` | - | - |

### ❌ 不可用
东财 push2his（被封）、同花顺（404）、腾讯（接口改版）、网易（502）、雪球（需登录）、百度（仅 agm）、通达信 TCP（协议未调通）

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

---

## 12. 文档

| 文档 | 路径 |
|---|---|
| 完整交接文档 | `docs/HANDOFF.md` |
| 文档索引 | `docs/DOCS_INDEX.md` |
| 全局索引（本机） | `/workspace/inbox/INDEX_ALL.md` |

---

*README 校准：2026-09-16 · 反映纯前端 App 架构（此前版本误述为 Node 后端）*
