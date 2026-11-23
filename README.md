# Pot Translate Next (For Windows)

基于 [Pot Desktop](https://github.com/pot-app/pot-desktop) 二次开发的桌面翻译工具，专注中文使用体验。支持自动输入翻译、划词翻译、截图原位翻译和同声传译。

[下载 Windows x64 中文版 MSI](https://github.com/ShengjieLi-CN/Pot-Translate-Next/releases/latest) · [查看 3.4.1 更新说明](https://github.com/ShengjieLi-CN/Pot-Translate-Next/releases/tag/v3.4.1)

3.4.1 将划词翻译窗口合并为常规翻译模式，移除“英汉互译 / 常规翻译”顶部切换栏；文字识别移除云端 Paddle OCR 配置，仅保留本地 RapidOCR 推理模型。仅面向 Windows。

## 功能演示

演示图使用合成文本和模拟服务，不含个人信息；实际效果取决于所配置的服务。

### 截图原位翻译

快捷键或托盘启动，框选后直接在原位置显示译文。支持复杂图文、小字号英文、局部背景保留、原图对照和复制。
<img width="1853" height="1246" alt="截图原位翻译效果" src="https://github.com/user-attachments/assets/b284b6cc-0bc3-4352-93cc-39c31e81ee66" />
<img width="1828" height="1271" alt="截图原位翻译效果" src="https://github.com/user-attachments/assets/c54f7cb6-555d-4f96-aa83-8dab48d566d8" />

### 自动输入翻译

输入或粘贴后自动翻译，支持原文与译文逐句联动高亮。

![输入翻译演示](pot-desktop/asset/main-translation-preview.png)

### 划词翻译

选中文字后点击附近的圆形“译”按钮，或使用划词快捷键，在旧版翻译窗口中编辑原文、选择语言并查看多个服务的译文。

![圆形划词按钮演示](pot-desktop/asset/selection-badge-preview.png)

## 其他功能

- 同声传译：系统声音或麦克风、自定义 STT、千问接口模板、模型测试、说话人标签和字幕导出。
- LibreTranslate 离线中英互译：首次从“服务设置”下载环境及模型，之后可离线使用。
- 云端备份：通过自建 OpenList 同步至夸克网盘，也支持 WebDAV 和本地备份。
- 四种背景材质：无、Mica、Acrylic、Apple Liquid Glass 风格模拟；支持窗口置顶。

## 开始使用

1. 从 [Releases](https://github.com/ShengjieLi-CN/Pot-Translate-Next/releases/latest) 下载简体中文 MSI；校验文件随安装包提供。
2. 在“服务设置”配置翻译或离线引擎；在“文字识别”安装本地 RapidOCR 推理模型；同声传译在对应页面配置 STT。
3. 在“热键设置”配置截图及划词快捷键，划词开关与服务选项位于“翻译设置”。

## 推荐配置

1. 翻译：Google翻译+腾讯交互翻译（插件）+硅基流动翻译插件
2. OCR：本地 RapidOCR 推理模型（RapidOCR 3.10.0 / PP-OCRv6），安装后无需 API Key。
3. 翻译插件可在 pot translate 插件官网查找。
4. 云端服务需要自行提供凭据，发布文件不含个人配置。窗口材质取决于 Windows 支持情况；首次安装运行时或离线模型可能需要联网。

## 开发与许可

源码位于 `pot-desktop/`。本地构建使用 `pot-desktop/.scripts/build-local.ps1`，中文版 MSI 使用 `pot-desktop/.scripts/build-msi.ps1`。前端验证：在 `pot-desktop/` 下运行 `pnpm test`。

- [模块结构与接口约定](docs/ARCHITECTURE.md)
- [开发环境与回归验证](docs/DEVELOPMENT.md)
- [构建、校验与 GitHub Release 发布](docs/RELEASING.md)

仅维护和发布简体中文版，翻译语言仍支持多语种。详细更新、安装说明及已知限制请查看各版本 [Release 页面](https://github.com/ShengjieLi-CN/Pot-Translate-Next/releases)。

遵循 [GPL-3.0](pot-desktop/LICENSE) 许可；第三方依赖和模型保留各自许可证。
