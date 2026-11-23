export const DEFAULT_OCR_PROVIDER = 'rapidocr';
export const DEFAULT_RAPID_CONFIG = Object.freeze({ threads: 2 });
export const OCR_LABELS = Object.freeze({ rapidocr: 'RapidOCR' });

export function formatRecognizedText(text, joinLines = false) {
    return joinLines ? text.replace(/-\s+/g, '').replace(/\s+/g, ' ').trim() : text.trim();
}

export function createOcrRouter({ readConfig, providers }) {
    return async (image, language, options = {}) => {
        const isCurrent = options.isCurrent || (() => true);
        const check = () => {
            if (!isCurrent()) throw new Error('已取消文字识别。');
        };
        check();
        const provider = DEFAULT_OCR_PROVIDER;
        if (!Object.hasOwn(providers, provider)) throw new Error('本地 RapidOCR 引擎不可用。');
        const config = options.selection?.config ?? (await readConfig('rapid_ocr'));
        check();
        const result = await providers[provider](image, language, { ...options, config, isCurrent });
        check();
        return result;
    };
}
