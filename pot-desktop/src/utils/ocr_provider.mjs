export const DEFAULT_OCR_PROVIDER = 'rapidocr';
export const DEFAULT_RAPID_CONFIG = Object.freeze({ threads: 2 });
export const OCR_LABELS = Object.freeze({ rapidocr: 'RapidOCR', paddle: 'Paddle OCR' });

export function createOcrRouter({ readConfig, providers }) {
    return async (image, language, options = {}) => {
        const isCurrent = options.isCurrent || (() => true);
        const check = () => {
            if (!isCurrent()) throw new Error('已取消文字识别。');
        };
        check();
        const provider = options.selection?.provider ?? (await readConfig('ocr_provider')) ?? DEFAULT_OCR_PROVIDER;
        if (!Object.hasOwn(providers, provider)) throw new Error('请选择有效的默认 OCR 引擎。');
        const config =
            options.selection?.config ?? (await readConfig(provider === 'rapidocr' ? 'rapid_ocr' : 'paddle_ocr'));
        check();
        const result = await providers[provider](image, language, { ...options, config, isCurrent });
        check();
        return result;
    };
}
