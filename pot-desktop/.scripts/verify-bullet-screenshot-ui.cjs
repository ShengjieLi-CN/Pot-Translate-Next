// Synthetic slides: real image decoding/layout, mocked OCR with omitted bullets.
// No credentials or live network services are used.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    try {
        for (const counts of [
            [1, 2, 1, 1, 1, 2, 2],
            [2, 2, 3, 3],
        ]) {
            for (const dark of [false, true]) {
                const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                await installMock(page, { label: 'image_translate' });
                await page.addInitScript(
                    ({ counts, dark }) => {
                        const canvas = document.createElement('canvas');
                        canvas.width = 1000;
                        canvas.height = 800;
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = dark ? '#18263c' : '#fff';
                        ctx.fillRect(0, 0, 1000, 800);
                        ctx.fillStyle = dark ? '#fff' : '#111';
                        ctx.font = 'bold 30px Arial';
                        ctx.textBaseline = 'top';
                        const rows = [],
                            expected = [];
                        let y = 30;
                        counts.forEach((count, item) => {
                            ctx.beginPath();
                            ctx.arc(45, y + 17, 4.5, 0, Math.PI * 2);
                            ctx.fill();
                            const text = [];
                            for (let i = 0; i < count; i++) {
                                const source = i
                                    ? `Continuation ${item + 1}.${i}.`
                                    : `Item ${item + 1}${count === 1 ? '.' : ''}`;
                                ctx.fillText(source, 90, y);
                                rows.push({ text: source, box: [88, y - 2, 800, y + 34] });
                                text.push(source);
                                y += 42;
                            }
                            expected.push(text.join(' '));
                            y += 18;
                        });
                        const base64 = canvas.toDataURL('image/png').split(',')[1];
                        window.__bulletFixture = { sources: [], expected, ocrCalls: 0 };
                        const base = window.__TAURI_IPC__;
                        window.__TAURI_IPC__ = (request) => {
                            const done = (value) => window[`_${request.callback}`](value);
                            if (request.cmd === 'get_base64') return done(base64);
                            if (request.__tauriModule === 'Http' && request.message?.cmd === 'httpRequest') {
                                const options = request.message.options;
                                if (options.url.includes('paddleocr.aistudio-app.com')) {
                                    if (options.method === 'POST') window.__bulletFixture.ocrCalls++;
                                    return base(request);
                                }
                                if (options.url.includes('paddle-result.invalid'))
                                    return done({
                                        status: 200,
                                        headers: {},
                                        data: JSON.stringify({
                                            result: {
                                                ocrResults: [
                                                    {
                                                        prunedResult: {
                                                            rec_texts: rows.map((row) => row.text),
                                                            rec_boxes: rows.map((row) => row.box),
                                                        },
                                                    },
                                                ],
                                            },
                                        }),
                                    });
                                if (options.url.includes('translation.invalid')) {
                                    const source = options.body.payload.messages
                                        .at(-1)
                                        .content.split('content:\n')
                                        .at(-1);
                                    window.__bulletFixture.sources.push(source);
                                    return done({
                                        status: 200,
                                        headers: {},
                                        data: JSON.stringify({
                                            choices: [{ message: { content: `译文：${source}` } }],
                                        }),
                                    });
                                }
                            }
                            return base(request);
                        };
                    },
                    { counts, dark }
                );
                await page.goto(process.env.UI_URL || 'http://127.0.0.1:5173');
                await page.getByText('翻译完成', { exact: false }).waitFor();
                const fixture = await page.evaluate(() => window.__bulletFixture);
                assert.deepEqual(fixture.sources.sort(), [...fixture.expected].sort());
                assert.equal(await page.locator('.screenshot-block').count(), counts.length);
                const blocks = await page.locator('.screenshot-block').evaluateAll((nodes) =>
                    nodes.map((node) => ({
                        y: node.offsetTop,
                        h: node.offsetHeight,
                        overflow: node.dataset.overflow,
                    }))
                );
                assert.ok(
                    blocks.every(
                        (block, i) => block.overflow === 'false' && (!i || block.y >= blocks[i - 1].y + blocks[i - 1].h)
                    )
                );
                await page.getByRole('button', { name: '复制译文', exact: true }).click();
                assert.equal(
                    (await page.evaluate(() => window.__fixture.clipboard)).split('\n\n').length,
                    counts.length
                );
                await page.getByRole('button', { name: '重试', exact: true }).click();
                await page.getByText('翻译完成', { exact: false }).waitFor();
                assert.equal(await page.evaluate(() => window.__bulletFixture.ocrCalls), 1);
                assert.deepEqual(errors, []);
                await page.close();
            }
        }
        console.log(
            'Bullet screenshot UI passed: seven/four items, missing OCR markers, light/dark backgrounds, 150% DPI, independent translation requests, clipboard paragraphs and OCR reuse.'
        );
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
