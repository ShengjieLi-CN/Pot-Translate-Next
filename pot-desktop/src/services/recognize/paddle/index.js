import { repairPaddleLines } from '../../../utils/paddle_lines.mjs';
import { fetch, Body } from '@tauri-apps/api/http';
import { store } from '../../../utils/store';
import { requestPaddleOcr, createPaddleRecognizer, formatRecognizedText } from '../../../utils/paddle_ocr.mjs';

export async function preparePaddleImage(base64) {
    const image = new Image();
    image.src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    try {
        await image.decode();
    } catch {
        throw new Error('图片数据无效，请重新截图。');
    }
    // Compress the upload, not the screenshot displayed to the user. Geometry is
    // mapped from the uploaded image dimensions back to the original crop by layout.
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { base64: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height, canvas };
}

const recognizeCached = createPaddleRecognizer(async (base64, config, isCurrent) => {
    // Missing credentials should not spend time decoding a large screenshot.
    if (!config.apiKey) throw new Error('请先在「文字识别 → Paddle OCR」中填写 API Key（AI Studio 访问令牌）。');
    const image = await preparePaddleImage(base64);
    const deadline = Date.now() + 60000;
    const recognize = (base64) =>
        requestPaddleOcr(base64, config, {
            request: fetch,
            formBody: Body.form,
            isCurrent,
            timeoutMs: Math.max(0, deadline - Date.now()),
        });
    const result = await recognize(image.base64);
    let pixels;
    const repaired = await repairPaddleLines(
        result,
        {
            width: image.width,
            height: image.height,
            get pixels() {
                return (pixels ||= image.canvas.getContext('2d').getImageData(0, 0, image.width, image.height).data);
            },
            crop: async ({ x, y, width, height }) => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(image.canvas, x, y, width, height, 0, 0, width, height);
                return canvas.toDataURL('image/jpeg', 0.92);
            },
        },
        { recognize, isCurrent }
    );
    return { ...repaired, width: repaired.width || image.width, height: repaired.height || image.height };
});

export async function recognizeLayout(base64, _language, options = {}) {
    const config = options.config ?? (await store.get('paddle_ocr'));
    return recognizeCached(base64, config, options.isCurrent);
}

export async function recognize(base64, language, options = {}) {
    return formatRecognizedText((await recognizeLayout(base64, language, options)).text, options.joinLines);
}
