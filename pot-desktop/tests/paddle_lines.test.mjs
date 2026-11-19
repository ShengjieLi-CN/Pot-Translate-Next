import test from 'node:test';
import assert from 'node:assert/strict';
import { repairPaddleLines } from '../src/utils/paddle_lines.mjs';
import { screenshotBlocks } from '../src/utils/screenshot_translation.mjs';

function fixture(dark = false, scale = 1, input) {
    const sentence =
        input ||
        'An update on tomorrow teaching. The afternoon workshop originally planned with Alex Taylor is postponed until next week. We will confirm the revised date and time as soon as possible.';
    const words = sentence.split(' '),
        width = 2600,
        height = 130,
        pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = dark ? 20 : 255;
        pixels[i + 3] = 255;
    }
    let x = 20;
    const spans = [];
    for (const word of words) {
        const start = x;
        for (const letter of word) {
            for (let y = 35; y < 53; y++)
                for (let dx = 0; dx < 10; dx++) {
                    const p = (y * width + x + dx) * 4;
                    pixels[p] = pixels[p + 1] = pixels[p + 2] = dark ? 255 : 20;
                }
            x += 12;
        }
        spans.push({ word, start, end: x - 2 });
        x += 8;
    }
    const box = { x: 20 / scale, y: 35 / scale, width: (x - 28) / scale, height: 18 / scale };
    const result = {
        width: width / scale,
        height: height / scale,
        text: 'Hello\nIallld\nRegards',
        lines: [
            { text: 'Hello', box: { x: 20 / scale, y: 5 / scale, width: 90 / scale, height: 18 / scale } },
            { text: 'Iallld', box, confidence: 0.59 },
            { text: 'Regards', box: { x: 20 / scale, y: 95 / scale, width: 90 / scale, height: 18 / scale } },
        ],
    };
    const calls = [];
    const image = { width, height, pixels, crop: async (rect) => rect };
    const recognize = async (rect) => {
        calls.push(rect);
        const included = spans.filter((s) => s.end > rect.x && s.start < rect.x + rect.width);
        assert.ok(
            included.every((s) => s.start >= rect.x && s.end <= rect.x + rect.width),
            'a crop cut through a word'
        );
        return { text: included.map((s) => s.word).join(' '), lines: [] };
    };
    return { result, image, recognize, calls, sentence, box };
}

test('wide OCR garbage is recovered without losing or duplicating words, geometry or neighboring paragraphs', async () => {
    for (const [dark, scale] of [
        [false, 1],
        [true, 1],
        [false, 2],
    ]) {
        const f = fixture(dark, scale);
        const output = await repairPaddleLines(f.result, f.image, { recognize: f.recognize });
        assert.equal(output.lines[1].text, f.sentence);
        assert.deepEqual(output.lines[1].box, f.box);
        assert.equal(output.lines[0].text, 'Hello');
        assert.equal(output.lines[2].text, 'Regards');
        assert.equal(output.text, ['Hello', f.sentence, 'Regards'].join('\n'));
        assert.ok(f.calls.length > 1 && f.calls.every((r) => r.width < 1100));
        assert.ok(
            screenshotBlocks(output, f.image.width, f.image.height).some((b) =>
                b.text.includes('postponed until next week')
            )
        );
    }
});

test('normal text does not add OCR calls; an empty repair never becomes a successful incomplete translation', async () => {
    const f = fixture();
    const ordinary = { text: 'Hello', lines: [f.result.lines[0]] };
    assert.deepEqual(
        await repairPaddleLines(ordinary, f.image, { recognize: async () => assert.fail('unnecessary request') }),
        ordinary
    );
    await assert.rejects(
        repairPaddleLines(f.result, f.image, { recognize: async () => ({ text: '', lines: [] }) }),
        /长行.*识别/
    );
});

test('cancelling an in-flight repair suppresses its result and prevents remaining requests', async () => {
    const f = fixture();
    let active = true,
        release,
        calls = 0;
    const pending = repairPaddleLines(f.result, f.image, {
        isCurrent: () => active,
        recognize: async () => {
            calls++;
            return new Promise((r) => (release = r));
        },
    });
    await new Promise((r) => setImmediate(r));
    active = false;
    release({ text: 'late', lines: [] });
    await assert.rejects(pending, /取消/);
    assert.equal(calls, 1);
});

test('long unbroken identifiers and CJK lines retain every character without invented spaces', async () => {
    for (const text of ['Identifier'.repeat(18), '中文'.repeat(90)]) {
        const f = fixture(false, 1, text);
        const points = Array.from(text);
        const output = await repairPaddleLines(f.result, f.image, {
            recognize: async (rect) => {
                const included = points
                    .map((letter, i) => ({ letter, x: 20 + i * 12 }))
                    .filter((p) => p.x + 10 > rect.x && p.x < rect.x + rect.width);
                assert.ok(included.every((p) => p.x >= rect.x && p.x + 10 <= rect.x + rect.width));
                return { text: included.map((p) => p.letter).join(''), lines: [] };
            },
        });
        assert.equal(output.lines[1].text, text);
    }
});
