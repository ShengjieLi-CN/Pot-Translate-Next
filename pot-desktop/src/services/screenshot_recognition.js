import { writeBinaryFile, removeFile } from '@tauri-apps/api/fs';
import { join } from '@tauri-apps/api/path';
import { invoke_plugin } from '../utils/invoke_plugin';
import { paddleScreenshotLayout } from '../utils/screenshot_layout.mjs';

export async function recognizeScreenshotPlugin(ocr, capture, language, isCurrent, autoLanguage = false) {
    const [recognize, utils] = await invoke_plugin('recognize', ocr.name);
    if (!isCurrent()) return null;
    if (ocr.name !== 'plugin.com.pot-app.paddle' || utils.osType !== 'Windows_NT') {
        return recognize(capture.base64, language, { config: ocr.config, utils });
    }
    // The existing Paddle plugin flattens its JSON into text and ignores its
    // base64 argument. Intercept this screenshot request only: retain geometry
    // and give the process a private snapshot instead of the shared cache crop.
    const image = new Image();
    image.src = `data:image/png;base64,${capture.base64}`;
    await image.decode();
    const factor = Math.max(image.naturalWidth, image.naturalHeight) <= 2048 ? 2 : 1;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth * factor;
    canvas.height = image.naturalHeight * factor;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL('image/png').split(',')[1];
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const path = await join(utils.cacheDir, `screenshot-layout-${crypto.randomUUID()}.png`);
    let raw;
    try {
        await writeBinaryFile(path, bytes);
        if (!isCurrent()) return null;
        const run = async (binary, args) => {
            const rewritten = args.filter(
                (arg) => !arg.startsWith('--image_path=') && !arg.startsWith('--limit_side_len=')
            );
            rewritten.push(`--image_path=${path}`, `--limit_side_len=${Math.max(4096, canvas.width, canvas.height)}`);
            const output = await utils.run(binary, rewritten);
            if (output.status === 0) raw = paddleScreenshotLayout(output.stdout, canvas.width, canvas.height);
            return output;
        };
        try {
            await recognize(capture.base64, language, { config: ocr.config, utils: { ...utils, run } });
        } catch (error) {
            if (!raw) throw error;
        }
        if (!raw) throw new Error('Paddle OCR 未返回有效的位置数据。请重试或切换 OCR 服务。');
        const text = raw.lines.map((line) => line.text).join(' ');
        const latin = (text.match(/[A-Za-z]/g) || []).length;
        const chinese = (text.match(/[\u3400-\u9fff]/g) || []).length;
        if (
            autoLanguage &&
            language === 'chinese' &&
            ocr.Language.en &&
            latin >= 20 &&
            latin > chinese * 3 &&
            isCurrent()
        ) {
            const primary = raw;
            try {
                await recognize(capture.base64, ocr.Language.en, { config: ocr.config, utils: { ...utils, run } });
            } catch {
                raw = primary;
            }
            const recovered = (
                raw.lines
                    .map((line) => line.text)
                    .join(' ')
                    .match(/[A-Za-z]/g) || []
            ).length;
            if (recovered < latin * 0.8) raw = primary;
        }
        return raw;
    } finally {
        await removeFile(path).catch(() => {});
    }
}
