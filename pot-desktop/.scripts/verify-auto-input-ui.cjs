const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        page.setDefaultTimeout(12000);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await installMock(page, { label: 'config' });
        await page.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            window.__autoRequests = [];
            window.__TAURI_IPC__ = (request) => {
                const done = (value) => window[`_${request.callback}`]?.(value);
                if (request.cmd === 'get_font_list') return done(['Arial']);
                if (request.cmd === 'plugin:store|get' && request.key === 'history_disable') return done(true);
                if (request.cmd === 'tauri' && request.__tauriModule === 'Http' && request.message.cmd === 'httpRequest') {
                    const prompt = request.message.options.body.payload.messages.at(-1).content;
                    const text = prompt.match(/"""\n([\s\S]*?)\n"""/)?.[1] ?? prompt;
                    window.__autoRequests.push(text);
                    setTimeout(() => done({ status: 200, headers: {}, data: JSON.stringify({ choices: [{ message: { content: `译文：${text}` } }] }) }), text === 'Slow response' ? 1800 : 10);
                    return;
                }
                return base(request);
            };
        });
        const dist = path.resolve(__dirname, '../dist');
        await page.route('http://127.0.0.1:43827/**', async (route) => {
            const url = new URL(route.request().url());
            const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
            const file = path.resolve(dist, relative);
            assert.ok(file.startsWith(dist + path.sep));
            const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream';
            await route.fulfill({ contentType, body: await fs.readFile(file) });
        });
        await page.goto('http://127.0.0.1:43827/');
        const input = page.locator('.sentence-source-input');
        await input.waitFor();
        console.log('Ready');
        await page.waitForTimeout(800);
        assert.equal(await page.evaluate(() => window.__autoRequests.length), 0);
        await input.fill('Hello');
        await page.waitForTimeout(150);
        await input.fill('Hello world');
        await page.waitForFunction(() => document.querySelector('.sentence-translation')?.textContent === '译文：Hello world');
        assert.deepEqual(await page.evaluate(() => window.__autoRequests), ['Hello world']);
        console.log('Debounce passed');

        await input.dispatchEvent('compositionstart');
        await input.fill('ni hao');
        await page.waitForTimeout(850);
        assert.equal(await page.evaluate(() => window.__autoRequests.length), 1);
        await input.fill('你好');
        await input.dispatchEvent('compositionend', { data: '你好' });
        await page.waitForFunction(() => document.querySelector('.sentence-translation')?.textContent === '译文：你好');

        await input.fill('Slow response');
        await page.waitForFunction(() => window.__autoRequests.includes('Slow response'));
        await input.fill('Latest text');
        await page.waitForFunction(() => document.querySelector('.sentence-translation')?.textContent === '译文：Latest text');
        await page.waitForTimeout(1500);
        assert.equal(await page.locator('.sentence-translation').textContent(), '译文：Latest text');

        await input.fill('Cancel this draft');
        const beforeClear = await page.evaluate(() => window.__autoRequests.length);
        await input.fill('');
        await page.waitForTimeout(850);
        assert.equal(await page.evaluate(() => window.__autoRequests.length), beforeClear);
        assert.equal(await page.locator('.sentence-translation').count(), 0);

        await input.fill('Translate immediately');
        await input.press('Enter');
        await page.waitForFunction(() => document.querySelector('.sentence-translation')?.textContent === '译文：Translate immediately');
        await page.waitForTimeout(850);
        assert.equal(await page.evaluate(() => window.__autoRequests.filter((text) => text === 'Translate immediately').length), 1);
        assert.deepEqual(errors, []);
        console.log('PASS: automatic translation, debounce, IME, stale response suppression, clear cancellation, immediate Enter without duplicates.');
    } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
