const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');
(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const url = process.env.UI_URL || 'http://127.0.0.1:5173';
    const errors = [];
    try {
        const settings = await browser.newPage({ viewport: { width: 1200, height: 1100 } });
        settings.on('pageerror', (e) => errors.push(e.message));
        await installMock(settings, { label: 'config', ocrProvider: 'rapidocr' });
        await settings.goto(url + '/recognize');
        await settings.getByText('RapidOCR 已就绪', { exact: false }).waitFor();
        const rapid = await settings.getByRole('heading', { name: 'RapidOCR', exact: true }).boundingBox();
        const paddle = await settings.getByRole('heading', { name: 'Paddle OCR', exact: true }).boundingBox();
        assert(rapid.y < paddle.y);
        await settings.getByRole('button', { name: /RapidOCR CPU 线程数/ }).click();
        await settings.getByRole('option', { name: '4 线程', exact: true }).click();
        await settings.waitForFunction(() =>
            window.__fixture.calls.some(
                (c) => c.cmd === 'plugin:store|set' && c.key === 'rapid_ocr' && c.value.threads === 4
            )
        );
        await settings.getByRole('button', { name: /默认 OCR 引擎/ }).click();
        await settings.getByRole('option', { name: 'Paddle OCR（云端）', exact: true }).click();
        await settings.waitForFunction(() =>
            window.__fixture.calls.some(
                (c) => c.cmd === 'plugin:store|set' && c.key === 'ocr_provider' && c.value === 'paddle'
            )
        );
        assert.equal(await settings.locator('input[type=password]').inputValue(), 'fake-paddle-key');
        await settings.screenshot({ path: process.env.RAPIDOCR_SETTINGS_SCREENSHOT || '/tmp/pot-rapidocr-settings.png' });
        console.log('RapidOCR settings: order, CPU threads, provider persistence and retained Paddle key passed');

        for (const label of ['screenshot', 'recognize', 'translate', 'recognize-unavailable']) {
            const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
            page.setDefaultTimeout(15000);
            page.on('pageerror', (e) => errors.push(e.message));
            await installMock(page, { label: label.replace('-unavailable', ''), ocrProvider: 'rapidocr' });
            await page.addInitScript(
                ({ label }) => {
                    const original = window.__TAURI_IPC__;
                    window.__TAURI_IPC__ = (request) => {
                        const done = (value) => window[`_${request.callback}`]?.(value);
                        // Simulates upgrading an existing Paddle-only config. The default must become RapidOCR.
                        if (request.cmd === 'plugin:store|get' && request.key === 'ocr_provider') return done(null);
                        if (label !== 'screenshot' && request.cmd === 'get_base64')
                            return done(window.__fixture.fullImage.split(',')[1]);
                        if (request.cmd === 'get_text') return done('[IMAGE_TRANSLATE]');
                        if (request.cmd === 'plugin:store|get' && request.key === 'history_disable') return done(true);
                        if (label.endsWith('unavailable') && request.cmd === 'rapidocr_recognize') {
                            window.__fixture.calls.push(request);
                            return window[`_${request.error}`]?.('请先在文字识别 → RapidOCR 中安装本地引擎。');
                        }
                        return original(request);
                    };
                },
                { label }
            );
            await page.goto(url);
            if (label === 'screenshot') {
                await page.waitForFunction(() => document.querySelector('img.fixed')?.naturalWidth > 0);
                await page.mouse.move(194, 160);
                await page.mouse.down();
                await page.mouse.move(1064, 460);
                await page.mouse.up();
                await page.getByText('翻译完成', { exact: false }).waitFor();
                assert.equal(await page.locator('.screenshot-block').count(), 6);
            } else {
                await page.waitForFunction(
                    ({ failed }) =>
                        [...document.querySelectorAll('textarea')].some((input) =>
                            input.value.includes(failed ? '安装本地引擎' : 'RNA structure prediction')
                        ),
                    { failed: label.endsWith('unavailable') }
                );
            }
            const calls = await page.evaluate(() => window.__fixture.calls);
            assert.equal(calls.filter((c) => c.cmd === 'rapidocr_recognize').length, 1);
            assert.equal(
                calls.filter((c) => c.message?.options?.url?.includes('paddleocr.aistudio-app.com')).length,
                0
            );
            await page.close();
        }
        assert.deepEqual(errors, []);
        console.log(
            'RapidOCR: default migration, three OCR entrances and missing-runtime guidance without cloud fallback passed'
        );
    } finally {
        await browser.close();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
