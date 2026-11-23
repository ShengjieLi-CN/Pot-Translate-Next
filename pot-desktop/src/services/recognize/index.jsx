import { store } from '../../utils/store';
import { createOcrRouter, formatRecognizedText } from '../../utils/ocr_provider.mjs';
import { recognizeLayout as rapidocr } from './rapidocr';
export const recognizeLayout = createOcrRouter({
    readConfig: (key) => store.get(key),
    providers: { rapidocr },
});
export async function recognize(image, language, options = {}) {
    return formatRecognizedText((await recognizeLayout(image, language, options)).text, options.joinLines);
}
