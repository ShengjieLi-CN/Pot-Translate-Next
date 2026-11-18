const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { fixture } = require('./verify-selection-ui.cjs');
(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    try {
        for (const mode of ['fallback', 'volcengine', 'all-fail']) {
            const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await fixture(page, { result: true });
            await page.addInitScript((mode) => {
                const base = window.__TAURI_IPC__,
                    state = (window.__ttsCase = { calls: [], mode });
                const text =
                    'The same subjects are measured multiple times. A repeated measures analysis compares the dependent groups. '.repeat(
                        25
                    );
                window.__selectionFixture.payload.runs = [{ text, style: { fontSize: 12 } }];
                state.text = text.trim();
                const oldCreate = window.AudioContext.prototype.createBufferSource;
                window.AudioContext.prototype.createBufferSource = function () {
                    const source = oldCreate.call(this);
                    const start = source.start;
                    source.start = () => {
                        start();
                        setTimeout(() => source.onended?.(), 1);
                    };
                    return source;
                };
                window.__TAURI_IPC__ = (request) => {
                    const done = (value) => window[`_${request.callback}`]?.(value);
                    if (request.cmd === 'plugin:store|get') {
                        if (request.key === 'tts_service_list')
                            return done(
                                mode === 'volcengine'
                                    ? ['plugin.test.volcengine@test']
                                    : [
                                          'plugin.test.disabled@test',
                                          'plugin.test.youdao@test',
                                          'plugin.test.volcengine@test',
                                      ]
                            );
                        if (request.key.startsWith('plugin.test.'))
                            return done({ enable: !request.key.includes('disabled') });
                    }
                    if (request.__tauriModule === 'Fs' && request.message.cmd === 'readTextFile') {
                        const path = request.message.path;
                        if (path.includes('/tts/')) {
                            const title = path.includes('youdao') ? '有道 TTS' : '火山 TTS';
                            if (path.endsWith('info.json'))
                                return done(JSON.stringify({ display: title, language: { en: 'en' } }));
                            if (path.endsWith('main.js'))
                                return done(
                                    `async function tts(text,lang,options){const s=window.__ttsCase;s.calls.push({text,lang,title:${JSON.stringify(title)}});if(${JSON.stringify(title)}==='有道 TTS')throw 'Http Request Error\\nHttp Status: 500\\n'+JSON.stringify(Array.from(new TextEncoder().encode(JSON.stringify({msg:'returned null audio'}))));if(s.mode==='all-fail'||new TextEncoder().encode(text).length>480)throw JSON.stringify({audio:null,base_resp:{status_code:400,status_message:''}});return [82,73,70,70];}`
                                );
                        }
                    }
                    return base(request);
                };
            }, mode);
            await page.goto(process.env.UI_URL || 'http://127.0.0.1:5173');
            await page.getByRole('button', { name: '朗读选中原文' }).click();
            if (mode === 'all-fail') {
                const alert = page.getByRole('alert').filter({ hasText: '原文朗读失败' });
                await alert.waitFor();
                const message = await alert.innerText();
                assert.match(message, /有道 TTS/);
                assert.match(message, /返回空音频/);
                assert.doesNotMatch(message, /\[123,/);
            } else {
                await page.waitForFunction(
                    () =>
                        window.__ttsCase.calls
                            .filter((c) => c.title === '火山 TTS')
                            .map((c) => c.text)
                            .join('')
                            .trim() === window.__ttsCase.text
                );
                await page.getByRole('button', { name: '朗读选中原文' }).waitFor();
                const state = await page.evaluate(() => ({
                    calls: window.__ttsCase.calls,
                    starts: window.__selectionFixture.audioStarts,
                }));
                const successful = state.calls.filter((c) => c.title === '火山 TTS');
                assert.ok(successful.length > 1);
                assert.equal(state.starts, successful.length);
                assert.equal(state.calls.filter((c) => c.title === '有道 TTS').length, mode === 'fallback' ? 1 : 0);
                if (mode === 'fallback')
                    await page.getByRole('status').filter({ hasText: '已切换至火山 TTS' }).waitFor();
            }
            assert.deepEqual(errors, []);
            await page.close();
        }
        const main = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        const mainErrors = [];
        main.on('pageerror', (e) => mainErrors.push(e.message));
        await fixture(main, { config: true, result: true });
        await main.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            window.__TAURI_IPC__ = (request) => {
                const done = (value) => window[`_${request.callback}`]?.(value);
                if (request.cmd === 'get_font_list') return done(['Arial']);
                if (request.cmd === 'plugin:store|get' && request.key === 'history_disable') return done(true);
                if (
                    request.__tauriModule === 'Fs' &&
                    request.message.cmd === 'readTextFile' &&
                    request.message.path.includes('/tts/') &&
                    request.message.path.endsWith('info.json')
                )
                    return done(JSON.stringify({ language: { en: 'en-US', zh_cn: 'zh-CN' } }));
                return base(request);
            };
            const oldCreate = window.AudioContext.prototype.createBufferSource;
            window.AudioContext.prototype.createBufferSource = function () {
                const source = oldCreate.call(this);
                const start = source.start;
                source.start = () => {
                    start();
                    setTimeout(() => source.onended?.(), 1);
                };
                return source;
            };
        });
        await main.goto(process.env.UI_URL || 'http://127.0.0.1:5173');
        const input = 'An example sentence for reading aloud. '.repeat(30).trim();
        await main.locator('.sentence-source-input').fill(input);
        await main.locator('.sentence-translation').first().waitFor();
        await main.getByRole('button', { name: '朗读原文', exact: true }).click();
        await main.waitForFunction(
            (text) => window.__selectionFixture.speechCalls.map((c) => c.text).join('') === text,
            input
        );
        await main.waitForFunction(() => window.__selectionFixture.audioSource?.onended === null);
        const source = await main.evaluate(() => window.__selectionFixture.speechCalls);
        assert.ok(source.length > 1);
        assert.ok(source.every((c) => c.lang === 'en-US' && c.config.apiKey === 'fixture-voice-key' && c.hasUtils));
        await main.evaluate(() => {
            window.__selectionFixture.speechCalls = [];
        });
        await main.getByRole('button', { name: '朗读译文', exact: true }).click();
        await main.waitForFunction(() => window.__selectionFixture.speechCalls.length > 0);
        const target = await main.evaluate(() => window.__selectionFixture.speechCalls);
        assert.ok(target.every((c) => c.lang === 'zh-CN'));
        assert.match(target[0].text, /预测 RNA/);
        assert.deepEqual(mainErrors, []);
        await main.close();
        console.log(
            'Speech UI passed: captured binary 500, enabled-provider fallback, direct long Volcengine text, full ordered playback and readable all-failed errors, source and target buttons with language/config forwarding.'
        );
    } finally {
        await browser.close();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
