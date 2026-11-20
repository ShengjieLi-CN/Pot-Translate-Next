# RapidOCR 本地识别

本组件使用 RapidAI/RapidOCR 3.10.0 和 ONNX Runtime 1.32.0（CPU）。
运行环境、Python 包及随 wheel 提供的 PP-OCRv6 small 检测/识别模型均通过 runtime-lock.json 固定版本与 SHA-256。
首次下载需要联网；识别进程使用本地模型，禁用网络连接，不上传图片。无需用户安装 Python 或填写 API Key。

项目与许可证：
- https://github.com/RapidAI/RapidOCR （Apache-2.0）
- https://rapidai.github.io/RapidOCRDocs/main/model_licenses/ （模型许可与归属）
- https://github.com/microsoft/onnxruntime （MIT）
- https://www.python.org （Python Software Foundation License）

许可证及第三方归属文件随官方包保存在 runtime/Lib/site-packages 下。
