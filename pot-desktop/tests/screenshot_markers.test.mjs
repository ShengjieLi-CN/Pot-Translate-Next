import test from 'node:test';
import assert from 'node:assert/strict';
import { screenshotBlocks } from '../src/utils/screenshot_translation.mjs';
import { screenshotBulletStarts } from '../src/utils/screenshot_markers.mjs';

const rows = [
    ['Repeated measures title', 100, 41, 1601, 93],
    ['Parametric test.', 94, 174, 307, 38],
    ['Compare dependent groups', 93, 244, 1487, 43],
    ['across repeated measures.', 98, 297, 667, 39],
    ['The same units are measured multiple times.', 96, 366, 1566, 43],
    ['One categorical variable.', 94, 438, 715, 46],
    ['One continuous variable.', 94, 511, 431, 41],
    ['H0: the means are equal across', 94, 582, 1482, 46],
    ['repeated measures.', 97, 636, 381, 38],
    ['H1: the means are not equal across', 97, 705, 1550, 42],
    ['repeated measures.', 97, 755, 380, 39],
];
const bulletRows = [1, 2, 4, 5, 6, 7, 9];
function fixture({ scale = 1, dark = false, markers = bulletRows, square = false } = {}) {
    const width = Math.round(1769 * scale),
        height = Math.round(872 * scale);
    const pixels = new Uint8ClampedArray(width * height * 4);
    const background = dark ? [24, 38, 60] : [250, 250, 250];
    const foreground = dark ? [245, 245, 245] : [20, 20, 20];
    for (let i = 0; i < pixels.length; i += 4) pixels.set([...background, 255], i);
    const paint = (x, y, color) => pixels.set([...color, 255], (y * width + x) * 4);
    const lines = rows.map(([text, x, y, w, h]) => ({
        text,
        box: { x: x * scale, y: y * scale, width: w * scale, height: h * scale },
        fontHeight: h * scale,
    }));
    for (const index of markers) {
        const cx = 52 * scale,
            cy = (rows[index][2] + rows[index][4] / 2) * scale,
            radius = 5 * scale;
        for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
            for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
                if (square || (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) paint(x, y, foreground);
    }
    return { width, height, pixels, lines, paint, foreground };
}

test('pixel bullets keep seven mixed-length slide items separate even when inter-item gaps dominate', () => {
    for (const scale of [0.5, 1, 1.5])
        for (const dark of [false, true]) {
            const f = fixture({ scale, dark });
            const markers = screenshotBulletStarts(f.lines, f.pixels, f.width, f.height);
            assert.deepEqual(
                [...markers].map((row) => f.lines.indexOf(row)),
                bulletRows
            );
            const blocks = screenshotBlocks({ lines: f.lines }, f.width, f.height, f.pixels);
            assert.deepEqual(
                blocks.map((b) => b.text),
                [
                    rows[0][0],
                    rows[1][0],
                    `${rows[2][0]} ${rows[3][0]}`,
                    rows[4][0],
                    rows[5][0],
                    rows[6][0],
                    `${rows[7][0]} ${rows[8][0]}`,
                    `${rows[9][0]} ${rows[10][0]}`,
                ]
            );
            assert.deepEqual(
                blocks.map((b) => b.box.y),
                [0, ...bulletRows].map((i) => rows[i][2] * scale)
            );
        }
});

test('square markers work and OCR coordinates are mapped to the original image before examining pixels', () => {
    const f = fixture({ square: true });
    const lines = f.lines.map((line) => ({
        ...line,
        box: Object.fromEntries(Object.entries(line.box).map(([k, v]) => [k, v / 2])),
    }));
    const blocks = screenshotBlocks({ lines, width: f.width / 2, height: f.height / 2 }, f.width, f.height, f.pixels);
    assert.equal(blocks.length, 8);
    assert.equal(blocks[2].box.y, 244);
});

test('isolated margin dots, empty margins and absent pixels do not invent list boundaries', () => {
    for (const markers of [[], [4]]) {
        const f = fixture({ markers });
        assert.equal(screenshotBulletStarts(f.lines, f.pixels, f.width, f.height).size, 0);
    }
    const f = fixture();
    assert.equal(screenshotBulletStarts(f.lines, null, f.width, f.height).size, 0);
    assert.equal(screenshotBulletStarts(f.lines, f.pixels, 5, 5).size, 0);
});

test('punctuation within another column and margin rules are not list bullets', () => {
    const f = fixture();
    const other = bulletRows.map((i) => ({
        text: 'neighbor.',
        fontHeight: 40,
        box: { x: 5, y: rows[i][2], width: 60, height: rows[i][4] },
    }));
    assert.equal(screenshotBulletStarts([...f.lines, ...other], f.pixels, f.width, f.height).size, 0);
    const empty = fixture({ markers: [] });
    for (let y = 150; y < 800; y++) for (let x = 48; x < 54; x++) empty.paint(x, y, empty.foreground);
    assert.equal(screenshotBulletStarts(empty.lines, empty.pixels, empty.width, empty.height).size, 0);
});

test('list boundaries do not depend on sentence punctuation', () => {
    const f = fixture();
    const lines = f.lines.map((row) => ({ ...row, text: row.text.replace(/\.$/, '') }));
    assert.equal(screenshotBlocks({ lines }, f.width, f.height, f.pixels).length, 8);
});
