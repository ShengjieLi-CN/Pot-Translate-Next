const { chromium } = require('C:/Users/ShengjieLi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
    await page.route('http://pot.test/**', async (route) => {
        const url = new URL(route.request().url());
        const file = path.join(__dirname, '../pot-desktop/dist', url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
        const type = ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)] ?? 'application/octet-stream';
        if (fs.existsSync(file)) await route.fulfill({ contentType:type, body: fs.readFileSync(file) });
        else await route.fulfill({ status:404, body:'Not found' });
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        window.__TAURI_METADATA__ = { __windows: [{ label: 'translate' }], __currentWindow: { label: 'translate' } };
        const config = new Map(Object.entries({
            app_language: 'zh_cn', app_font_size: 20, app_theme: 'light', app_font: 'Arial', app_fallback_font: 'Microsoft YaHei',
            translate_service_list: ['google', 'bing'], translate_close_on_blur: false,
            history_disable: true, translate_detect_engine: 'local',
            google: {}, bing: {}, lingva_tts: {},
        }));
        const events = new Map();
        window.qaRequests = [];
        window.qaDelay = 0;
        window.qaFail = false;
        window.qaEmit = (event, payload) => {
            for (const callback of events.get(event) ?? []) window[`_${callback}`]?.({ event, payload });
        };
        window.__TAURI_IPC__ = async ({ cmd, callback, error, ...args }) => {
            try {
                let result = null;
                const message = args.message ?? {};
                if (cmd === 'plugin:store|get') result = config.get(args.key) ?? null;
                else if (cmd === 'plugin:store|set') config.set(args.key, args.value);
                else if (cmd === 'get_text') result = '[INPUT_TRANSLATE]';
                else if (cmd === 'lang_detect') result = /[\u3400-\u9fff]/.test(args.text) ? 'zh_cn' : 'en';
                else if (cmd === 'tauri') {
                    switch (args.__tauriModule) {
                        case 'Path': result = message.cmd === 'join' ? message.paths.join('/') : 'C:/mock'; break;
                        case 'Os': result = ({ type: 'Windows_NT', arch: 'x86_64', version: '10.0' })[message.cmd]; break;
                        case 'App': result = '3.0.7'; break;
                        case 'Fs': result = message.cmd === 'exists' ? false : []; break;
                        case 'Event':
                            if (message.cmd === 'listen') {
                                const callbacks = events.get(message.event) ?? [];
                                callbacks.push(message.handler);
                                events.set(message.event, callbacks);
                                result = message.handler;
                            } else if (message.cmd === 'unlisten') {
                                events.set(message.event, (events.get(message.event) ?? []).filter((value) => value !== message.eventId));
                            } else if (message.cmd === 'emit') window.qaEmit(message.event, message.payload);
                            break;
                        case 'Http':
                            if (message.cmd === 'createClient') { result = 1; break; }
                            if (message.cmd !== 'httpRequest') break;
                            const request = message.options;
                            if (request.url.includes('/auth')) {
                                result = { url: request.url, status: 200, headers: {}, data: 'mock-token' };
                                break;
                            }
                            const text = request.query?.q ?? request.body?.payload?.[0]?.Text;
                            const from = request.query?.sl ?? request.query?.from;
                            const to = request.query?.tl ?? request.query?.to;
                            window.qaRequests.push({ text, from, to });
                            const fail = window.qaFail;
                            if (window.qaDelay) await new Promise((resolve) => setTimeout(resolve, window.qaDelay));
                            const translation = text.startsWith('My name')
                                ? '我叫李圣杰，是中国西安交通大学利物浦大学（XJTLU）计算机科学与软件技术专业的应届本科生。'
                                : text.startsWith('I am writing')
                                    ? '我写这封信是想询问是否有机会加入您的生物信息学与计算基因组学实验室，担任实习生或志愿者。'
                                    : /[\u3400-\u9fff]/.test(text) ? `English: ${text}` : `中文译文：${text}`;
                            const data = request.query?.q
                                ? [[[translation, text]], null]
                                : [{ translations: [{ text: translation }] }];
                            result = { url: request.url, status: fail ? 429 : 200, headers: {}, data: JSON.stringify(fail ? { error: 'Rate limited' } : data) };
                            break;
                    }
                }
                window[`_${callback}`](result);
            } catch (err) {
                window[`_${error}`](String(err));
            }
        };
    });
    try {
        await page.goto('http://pot.test/');
        const source = page.getByRole('textbox', { name: '输入原文' });
        await source.waitFor();
        await page.getByRole('button', { name: '英汉互译', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '英汉互译', exact: true }).getAttribute('aria-pressed'), 'true');
        const sample = "My name is Shengjie Li, a final-year undergraduate in Computer Science and Software Technology at Xi'an Jiaotong-Liverpool University (XJTLU), China. I am writing to ask whether I could join your Bioinformatics and Computational Genomics Lab as an intern or volunteer.";
        await source.fill(sample);
        await source.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('.sentence-target').length === 4 && Array.from(document.querySelectorAll('.sentence-target')).every((element) => element.textContent));
        const targets = page.locator('.sentence-target');
        await page.waitForTimeout(800);
        await targets.nth(0).hover();
        assert.equal(await page.locator('.sentence-source mark').textContent(), sample.split(' I am writing')[0]);
        assert.equal(await page.locator('.sentence-target.sentence-highlight').count(), 1);
        const sourceBox = await source.boundingBox();
        const backdropBox = await page.locator('.sentence-source-backdrop').boundingBox();
        assert.equal(sourceBox.width, backdropBox.width);
        await page.screenshot({ path: path.join(__dirname, 'bilingual-preview.png') });
        console.log('LAYOUT', await page.locator('.sentence-translation').evaluateAll(elements => elements.map(e => ({height:e.getBoundingClientRect().height,parent:e.parentElement.getBoundingClientRect().height,card:e.closest('[data-slot=base]')?.getBoundingClientRect().height}))));
        await targets.nth(1).focus();
        assert.ok((await page.locator('.sentence-source mark').textContent()).startsWith('I am writing'));
        await targets.nth(2).hover();
        assert.equal(await page.locator('.sentence-target.sentence-highlight').count(), 1);
        await page.mouse.move(2, 2);
        assert.equal(await page.locator('.sentence-source mark').count(), 0);
        console.log('PASS: reference paragraph, hover, keyboard focus, multiple services and highlight cleanup');

        await source.fill('你好！世界。');
        await source.press('Enter');
        await page.waitForFunction(() => Array.from(document.querySelectorAll('.sentence-target')).every((element) => element.textContent.startsWith('English:')));
        const recent = await page.evaluate(() => window.qaRequests.slice(-4));
        assert.ok(recent.every((request) => request.to === 'en'));
        await targets.nth(1).hover();
        assert.equal(await page.locator('.sentence-source mark').textContent(), '世界。');
        console.log('PASS: Chinese to English and Chinese sentence alignment');

        await source.fill('Edited text.');
        await targets.nth(0).hover();
        assert.equal(await page.locator('.sentence-source mark').count(), 0);
        await source.focus();
        const beforeIme = await page.evaluate(() => window.qaRequests.length);
        await source.dispatchEvent('compositionstart');
        await source.press('Enter');
        assert.equal(await page.evaluate(() => window.qaRequests.length), beforeIme);
        await source.dispatchEvent('compositionend');
        await source.fill('Line one');
        await source.press('Shift+Enter');
        assert.equal(await source.inputValue(), 'Line one\n');
        console.log('PASS: edited source suppresses stale alignment, IME Enter and Shift+Enter');

        await source.fill('Slow first. Slow second.');
        await page.evaluate(() => window.qaDelay = 500);
        await source.press('Enter');
        await page.waitForFunction(() => window.qaRequests.some((request) => request.text === 'Slow first.'));
        // The fourth source toolbar icon is Clear.
        await page.locator('.sentence-source').locator('..').locator('..').getByRole('button').nth(3).click();
        assert.equal(await source.inputValue(), '');
        await page.waitForTimeout(650);
        assert.equal(await targets.count(), 0);
        assert.equal(await page.evaluate(() => window.qaRequests.some((request) => request.text === 'Slow second.')), false);
        await page.evaluate(() => window.qaDelay = 0);
        console.log('PASS: clearing cancels pending translation and subsequent sentence requests');

        await page.evaluate(() => window.qaFail = true);
        await source.fill('Failure.');
        await source.press('Enter');
        await page.getByText(/Http Status: 429/).first().waitFor({ state: 'visible' });
        await page.evaluate(() => window.qaFail = false);
        await source.fill('Recovery.');
        await source.press('Enter');
        await page.getByText('中文译文：Recovery.', { exact: true }).first().waitFor();
        console.log('PASS: provider errors are visible and subsequent translation recovers');

        await page.getByRole('button', { name: '常规翻译', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('.sentence-target').length === 0);
        assert.ok(await page.locator('textarea[readonly]').count() > 0);
        await page.getByRole('button', { name: '英汉互译', exact: true }).click();
        await page.getByText('中文译文：Recovery.', { exact: true }).first().waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await targets.nth(0).hover();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.locator('.sentence-source mark').count(), 1);
        assert.deepEqual(errors, []);
        console.log('PASS: standard mode, narrow window layout and zero page errors');
    } catch (error) {
        console.error('PAGE ERRORS:', errors);
        console.error((await page.locator('body').innerText()).slice(0, 2000));
        await page.screenshot({ path: path.join(__dirname, 'failure.png') });
        throw error;
    } finally {
        await browser.close();
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
