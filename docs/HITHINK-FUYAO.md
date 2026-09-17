# 同花顺（HiThink / fuyao）数据对接说明

> 用途：为期货策略/回测/模拟盘提供**合约乘数、保证金率、手续费**等合约规格数据。
> 新浪不提供这些字段（实测确认），东方财富不稳定（常被封），同花顺是当前**唯一可用的权威来源**。
> 本文件只记录**接口契约**，不含任何真实 API Key。

---

## 1. 凭据（API Key）

| 项 | 值 |
|---|---|
| 获取地址 | https://fuyao.aicubes.cn/ → API Key 管理 |
| 注册 | 免费 |
| 传递方式 | 请求头 `X-api-key: <KEY>` |
| 本机存储 | **仅存浏览器 `localStorage`**，键名 `fv2_hithink_key` |
| 安全红线 | ❌ 绝不写入代码 / README / 日志 / Git；日志与界面全程脱敏（只显示后 4 位） |

> ⚠️ 曾有真实 Key 通过聊天渠道提供，请确保：
> - 不把 Key 提交到任何仓库；
> - 若怀疑泄露，去官网**重置 Key**。

---

## 2. 核心接口：期货品种资料（含合约乘数）

```
GET https://fuyao.aicubes.cn/api/futures/varieties/list
Header: X-api-key: <KEY>
```

- 无业务参数
- 返回**全部品种**（实测 91 个），每项含合约规格
- 响应信封：`{ code, message, request_id, data: { timestamp, item: [...] } }`
- `code === 0` 为成功

### 关键字段

| 字段 | 类型 | 说明 | 例（沪铜） |
|---|---|---|---|
| `variety_code` | string | 品种代码 | `CU` |
| `name` | string | 品种名 | `沪铜` |
| `exchange_code` / `exchange_name` | string | 交易所 | `SHFE` / 上海期货交易所 |
| **`contract_multiplier`** | number | **合约乘数**（每手每点盈亏） | `5` |
| `trade_amount` / `trade_unit` | number/string | 交易单位 | `5` / `吨/手` |
| `tick_size` | number | 最小变动价位 | `10` |
| **`margin_rate`** | number | **保证金率**（小数） | `0.11` |
| **`transaction_fee`** | number\|null | **手续费（元/手，固定）** | `null` |
| **`transaction_fee_rate`** | number\|null | **手续费率**（按成交额，千分/万分） | `0.5` |
| `main_contract_thscode` | string | 主力合约代码 | `CU2601.SHF` |
| `has_night_session` | boolean\|null | 是否夜盘 | `true` |

> ⚠️ **手续费两种计法**：`transaction_fee`（固定元/手）与 `transaction_fee_rate`（按成交额比例）可能**只出现其一**，成本模型必须两者都支持。

### 实测样例（我们关注的品种）

| 品种 | 代码 | 乘数 | 保证金 | 手续费 | 夜盘 |
|---|---|---|---|---|---|
| 沪银 | AG | 15 | 22% | 0.5‰ | ✅ |
| 原油 | SC | 1000 | 18% | 20 元 | ✅ |
| 燃油 | FU | 10 | 18% | 0.5‰ | ✅ |
| 低硫燃油 | LU | 10 | 18% | 0.1‰ | ✅ |
| 甲醇 | MA | 10 | 10% | 1‰ | ✅ |
| 沪锡 | SN | 1 | 14% | 3 元 | ✅ |
| PTA | TA | 5 | 7% | 3 元 | ✅ |
| 纯碱 | SA | 20 | 8% | 2‰ | ✅ |
| 棕榈油 | P | 10 | 8% | 2.5 元 | ✅ |
| 多晶硅 | PS | 3 | 13% | 1‰ | ❌ |
| 碳酸锂 | LC | 1 | 15% | 0.8‰ | ❌ |
| 豆粕 | M | 10 | 7% | 1.5 元 | ✅ |
| 螺纹钢 | RB | 10 | 7% | 1‰ | ✅ |

（完整 91 个品种以接口实时返回为准，不要写死在文档里）

---

## 3. 其他可用期货接口

| 接口 | 说明 | 是否开放 |
|---|---|---|
| `GET /api/futures/varieties/list` | 期货品种资料（含乘数） | ✅ 开放 |
| `GET /api/futures/contracts/detail` | 期货合约详情 | ✅ 开放 |
| `GET /api/futures/prices/daily` | **期货日K** | ✅ 开放 |
| `GET /api/futures/positions/*` | 持仓排名 | ✅ 开放 |
| `GET /api/futures/warehouse-receipts/*` | 仓单 | ✅ 开放 |
| `GET /api/futures/basis/*` | 基差 | ✅ 开放 |
| 期货品种板块 / 主连资料 / 交易时间轴 | 扩展资料 | ❌ 暂未开放外部接入 |

### 期货日K

```
GET https://fuyao.aicubes.cn/api/futures/prices/daily?thscode=CU2601.SHF
Header: X-api-key: <KEY>
```
- 返回 `open_price/high_price/low_price/close_price/volume/turnover`
- **只有日K**

---

## 4. 关键结论：数据分工

| 数据 | 来源 | 原因 |
|---|---|---|
| **合约乘数 / 保证金 / 手续费** | **同花顺** | 新浪没有；东财不稳定 |
| **4H / 1H / 30分 / 15分 / 5分 / 1分 K线** | **新浪** | 同花顺**不提供分钟K** |
| **日K** | 新浪（主）| 新浪已有，统一口径；同花顺可作交叉校验 |
| **实时报价** | 新浪 | 已有 |
| **期货列表** | 东方财富 | 已有 |

> 📌 同花顺**不提供分钟K**，我们的多周期策略（4H+1H）**仍必须依赖新浪**。同花顺只用来补「合约规格」和可选的日K校验。

---

## 5. 接入设计（待实现）

1. **Key 输入**：设置区加输入框，存 `localStorage['fv2_hithink_key']`，界面脱敏显示（后 4 位）。
2. **拉取乘数表**：点「⟳ 从同花顺刷新乘数」→ 调用 `varieties/list` → 存 `localStorage['fv2_specs']`（`{ [varietyCode]: {multiplier, marginRate, fee, feeRate, tickSize, nightSession} }`）。
3. **品种→品种码映射**：把合约代码（如 `agm`、`sc0`）取字母前缀转大写（`AG`、`SC`）匹配 `variety_code`。
4. **兜底**：未拉到 / 无 Key 时用**内置乘数表**；仍无则提示手填。
5. **成本模型**：回测/模拟支持 `固定元/手` + `按成交额比例` 两种手续费。

---

## 6. 验证记录

- 2026-09-17：实测 `varieties/list` 无 Key 返回 `{"code":2003,"message":"Missing X-api-key"}`；带有效 Key 返回 `code:0`，**91 个品种**全字段正常。
- 同步确认：`/api/futures/prices/daily` 仅日K；同花顺文档标注「分钟K、tick 暂不公开」。
