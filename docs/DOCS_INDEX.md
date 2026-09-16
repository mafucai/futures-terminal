# 文档地图（所有 AI 必读）

> **校准时间**：2026-09-16 —— 逐条核对路径，**修正 14 处失效指针**（原指向 `/workspace/docs/`、`/workspace/PureProbe/`、`/workspace/docs-from-repos/`，实际均在 `/workspace/repos/<仓库>/` 下）。
> **权威全局索引**：`/workspace/inbox/INDEX_ALL.md`（覆盖范围更大，冲突时以它为准）。
> 本文件定位：**期货终端项目内**的文档导航。

---

## 期货终端（本项目）

| 文档 | 路径 | 说明 |
|---|---|---|
| **项目总览** | `README.md` | 架构 / 结构 / 功能 / 评分 / AI（2026-09-16 校准为纯前端 App） |
| **完整交接文档** | `docs/HANDOFF.md` | v1.0.x 时代交接（Node 后端口径，**历史参考**） |
| 本索引 | `docs/DOCS_INDEX.md` | 项目内文档导航 |

> ⚠️ `docs/HANDOFF.md` 描述的是**旧的 Node 后端架构**（`server/*.js` + `.node-install`），
> 而本仓库现为**纯前端 App**（WebView + 原生桥）。冲突时以 `README.md` 为准。

---

## 运行时资产（`/workspace/`，2026-09-16 建立）

| 资产 | 路径 | 说明 |
|---|---|---|
| **期货后端 + 评分**（本机运行） | `/workspace/finance-v2/` | 零依赖 Node，12 路由 + 5 信号评分 + AI；见 `BACKEND.md` |
| 浏览器版前端 | `/workspace/finance-v2/public/` | 6 视图，与 App 同源设计 |
| 常驻提示词（slim） | `/workspace/rules/custom-prompt-v3-slim.md` | 铁律摘要 + 指针 |
| 铁律全文 | `/workspace/rules/full-rules.md` | 强制规则全文 |
| 钩子说明 + 探活 | `/workspace/hooks/README.md` · `healthcheck.sh` | 三钩子 + 守门器退出码 |
| 仓库恢复脚本 | `/workspace/hooks/re-clone.sh` | 工作区清空后一键恢复 4 仓库 |
| 渐进式记忆 V3（⭐权威） | `/workspace/novel-kg-compressor/docs/v3/README.md` | 记忆系统权威口径 |
| 技能库 | `/workspace/渐进式记忆/libraries/skills-library/` | 68 卡 + skill-index.json |

---

## GitHub 仓库文档（账号 mafucai，检出在 `/workspace/repos/`）

> **路径约定**：下表路径均为**相对仓库根**；本机实际检出在 `/workspace/repos/<仓库名>/`。
> 例：`Coomi/README.md` → `/workspace/repos/Coomi/README.md`。

| 仓库 | 关键文档 |
|---|---|
| **Coomi**（主项目） | `README.md`；`tools/mobile-build/README.md`（APP 文档 2.0）；`docs/prompts-inventory.md`；`docs/{community,coomi-feedback-guide,runtime-v2}.md`；`docs/APP-TEMPLATE-GITHUB-ACTIONS.md`；`docs/ANDROID-APP-GITHUB-ACTIONS-BUILD.md`；`docs/COOMI-BACKUP-FORMAT.md`；`apps/coomi-rs/catalogs/*` |
| **api-relay-tester**（RelayScope） | `docs/RELAYSCOPE-APP-SPEC.md`（统一规格 v2.0）；`docs/ENGINEERING.md`；**`docs/archive/v2-progressive-memory/`（渐进式记忆 v2 设计存档）+ `v3-progressive-memory/README.md`** |
| **PureProbe**（活跃 v0.3.0） | 治理四件套（`PROJECT_RULES.md`/`RISK_CHECKLIST.md`/`ACCEPTANCE.md`/`LOW_MODEL_TASK_TEMPLATE.md`）；`docs/{ARCHITECTURE,DELIVERY-REPORT,memory-pureprobe-archived}.md`；`scripts/{gen_icon.py,preflight.py}` |
| **futures-terminal**（本项目） | `README.md`；`docs/HANDOFF.md`；`docs/DOCS_INDEX.md` |

### PureProbe 已知不一致

`app/build.gradle` 版本号停在 **0.2.7 / versionCode 13**，而 v0.3.0 改动已在仓库（commit `f8c0a90`）——**版本号字段未同步**（2026-09-11 盘点发现，2026-09-16 复核仍如此）。

---

## 环境事实（2026-09-16 复核）

| 项 | 状态 |
|---|---|
| 仓库检出位置 | **`/workspace/repos/`**（原 `/tmp/ghtest/` 已迁移，临时目录隐患已消除） |
| 恢复方式 | `bash /workspace/hooks/re-clone.sh`（脚本内置 SSH→HTTPS 回退） |
| **推送认证** | ✅ **SSH 密钥已装**（`/home/coomi/.ssh/id_ed25519`）；用显式 443：`ssh://git@ssh.github.com:443/...` |
| `gh` CLI | ❌ **未安装**（原索引称已装，与实际不符） |
| `/workspace/docs-from-repos/` | ❌ **不存在**（原索引的镜像目录已废弃，现为 `repos/`） |
| `/workspace/docs/` | ❌ **不存在**（原索引 5 条路径全部失效，已改指 `repos/<仓库>/docs/`） |

### 推送备忘（本环境实测可用）

```bash
# remote 须为显式 443 形式（git@github.com 走 22 会被拦）
git remote set-url origin ssh://git@ssh.github.com:443/mafucai/<仓库>.git
git config core.sshCommand "ssh -i /home/coomi/.ssh/id_ed25519 -o IdentitiesOnly=yes -p 443"
git push origin <分支>     # Coomi/futures-terminal 的分支名需确认（main / master）
```

---

*构建坑清单、App 模板流程、备份格式规范：见 `repos/Coomi/docs/` 下对应文件（原 `/workspace/docs/` 路径已失效）。*
