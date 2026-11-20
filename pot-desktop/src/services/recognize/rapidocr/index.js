import { invoke } from '@tauri-apps/api/tauri';
import { createOcrRecognizer } from '../../../utils/ocr_cache.mjs';
import { recognizePreparedImage } from '../image';
const cached = createOcrRecognizer((image, config, isCurrent) =>
    recognizePreparedImage(
        image,
        async (image) => {
            if (!isCurrent()) throw new Error('已取消文字识别。');
            return invoke('rapidocr_recognize', { image, threads: config.threads });
        },
        isCurrent
    )
);
export function recognizeLayout(image, _language, options = {}) {
    const threads = options.config?.threads ?? 2;
    if (![1, 2, 4, 8].includes(threads)) throw new Error('请选择有效的 RapidOCR CPU 线程数。');
    return cached(image, { threads }, options.isCurrent);
}
