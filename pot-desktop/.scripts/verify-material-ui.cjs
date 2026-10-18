// Browser regression checks; native DWM rendering requires a Windows desktop.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 1080, height: 820 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await installMock(page, { label: 'config' });
        await page.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            window.__materialFailure = false;
            window.__TAURI_IPC__ = (request) => {
                if (request.cmd === 'set_window_material' && window.__materialFailure)
                    return window[`_${request.error}`]?.('材质不可用，已使用不透明背景。');
                return base(request);
            };
        });
        await page.goto('http://127.0.0.1:5174/general');
        const select = page.getByLabel('背景材质', { exact: true });
        await select.waitFor();
        assert.equal(await select.inputValue(), 'none');
        assert.equal(await select.locator('option').count(), 4);
        assert.equal(await page.getByText('透明效果', { exact: true }).count(), 0);
        const directory = path.resolve(__dirname, '../../.work/materials');
        fs.mkdirSync(directory, { recursive: true });
        for (const theme of ['light', 'dark']) {
            await page.evaluate((theme) => {
                document.documentElement.classList.toggle('dark', theme === 'dark');
                document.documentElement.classList.toggle('light', theme === 'light');
            }, theme);
            for (const material of ['none', 'mica', 'acrylic', 'liquid']) {
                await select.selectOption(material);
                await page.waitForFunction((material) => document.documentElement.dataset.windowMaterial === material, material);
                await page.waitForTimeout(200);
                const calls = await page.evaluate(() => window.__fixture.calls.filter((c) => c.cmd === 'set_window_material'));
                assert.equal(calls.at(-1).material, material);
                await page.screenshot({ path: path.join(directory, `${theme}-${material}.png`) });
            }
        }
        await page.evaluate(() => { window.__materialFailure = true; });
        await select.selectOption('mica');
        await page.getByRole('status').filter({ hasText: '材质不可用' }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.windowMaterial), 'none');
        assert.deepEqual(errors, []);
        const capture = await browser.newPage();
        await installMock(capture, { label: 'screenshot' });
        await capture.goto('http://127.0.0.1:5174');
        await capture.waitForTimeout(600);
        assert.equal(await capture.evaluate(() => window.__fixture.calls.some((c) => c.cmd === 'set_window_material')), false);
        assert.equal(await capture.evaluate(() => document.documentElement.dataset.windowMaterial), undefined);
        console.log('PASS: four materials, light/dark styles, opaque fallback, screenshot exclusion.');
    } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
