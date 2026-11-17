// Exercise real UI and the Tauri HTTP boundary with fake cloud responses only.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');
(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const errors = [];
    const url = process.env.UI_URL || 'http://127.0.0.1:5173';
    try {
        const config = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        config.setDefaultTimeout(15000);
        config.on('pageerror', (error) => errors.push(error.message));
        await installMock(config, { label: 'config' });
        await config.goto(url + '/recognize');
        await config.getByRole('heading', { name: 'Paddle OCR', exact: true }).waitFor();
        const key = config.locator('input[type=password]');
        assert.equal(await key.getAttribute('type'), 'password');
        await key.fill('new-test-key');
        await config.getByRole('button', { name: /OCR 模型/ }).click();
        await config.getByRole('option', { name: 'PP-OCRv5（截图推荐）', exact: true }).click();
        await config.waitForFunction(() =>
            window.__fixture.calls.some(
                (c) =>
                    c.cmd === 'plugin:store|set' &&
                    c.key === 'paddle_ocr' &&
                    c.value.apiKey === 'new-test-key' &&
                    c.value.model === 'PP-OCRv5'
            )
        );
        await config.screenshot({ path: process.env.PADDLE_SETTINGS_SCREENSHOT || '/tmp/pot-paddle-settings.png' });
        await config.getByText('服务设置', { exact: true }).click();
        await config.getByRole('tab').first().waitFor();
        assert.equal(await config.getByRole('tab').count(), 3);
        assert.equal(await config.getByRole('tab', { name: '文字识别', exact: true }).count(), 0);
        console.log('Settings: password input, model persistence and removal of OCR provider tab passed');

        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        page.on('pageerror', (error) => errors.push(error.message));
        await installMock(page);
        await page.goto(url);
        await page.getByText('拖动框选翻译区域', { exact: false }).waitFor();
        await page.waitForFunction(() => document.querySelector('img.fixed')?.naturalWidth > 0);
        await page.mouse.move(194, 160);
        await page.mouse.down();
        await page.mouse.move(1064, 460);
        await page.mouse.up();
        await page.getByText('翻译完成', { exact: false }).waitFor();
        assert.equal(await page.locator('.screenshot-block').count(), 6);
        assert.equal(await page.getByLabel('OCR 服务', { exact: true }).count(), 0);
        const calls = await page.evaluate(() => window.__fixture.calls);
        assert.equal(calls.filter((c) => c.cmd === 'run_binary' || c.cmd === 'system_ocr_layout').length, 0);
        const cloud = calls.filter((c) => c.message?.options?.url?.includes('paddleocr.aistudio-app.com'));
        assert.equal(cloud.length, 2);
        assert.equal(cloud[0].message.options.headers['Content-Type'], 'multipart/form-data');
        assert.equal(cloud[0].message.options.body.payload.model, 'PP-OCRv6');
        assert.deepEqual(errors, []);
        console.log('Screenshot: cloud upload, polling, geometry and ignoring old providers passed');
        for (const [label, missingKey] of [
            ['recognize', false],
            ['recognize', true],
            ['translate', false],
        ]) {
            const recognition = await browser.newPage();
            recognition.setDefaultTimeout(15000);
            recognition.on('pageerror', (error) => errors.push(label + ': ' + error.stack));
            await installMock(recognition, { label });
            await recognition.addInitScript(
                ({ missingKey }) => {
                    const original = window.__TAURI_IPC__;
                    window.__TAURI_IPC__ = (request) => {
                        const done = (value) => window[`_${request.callback}`]?.(value);
                        if (request.cmd === 'get_base64') return done(window.__fixture.fullImage.split(',')[1]);
                        if (request.cmd === 'get_text') return done('[IMAGE_TRANSLATE]');
                        if (request.cmd === 'plugin:store|get' && request.key === 'history_disable') return done(true);
                        if (missingKey && request.cmd === 'plugin:store|get' && request.key === 'paddle_ocr')
                            return done({ model: 'PP-OCRv6', apiKey: '' });
                        return original(request);
                    };
                },
                { missingKey }
            );
            await recognition.goto(url);
            await recognition.waitForFunction(
                ({ missingKey }) =>
                    [...document.querySelectorAll('textarea')].some((input) =>
                        missingKey ? input.value.includes('API Key') : input.value.includes('RNA structure prediction')
                    ),
                { missingKey }
            );
            assert.equal(await recognition.getByRole('menuitem').count(), 0);
            const requests = await recognition.evaluate(
                () =>
                    window.__fixture.calls.filter((c) =>
                        c.message?.options?.url?.includes('paddleocr.aistudio-app.com')
                    ).length
            );
            assert.equal(requests, missingKey ? 0 : 2);
            await recognition.close();
        }
        assert.deepEqual(errors, []);
        console.log('Recognition and image input: cloud OCR, missing-key guidance and old-provider isolation passed');
        await page.getByRole('button', { name: '复制译文', exact: true }).click();
        assert.match(await page.evaluate(() => window.__fixture.clipboard), /RNA/);
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
