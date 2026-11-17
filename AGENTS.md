# 项目约定

- 用户要求从 3.2.0 起仅维护、打包和发布简体中文版；MSI 语言固定 `zh-CN`，不要生成或上传英文安装包。
- 应用界面及托盘使用简体中文。翻译的源语言/目标语言仍支持原有多语种；上游内部语言资源可以保留作兼容用途。
- 正式发布到本工作区外层 Git 仓库的 `origin`：`ShengjieLi-CN/Pot-Translate-Next`。`pot-desktop` 内层仓库的远端是上游，不要向上游推送本项目发布。
- MSI 使用 `pot-desktop/.scripts/build-msi.ps1` 和 `src-tauri/tauri.msi.conf.json` 构建；版本保持 package.json、tauri.conf.json、Cargo.toml 和 Cargo.lock 中的本项目条目一致。

- 每次完成用户要求的功能升级后，直接构建并升级本地安装；每次将补丁版本号递增 1（例如 3.3.0 → 3.3.1），并同步上述四处版本号。
