# 开发与验证

从外层 `Pot-Translate-Next` 仓库工作，应用源码在 `pot-desktop/`。依赖版本以 `pnpm-lock.yaml` 和 `src-tauri/Cargo.lock` 为准。

## 环境

- Node.js 20 或更新版本、pnpm；当前 Windows 构建使用 Node.js 24 与 pnpm 12.18.0。
- Rust stable MSVC 工具链、rustfmt、Visual Studio C++ Build Tools 和 Windows SDK。
- Windows WebView2 Runtime。正式安装包仅构建 Windows x64 简体中文版。
- 在 WSL 编辑和运行 Node 测试时使用 Linux Node。Windows 原生 pnpm 不支持 WSL 的 Linux 工作目录时，在 Windows 本地盘的源码副本中安装依赖和构建。

```powershell
cd pot-desktop
pnpm install --frozen-lockfile
pnpm test
pnpm dev --host 127.0.0.1 --port 5173
```

## 浏览器回归

OCR 回归不使用真实密钥。脚本模拟 Tauri IPC、Paddle 响应和翻译服务，实际运行图片解码、像素检测、布局和窗口逻辑。

保持 Vite 运行，在第二个 PowerShell 中执行：

```powershell
# 从仓库根目录安装独立测试工具；.tools 已被忽略。
npm install --prefix .tools/ui playwright@1.56.1
$env:NODE_PATH = (Resolve-Path .tools/ui/node_modules).Path
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
cd pot-desktop
pnpm run test:ui:ocr
```

可通过 `UI_URL` 指定其他开发服务地址；没有 Chrome 时可用 Playwright 安装的 Chromium，并将 `CHROME_PATH` 指向其可执行文件。Linux 使用对应的环境变量写法，测试工具应由 Linux npm 安装。

| 验证入口 | 覆盖行为 |
| --- | --- |
| `pnpm test` | OCR 协议、缓存、贴边文字、无空格圆点、原图像素分段、多栏、并发与取消，以及划词、字幕、更新判断 |
| `.scripts/verify-paddle-screenshot-ui.cjs` | Paddle 设置保存、三个识别入口、缺失密钥及旧提供商配置忽略 |
| `.scripts/verify-screenshot-ui.cjs` | 框选、原图对照、复制、服务切换、重试、重新截图与空结果 |
| `.scripts/verify-complex-screenshot-ui.cjs` | 复杂图文、颜色遮罩、150% DPI 与文字自适应 |
| `.scripts/verify-bullet-screenshot-ui.cjs` | 四项/七项、深浅背景、OCR 漏圆点、独立翻译与复制段落 |
| `.scripts/verify-speech-ui.cjs` | 复现有道 500 字节数组、启用服务失败切换、火山长文分段、三个朗读入口与语言/配置传递 |
| `.scripts/verify-selection-ui.cjs` 等 | 对应划词、自动输入、备份、同声传译及升级界面 |

部分旧脚本会更新 `asset/*preview.png`。发布时只提交计划采用的合成演示图，不把调试截图作为源码变更。真实云端验证需要用户自行配置凭据；不要把凭据、个人配置或原始识别结果提交到仓库。

## Windows 原生验证与构建

```powershell
cd pot-desktop
rustup run stable-x86_64-pc-windows-msvc cargo test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --locked
.\.scripts\build-local.ps1
```

依赖真实设备或离线模型的原生测试可能标记为忽略，发布记录应明确实际执行与跳过的数量。MSI 构建、校验和发布请使用 [发布流程](RELEASING.md)。
