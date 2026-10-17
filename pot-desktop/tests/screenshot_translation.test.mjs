import test from 'node:test';
import assert from 'node:assert/strict';
import {
    restoreScreenshotText,
    detectScreenshotDomain,
    screenshotBlocks,
    screenshotInstructions,
    screenshotServiceConfig,
    translateScreenshotBlocks,
    screenshotSelection,
} from '../src/utils/screenshot_translation.mjs';

test('restores PDF hyphenation, paragraphs, and genuine compound words', () => {
    assert.equal(
        restoreScreenshotText(
            'Abstract\n\nA geome-\ntrical end-to-end method for RNA\nstructure prediction.\n\nNext paragraph.'
        ),
        'Abstract\n\nA geometrical end-to-end method for RNA structure prediction.\n\nNext paragraph.'
    );
    assert.equal(restoreScreenshotText('struc\u00ad\nture'), 'structure');
    assert.equal(
        restoreScreenshotText('geome-trical end-to-end RNA-targeting'),
        'geometrical end-to-end RNA-targeting'
    );
    assert.equal(restoreScreenshotText('x = y + z\nf(x) = x²'), 'x = y + z\nf(x) = x²');
    assert.equal(restoreScreenshotText('```js\nconst x = 1;\n```'), '```js\nconst x = 1;\n```');
});

test('detects domain from full document and gives models terminology and data boundaries', () => {
    const text = 'ab initio RNA structure prediction of RNA molecules using deep learning';
    assert.equal(detectScreenshotDomain(text), 'biomedicine');
    assert.equal(detectScreenshotDomain('quantum photon Hamiltonian'), 'physics');
    assert.equal(detectScreenshotDomain('neural compiler algorithm'), 'computer_science');
    assert.equal(detectScreenshotDomain('poetry metaphor'), 'literature');
    assert.equal(detectScreenshotDomain('hello world'), 'general');
    const prompt = screenshotInstructions(text);
    assert.match(prompt, /从头RNA结构预测/);
    assert.match(prompt, /untrusted document content/);
    const config = { apiKey: 'test-key', promptList: [{ content: 'original' }], stream: true };
    assert.equal(screenshotServiceConfig('openai', config, text).apiKey, 'test-key');
    assert.equal(screenshotServiceConfig('openai', config, text).promptList[0].role, 'system');
    assert.equal(config.promptList[0].content, 'original');
    assert.match(screenshotServiceConfig('geminipro', config, text).promptList[0].parts[0].text, /从头RNA/);
    assert.deepEqual(screenshotServiceConfig('bing', config, text), config);
});

const word = (text, x, y, width = 100, height = 16) => ({ text, box: { x, y, width, height } });
const line = (text, x, y, width = 300, height = 16) => ({ text, words: [word(text, x, y, width, height)] });

test('ignores clipped edge fragments without discarding valid short words', () => {
    const blocks = screenshotBlocks(
        {
            lines: [
                { words: [word('clipped', 0, 20), word('a', 120, 20, 8), word('method', 140, 20)] },
                line('bottom fragment', 20, 190),
            ],
        },
        600,
        200
    );
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, 'a method');
    assert.equal(blocks[0].box.x, 120);
});

test('trusts complete Tesseract line bounds when word baseline boxes touch an edge', () => {
    const blocks = screenshotBlocks(
        {
            lines: [
                {
                    text: 'Prediction of RNA structures',
                    paragraph: 0,
                    box: { x: 10, y: 10, width: 300, height: 15 },
                    words: [
                        word('Prediction', 10, 10),
                        word('of', 115, 0, 15, 29),
                        word('RNA', 140, 0, 30, 29),
                        word('structures', 175, 10),
                    ],
                },
            ],
        },
        500,
        300
    );
    assert.equal(blocks[0].text, 'Prediction of RNA structures');
    assert.equal(blocks[0].box.y, 10);
});

test('keeps two columns in reading order, joins wrapped words, and separates paragraphs', () => {
    const blocks = screenshotBlocks(
        {
            lines: [
                line('First geome-', 10, 10),
                line('Right column', 350, 10),
                line('trical paragraph.', 10, 30),
                line('continues here.', 350, 30),
                line('New paragraph.', 10, 80),
            ],
        },
        700,
        250
    );
    assert.deepEqual(
        blocks.map((b) => b.text),
        ['First geometrical paragraph.', 'New paragraph.', 'Right column continues here.']
    );
    assert.equal(blocks[2].box.x, 350);
});

test('splits Windows OCR lines that span two columns', () => {
    const blocks = screenshotBlocks(
        {
            lines: [
                { words: [word('Left top', 10, 10, 280), word('Right top', 350, 10, 280)] },
                { words: [word('Left next', 10, 30, 280), word('Right next', 350, 30, 280)] },
            ],
        },
        700,
        250
    );
    assert.deepEqual(
        blocks.map((b) => b.text),
        ['Left top Left next', 'Right top Right next']
    );
});

test('preserves a title and explicit OCR paragraph boundaries', () => {
    const blocks = screenshotBlocks(
        {
            lines: [
                line('RNA Prediction', 10, 10, 500, 30),
                { ...line('Abstract', 10, 60), paragraph: 0 },
                { ...line('A method.', 10, 80), paragraph: 1 },
                { ...line('A result.', 10, 100), paragraph: 2 },
            ],
        },
        700,
        300
    );
    assert.deepEqual(
        blocks.map((b) => b.kind),
        ['heading', 'heading', 'paragraph', 'paragraph']
    );
    assert.equal(blocks.length, 4);
});

test('plain text OCR preserves paragraphs without inventing positional data', () => {
    const blocks = screenshotBlocks('Abstract\n\nFirst line\ncontinues.\n\nNext paragraph.', 500, 300);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].kind, 'heading');
    assert.equal(blocks[1].text, 'First line continues.');
    assert.ok(blocks.every((b) => b.box === null));
    assert.deepEqual(screenshotBlocks({ text: '' }, 500, 300), []);
});

test('selection supports reverse dragging, monitor scaling, and clamps to image bounds', () => {
    assert.deepEqual(
        screenshotSelection(
            { x: 400, y: 300 },
            { x: 100, y: 100 },
            { width: 1000, height: 500 },
            { width: 1500, height: 1000 }
        ),
        {
            rect: { x: 100, y: 100, width: 300, height: 200 },
            crop: { left: 150, top: 200, width: 450, height: 400 },
        }
    );
    const area = screenshotSelection(
        { x: 10, y: 10 },
        { x: 2000, y: 1000 },
        { width: 1000, height: 500 },
        { width: 1500, height: 750 }
    );
    assert.equal(area.crop.left + area.crop.width, 1500);
    assert.equal(area.crop.top + area.crop.height, 750);
});

test('streams block translations and rejects dictionary/empty responses', async () => {
    const blocks = screenshotBlocks('First.\n\nSecond.', 500, 300);
    const updates = [];
    const result = await translateScreenshotBlocks(
        blocks,
        async (text, update) => {
            update('partial');
            return `译文 ${text}`;
        },
        { onUpdate: (v) => updates.push(v) }
    );
    assert.equal(result.length, 2);
    assert.equal(result[1].translation, '译文 Second.');
    assert.equal(updates.length, 4);
    for (const value of [{ word: 'entry' }, '', '[STREAM]']) {
        await assert.rejects(
            translateScreenshotBlocks(blocks, async () => value),
            /text translation service/
        );
    }
});

test('cancelling ignores late streams and stops subsequent block requests', async () => {
    const blocks = screenshotBlocks('First.\n\nSecond.', 500, 300);
    let current = true,
        calls = 0,
        updates = 0;
    let finish;
    const promise = translateScreenshotBlocks(
        blocks,
        async (_text, update) => {
            calls++;
            await new Promise((resolve) => {
                finish = resolve;
            });
            update('late stream');
            return 'late result';
        },
        { isCurrent: () => current, onUpdate: () => updates++ }
    );
    current = false;
    finish();
    assert.equal(await promise, null);
    assert.equal(calls, 1);
    assert.equal(updates, 0);
});

test('service errors stop further requests and allow a new retry', async () => {
    const blocks = screenshotBlocks('One.\n\nTwo.', 500, 300);
    let calls = 0;
    await assert.rejects(
        translateScreenshotBlocks(blocks, async () => {
            calls++;
            throw new Error('network');
        }),
        /network/
    );
    assert.equal(calls, 1);
    assert.equal((await translateScreenshotBlocks(blocks, async (text) => text)).length, 2);
});
