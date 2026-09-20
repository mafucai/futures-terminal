# Android 固定签名资产

> 状态：已启用（2026-09-20）
> 适用应用：期货终端
> 应用 ID：`com.mafucai.futuresterminal`

## 1. 资产位置

- 私有备份仓库：`mafucai/android-signing-backup`
- GitHub 地址：<https://github.com/mafucai/android-signing-backup>
- 仓库必须始终保持：**Private**
- 签名容器：`futuresterminal-release.p12`
- 格式：PKCS#12
- 密钥别名：`futuresterminal-release`
- 证书 SHA-256：`15:32:B4:21:35:16:65:64:EA:C8:DE:F1:8E:AA:89:8D:F6:E7:17:93:70:82:90:F6:84:6F:D6:C2:77:1F:2B:17`
- 备份文件 SHA-256：`a2cbcd596c69449e69fa538dd41e54fc295bd3fbe7ffde9334b214049d654bda`

私有仓库只保存签名容器、校验文件和不含口令的恢复说明。口令、Base64、Token 和私钥正文不得写入本项目或任何文档。

## 2. GitHub Actions Secrets

公开源码仓库 `mafucai/futures-terminal` 已配置以下 Repository Secrets：

- `KEYSTORE_BASE64`
- `KEYSTORE_PASSWORD`
- `KEYSTORE_ALIAS`
- `KEY_PASSWORD`

Secrets 只能由 GitHub Actions 使用。GitHub API 无法读回明文，只能确认名称和更新时间。

## 3. 所有 AI 必须遵守

1. **禁止重新生成签名替换现有签名。** 更换签名会导致已安装 APK 无法覆盖升级，除非事先完成正式签名迁移方案。
2. 禁止把 `.p12`、`.jks`、`.keystore`、密码、Base64、Token 或私钥正文提交到公开仓库、日志、对话或 Release。
3. 禁止在 Actions 日志中 `echo`、`cat`、`set -x` 输出任何 Secret。
4. 构建时优先使用现有 4 个 Secrets；不得因为读不到 Secret 明文就创建新签名。
5. 临时解码出的 keystore 必须放在 Actions 临时工作区，签名结束后立即删除。
6. 修改签名 workflow 前，先核对本文件与 `.github/workflows/apk.yml`，并保持 Secret 名称兼容。
7. 如果私有备份仓库不可访问，停止签名资产变更并向主人报告；不得猜测、重建或降级为永久临时签名。

## 4. 构建与验证

正式 APK 由 `.github/workflows/apk.yml` 在 GitHub Actions 构建和签名。本地环境不安装 Android SDK，也不在本地编译。

每次正式构建至少验证：

1. Actions 显示使用固定签名，而不是临时验证签名。
2. `apksigner verify` 成功。
3. `apksigner verify --print-certs` 输出的 SHA-256 证书指纹与本文件一致。
4. APK 包名为 `com.mafucai.futuresterminal`。
5. 新 APK 能覆盖安装旧的正式 APK，并保留应用数据。

## 5. 灾难恢复

1. 先确认 `mafucai/android-signing-backup` 仍为 Private。
2. 下载 `futuresterminal-release.p12` 并按仓库内 `.sha256` 校验。
3. 从主人管理的密码保险库取得口令；密码不得与签名文件存放在同一仓库。
4. 将签名容器重新编码为单行 Base64，分别恢复上述 4 个 Secrets。
5. 触发 `workflow_dispatch`，按第 4 节验证证书指纹和覆盖安装能力。

如果口令和 GitHub Secrets 同时丢失，即使签名容器仍在，也无法正常使用；因此主人应在独立密码管理器中保留口令。
