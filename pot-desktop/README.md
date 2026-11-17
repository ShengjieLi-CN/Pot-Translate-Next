# Pot Translate Next 应用源码

这是 [Pot Translate Next](../README.md) 的 React / Tauri 应用目录，基于 GPL-3.0 的 Pot Desktop 开发。当前仅维护和发布 Windows x64 简体中文版；翻译语言仍支持多语种。

- 使用与下载：[项目首页](../README.md)
- 模块职责与接口：[架构说明](../docs/ARCHITECTURE.md)
- 开发环境、自动测试和界面回归：[开发说明](../docs/DEVELOPMENT.md)
- 构建 MSI、校验与 GitHub Release：[发布流程](../docs/RELEASING.md)

OCR 统一使用 Paddle 官方云端服务，在“文字识别”页面配置模型与 API Key。旧 OCR 提供商、系统 OCR 和 Tesseract 已移除；翻译、朗读和收藏服务保持独立。

`README_EN.md`、`README_KR.md` 及其他语言资源保留上游资料；本项目的功能和构建方式以根目录中文文档为准。许可证见 [LICENSE](LICENSE)。
