const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 1180, height: 1050 } });
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await installMock(page, { label: 'config' });
        await page.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            window.__offline = { ready: false, fail: true, requests: [], network: 0 };
            window.__TAURI_IPC__ = (request) => {
                const done = (value) => window[`_${request.callback}`]?.(value);
                const fail = (value) => window[`_${request.error}`]?.(value);
                if (request.cmd === 'plugin:store|get' && request.key === 'translate_service_list') return done(['libretranslate']);
                if (request.cmd === 'plugin:store|get' && request.key === 'libretranslate') return done({ instanceName: 'LibreTranslate 离线翻译', enable: true });
                if (request.cmd === 'plugin:store|get' && request.key === 'history_disable') return done(true);
                if (request.cmd === 'plugin:store|get' && request.key === 'hotkey_ocr_translate') return done('Ctrl+Alt+D');
                if (request.cmd === 'libretranslate_status') return done({ ready: window.__offline.ready, installing: false, version: '1.9.6' });
                if (request.cmd === 'libretranslate_install') {
                    if (window.__offline.fail) return fail('测试下载失败，可重试');
                    window.__offline.ready = true;
                    return done({ ready: true });
                }
                if (request.cmd === 'libretranslate_translate') {
                    window.__offline.requests.push({ text: request.text, source: request.source, target: request.target });
                    if (!window.__offline.ready) return fail('请先安装离线引擎');
                    return done(request.source === 'zh' ? 'Hello world.' : '你好，世界。');
                }
                if (request.cmd === 'tauri' && request.__tauriModule === 'Http') window.__offline.network++;
                return base(request);
            };
        });
        const dist = path.resolve(__dirname, '../dist');
        await page.route('http://127.0.0.1:43827/**', async (route) => {
            const url = new URL(route.request().url());
            const file = path.resolve(dist, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)));
            assert.ok(file.startsWith(dist + path.sep));
            const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream';
            await route.fulfill({ contentType, body: await fs.readFile(file) });
        });
        await page.goto('http://127.0.0.1:43827/');
        await page.locator('.sentence-source-input').waitFor();
        assert.equal(await page.getByRole('button', { name: '截图翻译', exact: true }).count(), 0);
        assert.equal(await page.getByLabel('LibreTranslate 离线引擎', { exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: '下载并安装离线引擎', exact: true }).count(), 0);
        await page.getByRole('button', { name: '服务设置', exact: true }).click();
        const row = page.getByRole('heading', { name: 'LibreTranslate 离线翻译', exact: true }).locator('xpath=../..');
        await row.locator('button').first().click();
        await page.getByRole('button', { name: '下载并安装离线引擎', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '测试下载失败' }).waitFor();
        await page.evaluate(() => { window.__offline.fail = false; });
        await page.getByRole('button', { name: '下载并安装离线引擎', exact: true }).click();
        await page.getByText('离线引擎已就绪 · 中译英 / 英译中', { exact: true }).waitFor();
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await page.getByRole('button', { name: '热键设置', exact: true }).click();
        await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).some((input) => input.value === 'Ctrl+Alt+D'));
        await page.getByRole('button', { name: '输入翻译', exact: true }).click();
        await page.getByRole('button', { name: '源语言', exact: true }).click();
        await page.getByRole('menuitem', { name: '英语', exact: true }).click();
        const input = page.locator('.sentence-source-input');
        await input.fill('Hello world.');
        await page.waitForFunction(() => document.querySelector('.sentence-translation')?.textContent === '你好，世界。');
        let requests = await page.evaluate(() => window.__offline.requests);
        assert.equal(requests.at(-1).source, 'en');
        assert.equal(requests.at(-1).target, 'zh');
        await page.getByRole('button', { name: '交换语言', exact: true }).click();
        await input.fill('你好，世界。');
        await page.waitForFunction(() => document.querySelector('.sentence-translation')?.textContent === 'Hello world.');
        requests = await page.evaluate(() => window.__offline.requests);
        assert.equal(requests.at(-1).source, 'zh');
        assert.equal(requests.at(-1).target, 'en');
        await page.evaluate(() => { history.pushState(null, '', '/screenshot'); window.dispatchEvent(new PopStateEvent('popstate')); });
        await page.waitForURL('**/input');
        assert.equal(await page.getByLabel('LibreTranslate 离线引擎', { exact: true }).count(), 0);
        assert.equal(await page.evaluate(() => window.__offline.network), 0);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.resolve(__dirname, '../../.work/libretranslate/input-offline.png') });
        console.log('PASS: download failure/retry, ready state, clean input page, screenshot route redirect, preserved hotkey, both language directions, zero cloud HTTP requests.');
    } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
