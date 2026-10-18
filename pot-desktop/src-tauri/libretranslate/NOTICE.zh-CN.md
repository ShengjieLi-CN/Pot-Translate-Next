# LibreTranslate 离线组件

本应用通过独立子进程运行 LibreTranslate 1.9.6，使用原版 `/translate` 路由的进程内测试客户端，不开放监听端口。推理进程在导入和加载模型前禁用网络连接，翻译文本不会发送至网络。

首次安装下载 Python 3.12.10 Windows x64 嵌入式运行环境、固定 Python 依赖，以及 Argos Translate 1.9 的 `en→zh`、`zh→en` 模型和 MiniSBD 分句模型。所有下载均按 `runtime-lock.json` 校验 SHA256。安装成功后无需 Python、Docker、API Key 或网络连接。当前使用 CPU 推理。

第三方源码、许可和原始下载位置：

- LibreTranslate（AGPL-3.0）：https://github.com/LibreTranslate/LibreTranslate/tree/v1.9.6
- Argos Translate：https://github.com/argosopentech/argos-translate
- Argos 模型索引：https://github.com/argosopentech/argospm-index
- MiniSBD：https://github.com/LibreTranslate/MiniSBD
- Python（PSF）：https://www.python.org/downloads/release/python-31210/
- Python 依赖的固定源文件位置及哈希：`runtime-lock.json`。各组件的许可证保存在安装目录 `runtime/Lib/site-packages` 内相应发行包的元数据和许可证文件中；Python 许可证随嵌入式运行环境保存。

组件按各自许可证分发，LibreTranslate 商标及其权利归原权利人所有。应用中使用的 LT 图标为本项目自绘图标。
