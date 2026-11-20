// Run against the production build with a Windows Chrome installation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');

(async () => {
    const browser = await chromium.launch({ headless: true,
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const badge = await browser.newPage({ viewport: { width: 40, height: 40 } });
        const errors = [];
        badge.on('pageerror', (error) => errors.push(error.message));
        await installMock(badge, { label: 'selection_translate' });
        await badge.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            window.__selection = { id: 1, mode: 'badge' };
            window.__openCount = 0;
            window.__captureFails = true;
            const listeners = new Map();
            window.__selectionEvent = (payload) => {
                window.__selection = payload;
                for (const [id, listener] of listeners) window[`_${listener.handler}`]?.({ id, event: 'selection_changed', payload });
            };
            window.__TAURI_IPC__ = (request) => {
                const done = (value) => window[`_${request.callback}`]?.(value);
                if (request.cmd === 'selection_payload') return done(window.__selection);
                if (request.cmd === 'selection_open') {
                    window.__openCount++;
                    if (window.__captureFails) return window[`_${request.error}`]?.('请重新划词');
                    window.__selectionEvent(null);
                    return done(null);
                }
                if (request.cmd === 'tauri' && request.__tauriModule === 'Event' && request.message.event === 'selection_changed') {
                    if (request.message.cmd === 'listen') {
                        listeners.set(1000, request.message);
                        return done(1000);
                    }
                }
                return base(request);
            };
        });
        const serve = async (page) => {
            const dist = path.resolve(__dirname, '../dist');
            await page.route('http://127.0.0.1:43827/**', async (route) => {
                const pathname = new URL(route.request().url()).pathname;
                const file = path.resolve(dist, pathname === '/' ? 'index.html' : pathname.slice(1));
                assert.ok(file.startsWith(dist + path.sep));
                const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream';
                await route.fulfill({ contentType, body: await fs.readFile(file) });
            });
            await page.goto('http://127.0.0.1:43827/');
        };
        await serve(badge);
        const trigger = badge.getByRole('button', { name: '翻译选中文字', exact: true });
        await trigger.waitFor();
        assert.equal(await badge.evaluate(() => window.__openCount), 0);
        assert.equal(await badge.locator('textarea, .selection-result-window').count(), 0);
        await trigger.click();
        await badge.waitForFunction(() => document.querySelector('.selection-badge').title.includes('重新划词'));
        assert.equal(await trigger.innerText(), '!');
        await badge.evaluate(() => { window.__captureFails = false; });
        await trigger.click();
        await badge.waitForFunction(() => !document.querySelector('.selection-badge'));
        assert.equal(await badge.evaluate(() => window.__openCount), 2);

        const popup = await browser.newPage({ viewport: { width: 600, height: 720 } });
        popup.on('pageerror', (error) => errors.push(error.message));
        await installMock(popup, { label: 'translate' });
        await popup.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            window.__source = 'Selected document text.';
            window.__translations = [];
            const listeners = new Map();
            window.__nextText = (text) => {
                window.__source = text;
                for (const [id, listener] of listeners) window[`_${listener.handler}`]?.({ id, event: 'new_text', payload: text });
            };
            window.__TAURI_IPC__ = (request) => {
                const done = (value) => window[`_${request.callback}`]?.(value);
                if (request.cmd === 'get_text') return done(window.__source);
                if (request.cmd === 'plugin:store|get' && request.key === 'history_disable') return done(true);
                if (request.cmd === 'tauri' && request.__tauriModule === 'Event' && request.message.event === 'new_text' && request.message.cmd === 'listen') {
                    listeners.set(1001, request.message);
                    return done(1001);
                }
                if (request.cmd === 'tauri' && request.__tauriModule === 'Http' && request.message.cmd === 'httpRequest') {
                    const body = request.message.options.body.payload;
                    const prompt = body.messages.at(-1).content;
                    window.__translations.push(prompt);
                    return done({ status: 200, headers: {}, data: JSON.stringify({ choices: [{ message: { content: '模拟译文' } }] }) });
                }
                return base(request);
            };
        });
        await serve(popup);
        const source = popup.locator('textarea').first();
        await source.waitFor();
        await popup.waitForFunction(() => document.querySelector('textarea')?.value === 'Selected document text.');
        await popup.getByText('模拟译文', { exact: true }).first().waitFor();
        await popup.getByRole('button', { name: '常规翻译', exact: true }).waitFor();
        assert.equal(await popup.locator('.selection-result-window, .selection-options').count(), 0);
        assert.ok(await popup.getByText('专业翻译', { exact: true }).count());
        assert.ok(await popup.getByText('备用服务', { exact: true }).count());
        await popup.evaluate(() => window.__nextText('Another selection.'));
        await popup.waitForFunction(() => document.querySelector('textarea')?.value === 'Another selection.');
        await popup.waitForFunction(() => window.__translations.some((text) => text.includes('Another selection.')));
        assert.deepEqual(errors, []);
        console.log('Selection UI passed: deferred badge, capture failure and retry, legacy source/language/multi-service window, repeated selections, removed translation-only layout.');
    } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
