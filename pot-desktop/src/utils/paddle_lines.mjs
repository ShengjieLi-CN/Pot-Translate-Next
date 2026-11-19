// The recognizer can return a few plausible-looking characters for an extremely
// wide line. Repair from its pixels before layout can mask the original text.
function needsRepair(line) {
    const box = line.box;
    if (!box || box.height <= 0 || !Number.isFinite(box.width / box.height)) return false;
    const aspect = box.width / box.height;
    return aspect >= 80 || (aspect >= 40 && (line.confidence < 0.8 || Array.from(line.text.trim()).length < aspect));
}

const incomplete = () => new Error('部分长行未能完整识别，请缩小截图范围后重试。');
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

function cropsFor(line, result, image) {
    const sx = image.width / (result.width || image.width),
        sy = image.height / (result.height || image.height);
    const x = Math.max(0, Math.floor(line.box.x * sx));
    let right = Math.min(image.width, Math.ceil((line.box.x + line.box.width) * sx));
    const y = Math.max(0, Math.floor(line.box.y * sy));
    const bottom = Math.min(image.height, Math.ceil((line.box.y + line.box.height) * sy));
    const top = Math.max(0, y - 3),
        lower = Math.min(image.height, bottom + 3),
        h = bottom - y;
    if (h <= 0 || right <= x) throw incomplete();
    const colors = [[], [], []];
    for (let px = x; px < right; px += Math.max(1, Math.floor((right - x) / 100))) {
        for (const py of [top, lower - 1]) {
            const offset = (py * image.width + px) * 4;
            for (let c = 0; c < 3; c++) colors[c].push(image.pixels[offset + c]);
        }
    }
    const background = colors.map(median),
        blank = new Uint8Array(right - x);
    for (let px = x; px < right; px++) {
        let ink = false;
        for (let py = y; py < bottom; py++) {
            const offset = (py * image.width + px) * 4;
            if (
                image.pixels[offset + 3] > 128 &&
                background.some((v, c) => Math.abs(v - image.pixels[offset + c]) > 48)
            ) {
                ink = true;
                break;
            }
        }
        blank[px - x] = ink ? 0 : 1;
    }
    // OCR boxes can end in whitespace. Do not send a trailing blank-only crop.
    while (right > x && blank[right - x - 1]) right--;
    if (right <= x) throw incomplete();
    // Only split in actual gaps; never cut a glyph or truncate a text tail.
    const limit = Math.max(160, Math.min(1000, h * 40));
    const crops = [];
    let start = x,
        separator = '';
    while (right - start > limit) {
        let best = null;
        const from = Math.ceil(start + limit * 0.6),
            to = Math.floor(start + limit);
        for (let pos = from; pos <= to; ) {
            if (!blank[pos - x]) {
                pos++;
                continue;
            }
            const begin = pos;
            while (pos <= to && blank[pos - x]) pos++;
            const gap = pos - begin;
            if (gap >= 2 && (!best || gap >= best.gap)) best = { end: Math.floor((begin + pos) / 2), gap };
        }
        if (!best) throw incomplete();
        crops.push({
            x: crops.length ? start : Math.max(0, start - 3),
            y: top,
            width: best.end - (crops.length ? start : Math.max(0, start - 3)),
            height: lower - top,
            separator,
        });
        start = best.end;
        separator = best.gap >= Math.max(3, h * 0.17) ? ' ' : '';
    }
    crops.push({
        x: crops.length ? start : Math.max(0, start - 3),
        y: top,
        width: Math.min(image.width, right + 3) - (crops.length ? start : Math.max(0, start - 3)),
        height: lower - top,
        separator,
    });
    return crops;
}

export async function repairPaddleLines(result, image, { recognize, isCurrent = () => true }) {
    if (!result.lines?.some(needsRepair)) return result;
    const check = () => {
        if (!isCurrent()) throw new Error('已取消文字识别。');
    };
    const lines = [];
    for (const line of result.lines) {
        check();
        if (!needsRepair(line)) {
            lines.push(line);
            continue;
        }
        let text = '';
        for (const { separator, ...rect } of cropsFor(line, result, image)) {
            check();
            const base64 = await image.crop(rect);
            check();
            const recovered = await recognize(base64);
            check();
            const part = String(recovered.text || '')
                .replace(/\s*\n\s*/g, ' ')
                .trim();
            if (!part || recovered.lines?.some(needsRepair)) throw incomplete();
            const cjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u;
            const gap = cjk.test(text.slice(-1)) && cjk.test(part[0]) ? '' : separator;
            text += gap + part;
        }
        const repaired = { ...line, text };
        delete repaired.confidence;
        lines.push(repaired);
    }
    return { ...result, lines, text: lines.map((line) => line.text).join('\n') };
}
