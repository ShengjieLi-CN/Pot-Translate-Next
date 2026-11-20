# 模块结构与接口约定

项目由 React 界面和 Tauri 1 / Rust 桌面程序组成，当前维护目标是 Windows x64 简体中文版。翻译服务与 OCR 是独立模块：切换翻译服务不会切换 OCR 提供商。

本轮整理采用 mattpocock `codebase-design` 的原则：将行为集中在小接口之后，让调用方不需要了解网络协议、缓存和分段细节。模块（Module）的接口（Interface）包括输入、结果、错误、取消及性能约定；浏览器/Tauri 适配器（Adapter）在依赖接入点（Seam）连接纯逻辑和运行环境。

## 目录

| 路径 | 职责 |
| --- | --- |
| `pot-desktop/src/window/` | 设置、文字识别、截图、翻译及同声传译窗口 |
| `pot-desktop/src/services/` | 翻译、朗读、收藏与 OCR 的运行环境适配器 |
| `pot-desktop/src/utils/` | OCR 协议、缓存、文本分段、布局、字幕和版本判断等可直接测试的逻辑 |
| `pot-desktop/src-tauri/src/` | 窗口、快捷键、截图、系统音频、配置、插件与升级安装 |
| `pot-desktop/tests/` | Node 自动测试；不依赖个人凭据 |
| `pot-desktop/.scripts/` | 浏览器回归、Windows 构建与安装包校验 |
| `release/` | 发布说明、校验值与验证记录；MSI 在 GitHub Releases 分发 |

## OCR 模块

公共调用入口为 `src/services/recognize/index.jsx`：

- `recognize(base64, language, options)` 返回识别文本；`options.joinLines` 决定是否合并换行，默认保留段落。
- `recognizeLayout(base64, language, options)` 返回 `{ text, lines, width, height }`。每个 `line` 含文本与整行坐标框，不将整行伪装为词级坐标。
- 两个入口均可传 `selection: { provider, config }` 和 `isCurrent`。省略选择时读取 `ocr_provider`（默认 `rapidocr`）及对应的 `rapid_ocr` / `paddle_ocr` 配置。`useOcrConfig` 在界面中提供稳定的选择对象，切换引擎时取消旧任务并使布局缓存失效。`language` 保留调用兼容性。
- `src/utils/ocr_provider.mjs` 负责引擎路由；仅支持 RapidOCR 与 Paddle OCR。本地失败直接返回错误，不自动上传云端。
- `src/utils/ocr_cache.mjs` 负责两种引擎的缓存与订阅取消；`src/utils/paddle_ocr.mjs` 保留云端协议与结果解析。网络请求、时钟和等待可注入。

识别前统一转为 JPEG，最长边不超过 2560 像素；显示和复制仍使用原截图。Paddle 云端默认模型 PP-OCRv5，另支持 PP-OCRv6 和 PP-OCRv5-latin。正常识别、空结果重试及长行补识别共用 60 秒期限。默认检测最长边为 1536，空结果重试为 2560。

`src/utils/paddle_lines.mjs` 在布局前检查异常长行及其置信度。Paddle 可能为超长单行返回非空乱码；此时根据原图像素中的文字间隙分块补识别，再合回该行并保留原坐标与阅读顺序。普通行不增加请求。补识别为空、仍不可靠或找不到安全分界时明确报错，不将残缺内容当作成功结果。取消后不再发送剩余分块请求。

同一窗口只保留一张成功图片的 120 秒内存缓存；图片、所选引擎配置（线程数、模型或密钥）变化会失效。同图请求共享进行中的任务，各调用方独立取消；空结果和错误不缓存。结果下载不携带 API Key。缺少完整坐标时保留全部文字，交给文本布局显示。

RapidOCR 默认使用 3.10.0 与 ONNX Runtime 1.32.0 CPU，模型为包内 PP-OCRv6 small；默认 2 线程，可选 1 / 2 / 4 / 8。`src-tauri/src/rapidocr.rs` 管理独立运行环境、安装进度与持久 Python 子进程，`src-tauri/rapidocr/worker.py` 通过 JSONL stdin/stdout 返回文字、置信度、原图坐标及尺寸，不开启 HTTP 服务。模型首次加载后复用，识别阶段禁用网络连接。

运行环境位于应用本地数据目录的 `rapidocr/<runtime-id>`，不改动系统 Python 或 LibreTranslate 环境。`runtime-lock.json` 固定官方 Python、wheel 与包内模型的版本及 SHA-256。安装器离线推理自检成功后才写就绪标记；设置中提供安装 / 修复按钮和进度。独立环境不打入 MSI，首次使用需下载。

旧配置没有 `ocr_provider` 时默认启用 RapidOCR；保留已保存的引擎选择和 Paddle 凭据。旧提供商列表不会覆盖默认选择；不加载系统 OCR、Tesseract 或 OCR 插件。已有翻译插件继续可用。

## 截图翻译模块

```text
TranslationSurface
  ├─ 读取原截图像素
  ├─ recognizeLayout → RapidOCR 本地 / Paddle 云端结果
  ├─ screenshotBlocks → 原图坐标下的有序文本块
  │    ├─ screenshot_layout：多栏、标题、缩进、列表与行距
  │    └─ screenshot_markers：恢复 OCR 遗漏的圆点位置
  └─ translateScreenshotBlocks → 分块更新并保持原顺序
```

`screenshotBlocks(result, width, height, pixels?)` 是布局调用入口。坐标统一为原截图像素，不使用 CSS 像素；OCR 缩放只在这里映射。像素圆点检测要求重复对齐的紧凑形状，并排除邻栏文字与边框。像素不可用时仍可使用 OCR 文本、几何和行距。文字贴边时保留 OCR 已识别的完整行；无法由 OCR 获得的文字不会凭空补写。

截图窗口并行翻译最多三个文本块；输出按原始索引发布，不按网络返回顺序排列。取消或失败后不再启动剩余请求。翻译重试复用成功识别结果。像素检测、文本分段与翻译重试均不增加云端 OCR 调用。

`TranslationSurface` 负责窗口状态和绘制，纯布局不读取配置、不访问网络。测试从上述接口验证文本、顺序、坐标、取消和并发行为；不为每个内部辅助函数建立同形测试。

## 发布模块

`.scripts/build-msi.ps1` 选择 MSVC 工具链及 `tauri.msi.conf.json`，构建中文 MSI；`.scripts/verify-msi.ps1` 从项目版本推导产物名称，检查语言、架构、升级标识和包内程序哈希。应用更新模块从本项目 GitHub Release 中选择 `_x64_zh-CN.msi`。

其他功能的入口和验证方式见 [开发说明](DEVELOPMENT.md)，完整发布流程见 [发布说明](RELEASING.md)。
