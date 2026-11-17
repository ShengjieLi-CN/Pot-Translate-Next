// Recover small list bullets that OCR commonly omits. Only inspect the margin
// immediately left of text, and require repeated, aligned, compact ink islands.
// This is image geometry, not another OCR request or a local OCR model.
export function screenshotBulletStarts(lines, pixels, width, height) {
    if (!pixels || pixels.length !== width * height * 4) return new Set();
    const candidates = [];
    for (const line of lines) {
        const size = line.fontHeight;
        const left = Math.max(0, Math.floor(line.box.x - size * 3));
        const right = Math.min(width, Math.floor(line.box.x - size * 0.12));
        const top = Math.max(0, Math.floor(line.box.y - size * 0.1));
        const bottom = Math.min(height, Math.ceil(line.box.y + line.box.height + size * 0.1));
        const w = right - left,
            h = bottom - top;
        if (w < 3 || h < 3) continue;
        const samples = [[], [], []];
        for (let y = top; y < bottom; y += Math.max(1, Math.floor(h / 8))) {
            for (let x = left; x < right; x += Math.max(1, Math.floor(w / 12))) {
                const i = (y * width + x) * 4;
                for (let c = 0; c < 3; c++) samples[c].push(pixels[i + c]);
            }
        }
        const background = samples.map((values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
        const ink = new Uint8Array(w * h);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const i = ((top + y) * width + left + x) * 4;
                const contrast = Math.max(...background.map((value, c) => Math.abs(pixels[i + c] - value)));
                if (pixels[i + 3] > 128 && contrast > 90) ink[y * w + x] = 1;
            }
        for (let i = 0; i < ink.length; i++) {
            if (!ink[i]) continue;
            const queue = [i];
            ink[i] = 0;
            let minX = w,
                maxX = 0,
                minY = h,
                maxY = 0;
            for (let index = 0; index < queue.length; index++) {
                const p = queue[index],
                    x = p % w,
                    y = Math.floor(p / w);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                const neighbors = [];
                if (x > 0) neighbors.push(p - 1);
                if (x + 1 < w) neighbors.push(p + 1);
                if (y > 0) neighbors.push(p - w);
                if (y + 1 < h) neighbors.push(p + w);
                for (const next of neighbors)
                    if (ink[next]) {
                        ink[next] = 0;
                        queue.push(next);
                    }
            }
            const bw = maxX - minX + 1,
                bh = maxY - minY + 1;
            if (
                minX === 0 ||
                minY === 0 ||
                maxX === w - 1 ||
                maxY === h - 1 ||
                Math.min(bw, bh) < Math.max(2, size * 0.08) ||
                Math.max(bw, bh) > size * 0.45 ||
                bw / bh < 0.65 ||
                bw / bh > 1.5 ||
                queue.length / (bw * bh) < 0.5
            )
                continue;
            const x = left + (minX + maxX) / 2,
                y = top + (minY + maxY) / 2;
            if (Math.abs(y - line.box.y - line.box.height / 2) > size * 0.35) continue;
            // Adjacent-column punctuation belongs to that column, not this list.
            if (
                lines.some(
                    (other) =>
                        other !== line &&
                        x >= other.box.x &&
                        x <= other.box.x + other.box.width &&
                        y >= other.box.y &&
                        y <= other.box.y + other.box.height
                )
            )
                continue;
            candidates.push({ line, x, y, diameter: Math.max(bw, bh) });
        }
    }
    const starts = new Set();
    for (const a of candidates) {
        if (
            candidates.some(
                (b) =>
                    a.line !== b.line &&
                    Math.abs(a.x - b.x) < Math.min(a.line.fontHeight, b.line.fontHeight) * 0.2 &&
                    Math.abs(a.line.box.x - b.line.box.x) < Math.min(a.line.fontHeight, b.line.fontHeight) * 0.6 &&
                    Math.abs(a.y - b.y) > Math.max(a.line.fontHeight, b.line.fontHeight) &&
                    Math.max(a.diameter, b.diameter) / Math.min(a.diameter, b.diameter) < 1.6
            )
        )
            starts.add(a.line);
    }
    return starts;
}
