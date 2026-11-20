import { store } from '../../utils/store';
import { createOcrRouter } from '../../utils/ocr_provider.mjs';
import { formatRecognizedText } from '../../utils/paddle_ocr.mjs';
import { recognizeLayout as paddle } from './paddle';
import { recognizeLayout as rapidocr } from './rapidocr';
export const recognizeLayout = createOcrRouter({
    readConfig: (key) => store.get(key),
    providers: { rapidocr, paddle },
});
export async function recognize(image, language, options = {}) {
    return formatRecognizedText((await recognizeLayout(image, language, options)).text, options.joinLines);
}
