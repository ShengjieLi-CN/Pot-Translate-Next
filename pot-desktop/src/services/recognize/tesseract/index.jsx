import Tesseract from 'tesseract.js';
import { Language } from './info';

export async function recognize(base64, language) {
    const {
        data: { text },
    } = await Tesseract.recognize('data:image/png;base64,' + base64, language, {
        workerPath: '/worker.min.js',
        corePath: '/tesseract-core-simd-lstm.wasm.js',
        langPath: 'https://pub-f6afb74f13c64cd89561b4714dca1c27.r2.dev',
    });
    if (language === Language.zh_cn || language === Language.zh_tw) {
        return text.replaceAll(' ', '').trim();
    } else {
        return text.trim();
    }
}

export * from './Config';
export * from './info';

export async function recognizeLayout(base64, language) {
    const { data } = await Tesseract.recognize('data:image/png;base64,' + base64, language, {
        workerPath: '/worker.min.js',
        corePath: '/tesseract-core-simd-lstm.wasm.js',
        langPath: 'https://pub-f6afb74f13c64cd89561b4714dca1c27.r2.dev',
    });
    const box = (b) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
    return {
        text: data.text,
        lines: (data.paragraphs ?? []).flatMap((paragraph, index) =>
            paragraph.lines.map((line) => ({
                text: line.text,
                paragraph: index,
                box: box(line.bbox),
                words: line.words.map((word) => ({ text: word.text, box: box(word.bbox) })),
            }))
        ),
    };
}
