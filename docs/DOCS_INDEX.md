# 文档地图（所有 AI 必读）

> 注：本工作区曾多次被环境重置清空，重要文档一律收进项目目录内自包含。本索引为当前真实状态。
> 2026-09-11 更新：docs/ 与 GitHub 仓库文档镜像已恢复/建立（见下方「GitHub 仓库文档镜像」章节），本索引重新成为工作区级导航。

## 项目

| 文档 | 路径 | 说明 |
|---|---|---|
| RelayScope 统一规格 **v2.0** | `/workspace/docs/RELAYSCOPE-APP-SPEC.md` | 2026-09-11 已同步仓库 v2.0（对应 v0.6.2/build-36），配套 `/workspace/docs/ENGINEERING.md`；旧 v1.0 备份在同目录 `.bak-v1.0-20260911` |
| App 模板化流程 | `/workspace/docs/APP-TEMPLATE-GITHUB-ACTIONS.md` | 主人钦定标准路线（2026-09-11 恢复自备份包） |
| 构建坑清单 | `/workspace/docs/ANDROID-APP-GITHUB-ACTIONS-BUILD.md` | 检查清单+失败台账（2026-09-11 恢复自备份包） |
| **自制备份格式规范 v1.0** | `/workspace/docs/COOMI-BACKUP-FORMAT.md` | **主人钦定，弃用官方备份**（官方包膨胀 1.4GB+，主因 .node-install 783MB）；Python zipfile 打包（禁系统 zip，中文路径崩溃）、内容三要素、排除清单、还原流程；首个实例=渐进式记忆 V3 包（229KB，导入已验证） |
| PureProbe（**活跃 v0.3.0**） | `/workspace/PureProbe/` | 节点体检 App（订阅→mihomo漏斗→排行榜）；**2026-09-10 并发竞争根因修复+真机验证成功复活**，取证/真机验证 → `PureProbe/docs/DELIVERY-REPORT.md` 七；失败台账（17条）→ `PureProbe/PROJECT_RULES.md`。**注意：app/build.gradle 版本号仍停在 0.2.7/versionCode 13，v0.3.0 改动在 commit f8c0a90，版本号字段未同步（2026-09-11 盘点发现）** |
| PureProbe 架构 | `/workspace/PureProbe/docs/ARCHITECTURE.md` | 架构设计与关键决策 |

## 规则（存活副本）

| 文档 | 路径 | 说明 |
|---|---|---|
| 精简规则 | `/workspace/rules/custom-prompt-v3-slim.md` | 铁律摘要 + 指针（常驻提示词） |
| 铁律全文 | `/workspace/rules/full-rules.md` | 强制规则全文 |

## 模板资产（ survives in PureProbe ）

| 资产 | 路径 | 说明 |
|---|---|---|
| App 图标生成器 | `/workspace/PureProbe/scripts/gen_icon.py` | PIL 程序化生成，新项目复制改配色 |
| preflight 脚本 | `/workspace/PureProbe/scripts/preflight.py` | 治理检查模板 |
| APK workflow | `/workspace/PureProbe/.github/workflows/apk.yml` | 云端构建+签名+Release 模板 |

## GitHub 仓库文档镜像（2026-09-11 拉取，账号 mafucai）

> 用 `gh`（HTTPS token 认证）从主人名下 5 个仓库浅克隆到 `/workspace/docs-from-repos/<仓库名>/`，保留仓库内目录结构。文档源更新后可重新 `gh repo clone` 覆盖同步。

| 仓库 | 文档数 | 关键文档 |
|---|---|---|
| Coomi | 18 | README；RELEASE_NOTES_v1.3.0～v1.4.5（6份）；`docs/`（community、coomi-feedback-guide、prompts-inventory、runtime-v2、mistakes/termux-bootstrap-permission-denied）；`apps/coomi-rs/catalogs/`（coomi-custom-iteration、runtime-environments、skill-creator）；`tools/mobile-build/README.md` |
| api-relay-tester | 10 | `docs/RELAYSCOPE-APP-SPEC.md`（统一产品规格）、`docs/ENGINEERING.md`；**`docs/archive/v2-progressive-memory/`（渐进式记忆 v2 设计存档：README/IMPLEMENTATION_PLAN/CODE_AND_SKILL_INDEX/SESSION_ADAPTER/NOVEL_INDEX_INCREMENT）+ `v3-progressive-memory/README.md` —— 本地 `/workspace/渐进式记忆/` 之外唯一副本** |
| PureProbe | 9 | 治理四件套（PROJECT_RULES/RISK_CHECKLIST/ACCEPTANCE/LOW_MODEL_TASK_TEMPLATE）、`docs/`（ARCHITECTURE、DELIVERY-REPORT、memory-pureprobe-archived）、许可文件 |
| localarch（私有） | 1 | INDEX_DOC.md |
| mxy552500（私有） | 0 | 无 md/txt，仅 html |

### 认证方式备忘
- `gh` 已装（v2.62.0，deb 直装），`gh auth login` 设备码流程已登录账号 mafucai，token 存 `/home/coomi/.config/gh/hosts.yml`
- SSH 22/443 均被手机代理在协议层阻断（kex_exchange_identification 阶段掐断），**git 操作一律走 HTTPS + gh token**
- `/root/.ssh/` 与 `/home/coomi/.ssh/` 各有一把本机生成的 ed25519 密钥（coomi-proot-20260911），SSH 通了可直接用
