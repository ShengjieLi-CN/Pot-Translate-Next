import { screenshotBulletStarts } from './screenshot_markers.mjs';

// Geometry always uses original crop pixels, never CSS pixels or OCR enlargement.
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 16;
const heading = (text) =>
    /^(?:abstract|introduction|methods?|results?|discussion|background|conclusions?|references|摘要|引言|方法|结果|讨论|结论|参考文献)[.:：]?$/i.test(
        text.trim()
    );
export const unionBox = (items) => {
    const x = Math.min(...items.map((w) => w.box.x)),
        y = Math.min(...items.map((w) => w.box.y));
    return {
        x,
        y,
        width: Math.max(...items.map((w) => w.box.x + w.box.width)) - x,
        height: Math.max(...items.map((w) => w.box.y + w.box.height)) - y,
    };
};
const valid = (b) =>
    b && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(b[k])) && b.width > 0 && b.height > 0;
const overlap = (a, b) =>
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const joinWords = (words) =>
    words
        .map((w) => w.text)
        .join(' ')
        .replace(/([\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g, '$1');

// Numbered slides use hanging indents and sometimes very wide justified gaps.
// Reassemble only confirmed, aligned list lanes; ordinary columns keep their gaps.
function numberedListFragments(fragments, width) {
    const number = (f) => /^\d{1,3}[.)、]?$/.test(f.text.trim());
    const candidates = fragments.filter(number);
    const anchors = candidates.filter((a) => candidates.some((b) =>
        a !== b && Math.abs(a.box.x - b.box.x) < Math.min(a.fontHeight, b.fontHeight) &&
        Math.abs(parseInt(a.text) - parseInt(b.text)) === 1 && Math.abs(a.box.y - b.box.y) < a.fontHeight * 12));
    const used = new Set(), output = [];
    const center = (f) => f.box.y + f.box.height / 2;
    for (const anchor of anchors.sort((a,b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
        const next = anchors.filter((b) => b.box.y > anchor.box.y + anchor.fontHeight && Math.abs(b.box.x-anchor.box.x)<anchor.fontHeight)
            .sort((a,b)=>a.box.y-b.box.y)[0];
        const right = anchors.filter((b) => b.box.x > anchor.box.x + anchor.fontHeight*8 && Math.abs(center(b)-center(anchor))<anchor.fontHeight)
            .reduce((x,b)=>Math.min(x,b.box.x-anchor.fontHeight),width);
        const rows = [];
        const eligible = fragments.filter((f) => f !== anchor && !number(f) && !used.has(f) &&
            f.box.x >= anchor.box.x + anchor.box.width && f.box.x < right &&
            center(f) >= center(anchor)-anchor.fontHeight*0.6 &&
            (!next || center(f)<center(next)-anchor.fontHeight*0.6) &&
            Math.max(f.fontHeight,anchor.fontHeight)/Math.min(f.fontHeight,anchor.fontHeight)<1.6);
        for (const f of eligible.sort((a,b)=>center(a)-center(b) || a.box.x-b.box.x)) {
            const row=rows.find((row)=>Math.abs(center(row[0])-center(f))<Math.min(row[0].fontHeight,f.fontHeight)*0.6);
            if(row) row.push(f); else rows.push([f]);
        }
        let previous=null, indent=null;
        for(const row of rows) {
            row.sort((a,b)=>a.box.x-b.box.x);
            const box=unionBox(row), size=median(row.map(f=>f.fontHeight));
            if(!previous && (Math.abs(center(row[0])-center(anchor))>size*0.7 || row[0].box.x-anchor.box.x-anchor.box.width>size*5)) break;
            if(previous && (box.y-previous.box.y-previous.box.height>size || Math.abs(box.x-indent)>size*1.3 || /[.!?。！？]\s*$/.test(previous.text))) break;
            indent ??=box.x;
            const combined={...row[0], text:joinWords(row), box, fontHeight:size, listItem:anchor};
            output.push(combined);row.forEach(f=>used.add(f));previous=combined;
        }
    }
    return [...fragments.filter(f=>!used.has(f)),...output];
}

// Repeated narrow whitespace lanes are real column gutters even when they are
// smaller than the font-based word-joining threshold (common in zoomed PDFs).
function columnGutters(fragments) {
    const gaps = [];
    for (const left of fragments) {
        for (const right of fragments) {
            const size = Math.min(left.fontHeight, right.fontHeight);
            const start = left.box.x + left.box.width, end = right.box.x;
            if (end - start < Math.max(10, size * 0.6) || left.box.width < size * 6 || right.box.width < size * 6 ||
                Math.abs(left.box.y - right.box.y) > size * 0.6) continue;
            gaps.push({ start, end, y: Math.min(left.box.y, right.box.y), size });
        }
    }
    const gutters = [];
    for (const gap of gaps) {
        const x = (gap.start + gap.end) / 2;
        if (gutters.some((g) => Math.abs(g.x - x) < gap.size * 0.5)) continue;
        const rows = gaps.filter((g) => g.start <= x && g.end >= x);
        const top = Math.min(...rows.map((g) => g.y)), bottom = Math.max(...rows.map((g) => g.y));
        if (rows.length >= 3 && bottom - top > gap.size * 2) gutters.push({ x, top: top - gap.size, bottom: bottom + gap.size });
    }
    return gutters;
}

// Paddle often omits small bullet glyphs. Learn the normal line pitch in each
// aligned text lane so the slightly larger gap between slide items still counts
// as a paragraph break. Use row centres: bold text and descenders change ink-box
// heights enough that the empty gap alone is unreliable.
function paragraphStarts(lines) {
    const bullet = (text) => /^[•●▪◦‣⁃·](?:\s|$)/u.test(text.trim());
    const center = (line) => line.box.y + line.box.height / 2;
    const sameLane = (a, b) =>
        Math.abs(a.box.x - b.box.x) <= Math.min(a.fontHeight, b.fontHeight) * 0.65 &&
        Math.max(a.fontHeight, b.fontHeight) <= Math.min(a.fontHeight, b.fontHeight) * 1.35 &&
        Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x) >=
            Math.min(a.box.width, b.box.width) * 0.5;
    const pairs = lines.flatMap((previous) => {
        const next = lines.filter((line) => sameLane(previous, line) &&
            line.box.y >= previous.box.y + previous.box.height - previous.fontHeight * 0.15)
            .sort((a, b) => a.box.y - b.box.y)[0];
        if (!next) return [];
        const pitch = center(next) - center(previous);
        return pitch <= Math.min(previous.fontHeight, next.fontHeight) * 2 ? [{ previous, next, pitch }] : [];
    });
    const starts = new Set(lines.filter((line) => bullet(line.text)));
    for (const { previous, next, pitch } of pairs) {
        if (!/[.!?。！？][”’"')\]]?\s*$/.test(previous.text) || previous.listItem || next.listItem) continue;
        const nearby = pairs.filter((pair) => sameLane(previous, pair.previous) &&
            Math.abs(center(previous) - center(pair.previous)) < previous.fontHeight * 20);
        if (nearby.length < 4) continue;
        const typicalPitch = median(nearby.map((pair) => pair.pitch));
        if (pitch > typicalPitch * 1.12 && pitch - typicalPitch > previous.fontHeight * 0.12)
            starts.add(next);
    }
    // A detected marker can be a separate, much smaller OCR box than its text.
    for (const marker of lines.filter((line) => /^[•●▪◦‣⁃·]$/u.test(line.text.trim()))) {
        const body = lines.filter((line) => line.box.x > marker.box.x + marker.box.width &&
            line.box.x - marker.box.x - marker.box.width < line.fontHeight * 3 &&
            Math.abs(center(line) - center(marker)) < line.fontHeight * 0.6)
            .sort((a, b) => a.box.x - b.box.x)[0];
        if (body) starts.add(body);
    }
    return starts;
}

export function layoutScreenshotBlocks(result, width, height, restore, pixels) {
    const sx = width / (Number(result.width) || width),
        sy = height / (Number(result.height) || height);
    const mapBox = (b) => (valid(b) ? { x: b.x * sx, y: b.y * sy, width: b.width * sx, height: b.height * sy } : null);
    const seen = [],
        fragments = [];
    for (const input of result.lines) {
        const lineBox = mapBox(input.box);
        const words = (input.words || []).flatMap((word) => {
            const b = mapBox(word.box);
            if (!b || !word.text?.trim()) return [];
            // Complete Tesseract line bounds override overlarge word baselines.
            if (
                !(
                    (lineBox?.x > 0.5 || b.x > 0.5) &&
                    (lineBox?.y > 0.5 || b.y > 0.5) &&
                    ((lineBox && lineBox.x + lineBox.width < width - 0.5) || b.x + b.width < width - 0.5) &&
                    ((lineBox && lineBox.y + lineBox.height < height - 0.5) || b.y + b.height < height - 0.5)
                )
            )
                return [];
            const text = word.text.trim();
            if (
                seen.some(
                    (w) =>
                        w.text === text &&
                        overlap(w.box, b) > Math.min(w.box.width * w.box.height, b.width * b.height) * 0.55
                )
            )
                return [];
            const item = { text, box: b };
            seen.push(item);
            return [item];
        });
        if (!words.length) {
            if (!input.words?.length && lineBox && input.text?.trim())
                fragments.push({ ...input, box: lineBox, fontHeight: lineBox.height });
            continue;
        }
        // An OCR "line" may contain a large logo and several unrelated rows.
        // Split by baseline before sorting horizontally, then split wide gaps.
        const rows = lineBox ? [words] : [];
        for (const word of lineBox
            ? []
            : [...words].sort((a, b) => a.box.y + a.box.height / 2 - b.box.y - b.box.height / 2)) {
            const row = rows.find(
                (r) =>
                    Math.abs(r[0].box.y + r[0].box.height / 2 - word.box.y - word.box.height / 2) <
                        Math.min(r[0].box.height, word.box.height) * 0.65 &&
                    Math.max(r[0].box.height, word.box.height) / Math.min(r[0].box.height, word.box.height) < 1.5
            );
            if (row) row.push(word);
            else rows.push([word]);
        }
        const segments = [];
        for (const row of rows) {
            let segment = [];
            for (const word of row.sort((a, b) => a.box.x - b.box.x)) {
                const last = segment.at(-1);
                if (
                    last &&
                    word.box.x - last.box.x - last.box.width > Math.max(10, median(row.map((w) => w.box.height)) * 2.2)
                ) {
                    segments.push(segment);
                    segment = [];
                }
                segment.push(word);
            }
            if (segment.length) segments.push(segment);
        }
        for (const segment of segments) {
            const complete = segments.length === 1 && words.length === input.words.length && lineBox;
            fragments.push({
                text: complete && input.text?.trim() ? input.text.trim() : joinWords(segment),
                box: complete ? lineBox : unionBox(segment),
                paragraph: input.paragraph,
                fontHeight: complete ? lineBox.height : median(segment.map((w) => w.box.height)),
            });
        }
    }
    // Overlapping tiles may return partial copies of the same row. Rejoin only
    // fragments on the same baseline with ordinary inter-word spacing.
    const gutters = columnGutters(fragments);
    const lines = [];
    for (const fragment of numberedListFragments(fragments, width).sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
        const previous = lines.find(
            (l) =>
                Math.abs(l.box.y - fragment.box.y) < Math.min(l.fontHeight, fragment.fontHeight) * 0.35 &&
                fragment.box.x >= l.box.x + l.box.width - 1 &&
                fragment.box.x - l.box.x - l.box.width < Math.min(l.fontHeight, fragment.fontHeight) * 1.5 &&
                Math.abs(l.fontHeight - fragment.fontHeight) < l.fontHeight * 0.3 &&
                l.paragraph === fragment.paragraph &&
                l.listItem === fragment.listItem &&
                !gutters.some((g) => g.x > l.box.x + l.box.width && g.x < fragment.box.x &&
                    fragment.box.y >= g.top && fragment.box.y <= g.bottom)
        );
        if (previous) {
            previous.text += ` ${fragment.text}`;
            previous.box = unionBox([previous, fragment]);
        } else lines.push({ ...fragment });
    }
    const starts = paragraphStarts(lines);
    for (const line of screenshotBulletStarts(lines, pixels, width, height)) starts.add(line);
    const typical = median(lines.map((l) => l.fontHeight)),
        groups = [];
    for (const line of lines) {
        let best = null,
            score = Infinity;
        for (const group of groups) {
            const last = group.at(-1),
                a = last.box,
                b = line.box;
            const gap = b.y - a.y - a.height,
                size = Math.min(last.fontHeight, line.fontHeight);
            if (
                /^\d{1,3}[.)、]?$/.test(last.text.trim()) ||
                /^\d{1,3}[.)、]?$/.test(line.text.trim()) ||
                last.listItem !== line.listItem ||
                starts.has(line) ||
                heading(last.text) ||
                heading(line.text) ||
                gap < -size * 0.15 ||
                gap > size * 0.85 ||
                Math.abs(last.fontHeight - line.fontHeight) > size * 0.3 ||
                Math.abs(a.x - b.x) > size * 1.2 ||
                (b.x - a.x > size * 0.65 && /[.!?。！？]\s*$/.test(last.text) && !line.listItem) ||
                Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) < Math.min(a.width, b.width) * 0.5 ||
                (line.paragraph != null && last.paragraph != null && line.paragraph !== last.paragraph)
            )
                continue;
            // Never build a paragraph through another card, caption or row.
            const box = unionBox([...group, line]);
            if (
                lines.some(
                    (other) =>
                        other !== line &&
                        !group.includes(other) &&
                        overlap(box, other.box) > other.box.width * other.box.height * 0.3
                )
            )
                continue;
            const distance = Math.max(0, gap) + Math.abs(a.x - b.x) * 0.2;
            if (distance < score) {
                best = group;
                score = distance;
            }
        }
        if (best) best.push(line);
        else groups.push([line]);
    }
    const blocks = groups.map((group) => {
        const box = unionBox(group),
            text = restore(group.map((l) => l.text).join('\n'));
        return {
            text,
            box,
            fontHeight: median(group.map((l) => l.fontHeight)),
            kind:
                heading(text) || (text.length <= 100 && group.length <= 3 && box.height / group.length > typical * 1.25)
                    ? 'heading'
                    : 'paragraph',
        };
    });
    // Recursive whitespace cuts handle multiple columns and tables without
    // assuming that the entire screenshot is a two-column PDF.
    const order = (items) => {
        if (items.length < 2) return items;
        const sorted = [...items].sort((a, b) => a.box.x - b.box.x);
        let right = sorted[0].box.x + sorted[0].box.width;
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].box.x - right > Math.max(12, typical * 1.5) ||
                gutters.some((g) => g.x > right && g.x < sorted[i].box.x))
                return [...order(sorted.slice(0, i)), ...order(sorted.slice(i))];
            right = Math.max(right, sorted[i].box.x + sorted[i].box.width);
        }
        return [...items].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    };
    return order(blocks).map((block, id) => ({ ...block, id }));
}

export function screenshotBackground(pixels, width, height, box) {
    const samples = [];
    const sample = (x, y) => {
        x = Math.max(0, Math.min(width - 1, Math.round(x)));
        y = Math.max(0, Math.min(height - 1, Math.round(y)));
        const i = (y * width + x) * 4;
        if (pixels[i + 3] > 0) samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    };
    for (let i = 0; i <= 12; i++) {
        const x = box.x + (box.width * i) / 12;
        sample(x, box.y - 2);
        sample(x, box.y + box.height + 2);
    }
    const buckets = new Map();
    for (const color of samples) {
        const key = color.map((v) => Math.floor(v / 32)).join(',');
        const list = buckets.get(key) || [];
        list.push(color);
        buckets.set(key, list);
    }
    const colors = [...buckets.values()].sort((a, b) => b.length - a.length)[0] || [[255, 255, 255]];
    const rgb = [0, 1, 2].map((c) => median(colors.map((color) => color[c])));
    return {
        background: `rgb(${rgb.join(', ')})`,
        color: rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 140 ? '#fff' : '#172033',
    };
}

export function paddleScreenshotLayout(stdout, width, height) {
    // Paddle writes startup/progress messages before its one-line JSON result.
    let result;
    for (const line of String(stdout).split(/\r?\n/).reverse()) {
        try {
            const parsed = JSON.parse(line.trim());
            if (parsed && typeof parsed === 'object' && 'code' in parsed) {
                result = parsed;
                break;
            }
        } catch {}
    }
    if (!result) throw new Error('Paddle OCR 返回的位置数据无法解析。');
    if (result.code === 101) return { width, height, lines: [] };
    if (result.code !== 100 || !Array.isArray(result.data))
        throw new Error(`Paddle OCR 识别失败（${result.code}）：${String(result.data || '')}`);
    const lines = result.data.flatMap((item) => {
        const points = item.box;
        if (
            !item.text?.trim() ||
            !Array.isArray(points) ||
            points.length !== 4 ||
            points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) ||
            (typeof item.score === 'number' && item.score < (/^\d{1,3}[.)、]?$/.test(item.text.trim()) ? 0.15 : 0.3))
        )
            return [];
        const x = Math.min(...points.map((p) => p[0])),
            y = Math.min(...points.map((p) => p[1]));
        const box = {
            x,
            y,
            width: Math.max(...points.map((p) => p[0])) - x,
            height: Math.max(...points.map((p) => p[1])) - y,
        };
        return valid(box) ? [{ text: item.text.trim(), box, words: [{ text: item.text.trim(), box }] }] : [];
    });
    return { width, height, lines };
}
