// Local synthetic email: real bundled English OCR, mocked native OCR/translation.
// No screenshot or text is sent to a network service.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await installMock(page);
        await page.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            window.__TAURI_IPC__ = (request) => {
                const fixture = window.__complex;
                if (fixture && request.cmd === 'get_base64') {
                    window[`_${request.callback}`](fixture.base64);
                    return;
                }
                if (fixture && request.cmd === 'system_ocr_layout') {
                    fixture.receivedBase64 = request.base64;
                    window[`_${request.callback}`](fixture.native);
                    return;
                }
                if (fixture && request.__tauriModule === 'Http' && request.message?.cmd === 'httpRequest') {
                    const source = request.message.options.body.payload.messages
                        .at(-1)
                        .content.split('content:\n')
                        .at(-1);
                    fixture.sources.push(source);
                    const translations = [
                        /friendly/i.test(source) ? '温馨提醒：您的包裹已可领取。' : null,
                        /Please show/i.test(source) ? '请在前台出示取件码。' : null,
                        /Delivery Reminder/i.test(source) ? '取件提醒' : null,
                    ];
                    const text = translations.find(Boolean) || source;
                    window[`_${request.callback}`]({
                        status: 200,
                        headers: {},
                        data: JSON.stringify({ choices: [{ message: { content: text } }] }),
                    });
                    return;
                }
                return base(request);
            };
        });
        await page.goto(process.env.UI_URL || 'http://127.0.0.1:5173');
        await page.waitForFunction(() => document.querySelector('img.fixed')?.naturalWidth > 0);
        await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 520;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, 800, 520);
            ctx.fillStyle = '#f7b500';
            ctx.fillRect(25, 25, 120, 85);
            ctx.fillStyle = '#111';
            ctx.font = 'bold 76px Arial';
            ctx.fillText('PACKAGES', 210, 100);
            ctx.fillStyle = '#ffb710';
            ctx.fillRect(10, 130, 780, 24);
            ctx.fillStyle = '#111';
            ctx.font = '12px Arial';
            ctx.fillText('Delivery Reminder', 300, 147);
            ctx.font = '24px Arial';
            ctx.fillText('123456', 345, 210);
            ctx.font = '11px Arial';
            ctx.fillText('This is a friendly reminder. Your parcel is ready to collect.', 20, 260);
            ctx.fillText('Please show the collection code at the reception desk.', 20, 290);
            const line = (text, x, y, width, height) => ({ text, words: [{ text, box: { x, y, width, height } }] });
            window.__complex = {
                base64: canvas.toDataURL('image/png').split(',')[1],
                sources: [],
                native: {
                    width: 800,
                    height: 520,
                    englishAvailable: false,
                    lines: [
                        line('PACKAGES', 210, 44, 430, 58),
                        line('Delivery Reminder', 300, 137, 99, 12),
                        line('123456', 345, 192, 80, 20),
                        line('This is a fri 院 reminder your parcel is read', 20, 252, 270, 10),
                        line('Please show the code at reception', 20, 282, 255, 10),
                    ],
                },
            };
        });
        if (process.env.COMPLEX_SCREENSHOT_OUTPUT) {
            require('node:fs').writeFileSync(
                process.env.COMPLEX_SCREENSHOT_OUTPUT,
                Buffer.from(await page.evaluate(() => window.__complex.base64), 'base64')
            );
        }
        await page.mouse.move(50, 50);
        await page.mouse.down();
        await page.mouse.move(850, 570);
        await page.mouse.up();
        await page.getByText('翻译完成', { exact: false }).waitFor({ timeout: 60000 });
        const fixture = await page.evaluate(() => ({
            sources: window.__complex.sources,
            samePixels: window.__complex.receivedBase64 === window.__complex.base64,
        }));
        assert.equal(fixture.samePixels, true);
        assert.ok(fixture.sources.some((t) => /parcel is ready to collect/i.test(t)));
        assert.ok(fixture.sources.some((t) => /Please show the collection code at the reception desk/i.test(t)));
        assert.equal(
            await page.locator('.screenshot-paper').evaluate((e) => getComputedStyle(e).backgroundColor),
            'rgba(0, 0, 0, 0)'
        );
        assert.equal(
            await page.getByText('取件提醒', { exact: true }).evaluate((e) => getComputedStyle(e).backgroundColor),
            'rgb(255, 183, 16)'
        );
        const surface = await page.locator('.screenshot-result').boundingBox();
        for (const block of await page.locator('.screenshot-block').all()) {
            const box = await block.boundingBox();
            assert.ok(
                box.x >= surface.x - 0.5 &&
                    box.y >= surface.y - 0.5 &&
                    box.x + box.width <= surface.x + surface.width + 0.5 &&
                    box.y + box.height <= surface.y + surface.height + 0.5
            );
            assert.equal(
                await block.evaluate((e) => e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1),
                true
            );
        }
        if (process.env.COMPLEX_SCREENSHOT_PREVIEW) await page.screenshot({ path: process.env.COMPLEX_SCREENSHOT_PREVIEW });
        await page.getByRole('button', { name: '查看原图', exact: true }).click();
        assert.equal(await page.locator('.screenshot-paper').count(), 0);
        assert.deepEqual(errors, []);
        console.log(
            'Complex screenshot passed: real offline English fallback, small text beside large logos, immutable crop, 150% DPI, colour masks, preserved graphics and fitted text.'
        );
    } finally {
        await browser.close();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
