const { chromium } = require('C:/Users/ShengjieLi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
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
        window.__TAURI_METADATA__ = { __windows: [{ label: 'config' }], __currentWindow: { label: 'config' } };
        const config = new Map(Object.entries({
            app_language: 'zh_cn', app_font_size: 16, app_theme: 'light', app_font: 'Arial', app_fallback_font: 'Microsoft YaHei',
            translate_service_list: ['google', 'bing'], translate_close_on_blur: false,
            history_disable: true, translate_detect_engine: 'local', translate_hide_window: true, hide_source: true, hide_language: true,
            google: {}, bing: {}, lingva_tts: {},
        }));
        const events = new Map();
        window.qaNativeCalls = [];
        window.qaDetectionRequests = [];
        window.qaDetectDelay = 0;
        window.qaFailDetect = false;
        window.qaSetConfig = (key, value) => { config.set(key,value); window.qaEmit(key + '_changed', value); }; 
        window.qaRequests = [];
        window.qaDelay = 0;
        window.qaFail = false;
        window.qaEmit = (event, payload) => {
            for (const callback of events.get(event) ?? []) window[`_${callback}`]?.({ event, payload });
        };
        window.__TAURI_IPC__ = async ({ cmd, callback, error, ...args }) => {
            window.qaNativeCalls.push({cmd, module:args.__tauriModule, action:args.message?.data?.cmd?.type});
            try {
                let result = null;
                const message = args.message ?? {};
                if (cmd === 'plugin:store|get') result = config.get(args.key) ?? null;
                else if (cmd === 'plugin:store|set') config.set(args.key, args.value);
                else if (cmd === 'get_text') throw new Error('Main page must not consume popup input');
                else if (cmd === 'lang_detect') { window.qaDetectionRequests.push(args.text); if(window.qaDetectDelay) await new Promise(r=>setTimeout(r,window.qaDetectDelay)); if(window.qaFailDetect) throw new Error('Detection unavailable'); result = /[\u3400-\u9fff]/.test(args.text) ? 'zh_cn' : 'en'; }
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
        await page.waitForURL('**/input');
        const source = page.getByRole('textbox', { name: '输入原文' });
        await source.waitFor({ state: 'visible' });
        await page.getByRole('heading', { name: '输入翻译', exact: true }).waitFor();
        await page.getByRole('button', { name: '输入翻译', exact: true }).waitFor();
        await page.getByText('翻译结果将在这里显示').waitFor();
        await page.getByRole('button', { name: '源语言', exact: true }).waitFor();
        await page.getByRole('button', { name: '目标语言', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '翻译', exact: true }).isDisabled(), true);
        console.log('PASS: main window defaults to input translation with native sidebar, editable source, language bar and result placeholder');

        const sample = "My name is Shengjie Li, a final-year undergraduate in Computer Science and Software Technology at Xi'an Jiaotong-Liverpool University (XJTLU), China. I am writing to ask whether I could join your Bioinformatics and Computational Genomics Lab as an intern or volunteer.";
        const targets = page.locator('.sentence-target');
        await source.fill(sample);
        await source.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('.sentence-target').length === 2 && [...document.querySelectorAll('.sentence-target')].every(e => e.textContent));
        assert.deepEqual(await page.evaluate(() => window.qaDetectionRequests), [sample]);
        assert.equal(await page.evaluate(() => window.qaRequests.at(-1).to), 'zh-CN');
        await page.waitForTimeout(650);
        await targets.first().hover();
        assert.equal(await page.locator('.sentence-source mark').textContent(), sample.split(' I am writing')[0]);
        assert.equal(await page.locator('.sentence-target.sentence-highlight').count(), 1);
        assert.equal(await page.locator('.sentence-source mark').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(255, 234, 194)');
        await page.screenshot({ path: path.join(__dirname, 'main-page-preview.png') });
        await targets.nth(1).focus();
        assert.ok((await page.locator('.sentence-source mark').textContent()).startsWith('I am writing'));
        await page.mouse.move(5, 5);
        assert.equal(await page.locator('.sentence-source mark').count(), 0);
        console.log('PASS: actual language detection path, aligned hover, keyboard focus and original light-theme colors');

        await source.fill('你好！世界。');
        await source.press('Enter');
        await page.waitForFunction(() => [...document.querySelectorAll('.sentence-target')].every(e => e.textContent.startsWith('English:')));
        assert.equal(await page.evaluate(() => window.qaRequests.at(-1).to), 'en');
        await targets.nth(1).hover();
        assert.equal(await page.locator('.sentence-source mark').textContent(), '世界。');
        await page.getByRole('button', { name: '源语言', exact: true }).click();
        await page.getByRole('menuitem', { name: '英语', exact: true }).click();
        await page.waitForFunction(() => window.qaRequests.at(-1).from === 'en');
        await page.getByRole('button', { name: '源语言', exact: true }).click();
        await page.getByRole('menuitem', { name: '自动检测', exact: true }).click();
        await page.getByRole('button', { name: '谷歌翻译', exact: true }).click();
        await page.getByRole('menuitem', { name: '必应翻译', exact: true }).click();
        await page.waitForFunction(() => window.qaRequests.at(-1).from === '');
        console.log('PASS: Chinese-to-English, manual source language selection and existing service switcher');

        await source.fill('Draft retained across settings navigation.');
        await page.getByRole('button', { name: '翻译设置', exact: true }).click();
        await page.waitForURL('**/translate');
        await page.getByRole('button', { name: '输入翻译', exact: true }).click();
        await source.waitFor();
        assert.equal(await source.inputValue(), 'Draft retained across settings navigation.');
        await targets.first().hover();
        assert.equal(await page.locator('.sentence-source mark').count(), 0);
        await source.focus();
        const requestsBeforeIme = await page.evaluate(() => window.qaRequests.length);
        await source.dispatchEvent('compositionstart');
        await source.press('Enter');
        assert.equal(await page.evaluate(() => window.qaRequests.length), requestsBeforeIme);
        await source.dispatchEvent('compositionend');
        await source.fill('Line one');
        await source.press('Shift+Enter');
        assert.equal(await source.inputValue(), 'Line one\n');
        console.log('PASS: settings navigation retains draft, stale alignment is suppressed, IME Enter and multiline editing');

        await page.evaluate(() => window.qaDelay = 400);
        await source.fill('Slow first. Slow second.');
        await source.press('Enter');
        await page.waitForFunction(() => window.qaRequests.some(r => r.text === 'Slow first.'));
        await page.getByRole('button', { name: '清空', exact: true }).click();
        await page.waitForTimeout(550);
        assert.equal(await source.inputValue(), '');
        assert.equal(await targets.count(), 0);
        assert.equal(await page.evaluate(() => window.qaRequests.some(r => r.text === 'Slow second.')), false);
        await page.evaluate(() => { window.qaDelay = 0; window.qaDetectDelay = 400; });
        await source.fill('Pending language detection.');
        await source.press('Enter');
        await page.getByRole('button', { name: '清空', exact: true }).click();
        await page.waitForTimeout(550);
        assert.equal(await targets.count(), 0);
        assert.equal(await page.evaluate(() => window.qaRequests.some(r => r.text === 'Pending language detection.')), false);
        await page.evaluate(() => window.qaDetectDelay = 0);
        console.log('PASS: clear cancels both provider results and pending language detection');

        await page.evaluate(() => window.qaSetConfig('dynamic_translate', true));
        await source.fill('Old draft.');
        await source.fill('Newest draft.');
        await page.getByText('中文译文：Newest draft.', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.qaRequests.some(r => r.text === 'Old draft.')), false);
        await page.evaluate(() => { window.qaSetConfig('dynamic_translate', false); window.qaFailDetect = true; });
        await source.fill('Detection failure.');
        await source.press('Enter');
        await page.getByText(/Detection unavailable/).first().waitFor();
        await page.evaluate(() => { window.qaFailDetect = false; window.qaFail = true; });
        await source.fill('Provider failure.');
        await page.getByRole('button', { name: '翻译', exact: true }).click();
        await page.getByText(/Http Status: 429/).first().waitFor({ state: 'visible' });
        await page.evaluate(() => window.qaFail = false);
        await source.fill(sample);
        await source.press('Enter');
        await page.waitForFunction(() => document.querySelector('.sentence-target')?.textContent.startsWith('我叫'));
        console.log('PASS: dynamic translation uses latest draft, detection/provider errors are handled, and translation recovers');

        await page.getByText(/Detection unavailable/).first().waitFor({state:'hidden'});
        await page.evaluate(() => window.qaSetConfig('app_theme', 'dark'));
        await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
        await page.waitForTimeout(650);
        await targets.first().hover();
        assert.equal(await page.locator('.sentence-source mark').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(112, 90, 40)');
        await page.screenshot({ path: path.join(__dirname, 'main-page-dark.png') });
        await page.setViewportSize({ width: 800, height: 600 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.ok((await source.boundingBox()).x >= 230);
        await page.evaluate(() => window.qaSetConfig('app_theme', 'light'));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(__dirname, 'main-page-800.png') });
        await page.evaluate(() => window.qaSetConfig('translate_service_list', ['bing']));
        await page.getByRole('button', {name:'必应翻译',exact:true}).waitFor();
        await page.waitForFunction(() => window.qaRequests.at(-1).from === '');
        await page.evaluate(() => window.qaSetConfig('translate_service_list', []));
        await page.getByText('请先启用一个翻译服务，然后在这里输入内容进行翻译。').waitFor();
        assert.equal(await page.getByRole('button', { name: '翻译', exact: true }).isDisabled(), true);
        await source.waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '前往服务设置', exact: true }).waitFor();
        const invalidCalls = await page.evaluate(() => window.qaNativeCalls.filter(c => c.cmd === 'get_text' || ['hide', 'close'].includes(c.action)));
        assert.deepEqual(invalidCalls, []);
        assert.deepEqual(errors, []);
        console.log('PASS: original dark theme, 800px layout, empty service state and no popup/window side effects or page errors');
    } catch (error) {
        console.error('PAGE ERRORS:', errors);
        console.error((await page.locator('body').innerText()).slice(0, 2500));
        await page.screenshot({ path: path.join(__dirname, 'main-page-failure.png') });
        throw error;
    } finally {
        await browser.close();
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
