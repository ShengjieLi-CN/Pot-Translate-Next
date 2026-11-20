import { fetch, Body } from '@tauri-apps/api/http';
import { store } from '../../../utils/store';
import { requestPaddleOcr, createPaddleRecognizer, formatRecognizedText } from '../../../utils/paddle_ocr.mjs';
import { recognizePreparedImage } from '../image';
export { prepareOcrImage as preparePaddleImage } from '../image';

const recognizeCached = createPaddleRecognizer(async (base64, config, isCurrent) => {
    if (!config.apiKey) throw new Error('请先在「文字识别 → Paddle OCR」中填写 API Key（AI Studio 访问令牌）。');
    const deadline = Date.now() + 60000;
    return recognizePreparedImage(
        base64,
        (image) =>
            requestPaddleOcr(image, config, {
                request: fetch,
                formBody: Body.form,
                isCurrent,
                timeoutMs: Math.max(0, deadline - Date.now()),
            }),
        isCurrent
    );
});
export async function recognizeLayout(base64, _language, options = {}) {
    const config = options.config ?? (await store.get('paddle_ocr'));
    return recognizeCached(base64, config, options.isCurrent);
}
export async function recognize(base64, language, options = {}) {
    return formatRecognizedText((await recognizeLayout(base64, language, options)).text, options.joinLines);
}
