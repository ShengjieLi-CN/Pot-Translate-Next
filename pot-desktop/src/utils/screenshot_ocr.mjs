import Tesseract from 'tesseract.js';
import { unionBox } from './screenshot_layout.mjs';

export function needsEnglishScreenshotFallback(result) {
    if (result.englishAvailable !== false) return false;
    const text = (result.lines || []).map((l) => l.text || '').join(' ');
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    return latin >= 20 && latin > cjk * 3;
}

export async function recognizeEnglishScreenshot(base64, result = null) {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const width = image.naturalWidth,
        height = image.naturalHeight;
    // Do not let a large logo determine the DPI/font size of small email text.
    // Re-recognise the native detector's individual rows with a single worker.
    const regions =
        result?.lines?.flatMap((line) => {
            const words = (line.words || []).filter((w) => w.box && w.box.width > 0 && w.box.height > 0);
            if (!words.length) return [];
            const latinWords = words.filter((w) => /[A-Za-z]/.test(w.text));
            const heights = latinWords.map((w) => w.box.height).sort((a, b) => a - b);
            const typical = heights[Math.floor(heights.length / 2)];
            // A logo icon may be hallucinated as one tall Chinese glyph. Keep its
            // pixels out of the English text row instead of masking the whole logo.
            const rowWords = typical
                ? words.filter((w) => !/[\u3400-\u9fff]/.test(w.text) || w.box.height < typical * 1.4)
                : words;
            if (!rowWords.length) return [];
            const box = unionBox(rowWords);
            // A detector can miss the last few small words. Leave horizontal room
            // for the second recognizer instead of baking the first pass's loss in.
            const margin = Math.max(12, Math.min(64, box.height * 4));
            const x = Math.max(0, Math.floor(box.x - margin)),
                y = Math.max(0, Math.floor(box.y - 4));
            return [
                {
                    x,
                    y,
                    width: Math.min(width, Math.ceil(box.x + box.width + margin)) - x,
                    height: Math.min(height, Math.ceil(box.y + box.height + 4)) - y,
                    original: { ...line, words: rowWords, text: rowWords.map((w) => w.text).join(' ') },
                },
            ];
        }) || [];
    if (!regions.length) regions.push({ x: 0, y: 0, width, height });
    const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: '/worker.min.js',
        corePath: '/tesseract-core-simd-lstm.wasm.js',
        langPath: new URL('/ocr', window.location.href).href,
        gzip: false,
        cacheMethod: 'none',
    });
    const lines = [];
    try {
        await worker.setParameters({
            tessedit_pageseg_mode: result?.lines?.length ? '7' : '11',
            user_defined_dpi: '150',
        });
        for (const region of regions) {
            const scale = Math.min(3, 4096 / Math.max(region.width, region.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(region.width * scale);
            canvas.height = Math.ceil(region.height * scale);
            const sx = canvas.width / region.width,
                sy = canvas.height / region.height;
            canvas
                .getContext('2d')
                .drawImage(image, region.x, region.y, region.width, region.height, 0, 0, canvas.width, canvas.height);
            const { data } = await worker.recognize(canvas);
            const convert = (b) => ({
                x: region.x + b.x0 / sx,
                y: region.y + b.y0 / sy,
                width: (b.x1 - b.x0) / sx,
                height: (b.y1 - b.y0) / sy,
            });
            const recognized = (data.lines || [])
                .filter((line) => line.confidence >= 35 && line.text.trim())
                .map((line) => ({
                    text: line.text.trim(),
                    box: convert(line.bbox),
                    words: line.words.map((word) => ({ text: word.text, box: convert(word.bbox) })),
                }));
            const before = (region.original?.text.match(/[A-Za-z]/g) || []).length;
            const after = (
                recognized
                    .map((l) => l.text)
                    .join(' ')
                    .match(/[A-Za-z]/g) || []
            ).length;
            if (recognized.length && (!before || after >= before * 0.55)) lines.push(...recognized);
            else if (region.original) lines.push(region.original);
        }
    } finally {
        await worker.terminate();
    }
    return { width, height, lines };
}
