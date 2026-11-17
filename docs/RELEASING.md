# Windows 中文版发布流程

发布仓库是外层 Git 仓库的 `origin`：`ShengjieLi-CN/Pot-Translate-Next`。不要向 Pot 上游仓库推送。只发布 Windows x64 简体中文 MSI；历史版本的说明和验证记录保留在 `release/`。

## 版本与验证

每次升级递增补丁版本，同步以下四处：

- `pot-desktop/package.json` 的 `version`
- `pot-desktop/src-tauri/tauri.conf.json` 的 `package.version`
- `pot-desktop/src-tauri/Cargo.toml` 的项目版本
- `pot-desktop/src-tauri/Cargo.lock` 中 `name = "pot"` 的版本

先运行 [开发说明](DEVELOPMENT.md) 中与改动有关的自动测试和界面回归。完成代码审查后，在 `release/release-notes-<版本>.md` 编写面向用户的更新内容、安装方式、验证结果和实际限制。README 的版本链接应同步。

在 Windows 本地盘的源码目录执行：

```powershell
cd pot-desktop
pnpm install --frozen-lockfile
.\.scripts\build-msi.ps1
.\.scripts\verify-msi.ps1
```

校验脚本默认读取 `package.json` 版本，也接受显式 `-Version`；检查 MSI 的产品名、版本、简体中文 `2052`、x64 和固定 UpgradeCode，并解包比较内置程序与构建程序的 SHA-256。输出到外层 `release/`：

```text
Pot.Translate.Next_<版本>_x64_zh-CN.msi
SHA256SUMS-<版本>.txt
verification-<版本>.json
```

用户要求功能升级后直接本地升级。安装前备份用户配置，关闭应用，再通过 Windows 管理员授权运行 MSI；安装后核验注册信息、程序版本和哈希，重启并检查配置保留。若管理员授权被取消，应报告升级未完成，不能把生成安装包当作已安装。

## 提交与发布

MSI 被 `.gitignore` 排除，只作为 Release 附件上传。源码、测试、说明和校验记录进入 Git。下面的 `$releaseVersion` 取自项目清单，命令从仓库根目录执行：

```powershell
$releaseVersion = (Get-Content pot-desktop/package.json -Raw | ConvertFrom-Json).version
git diff --check
git status --short
# 选中本次源码、文档和验证记录后提交，勿包含个人配置或调试结果。
git push origin main
git tag -a "v$releaseVersion" -m "Pot Translate Next $releaseVersion"
git push origin "v$releaseVersion"
gh release create "v$releaseVersion" `
  "release/Pot.Translate.Next_${releaseVersion}_x64_zh-CN.msi" `
  "release/SHA256SUMS-${releaseVersion}.txt" `
  "release/verification-${releaseVersion}.json" `
  --repo ShengjieLi-CN/Pot-Translate-Next --verify-tag --latest `
  --title "Pot Translate Next $releaseVersion 简体中文版" `
  --notes-file "release/release-notes-${releaseVersion}.md"
```

发布后核对标签指向的提交、Release 正文、附件名称与大小；下载附件重新计算 SHA-256，确认与本地验证记录一致。应用内更新依赖正式 Release 的 `_x64_zh-CN.msi` 附件名称。
