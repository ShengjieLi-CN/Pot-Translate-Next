const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');

async function fixture(page, options = {}) {
    await installMock(page, { label: options.config ? 'config' : 'selection_translate', noService: options.noService });
    await page.addInitScript(
        ({ options }) => {
            const base = window.__TAURI_IPC__;
            const state = (window.__selectionFixture = {
                payload: {
                    id: 1,
                    mode: options.result ? 'result' : 'badge',
                    runs: [
                        { text: 'Results\n', style: { bold: true, fontSize: 18, fontFamily: 'Georgia' } },
                        {
                            text: 'The geome-\ntrical RNA structure is predicted. Another\nsentence follows.\n\nSecond source paragraph.',
                            style: { fontSize: 12, italic: true },
                        },
                    ],
                    x: 500,
                    y: 250,
                },
                requests: [],
                fail: false,
                hold: false,
                releases: [],
                enabled: true,
                listening: true,
                captureFail: false,
                holdCapture: false,
                captureReleases: [],
                settings: {},
            });
            state.sourceRuns = state.payload.runs;
            if (options.deferred) state.payload.runs = [];
            window.__setSelection = async (payload) => {
                state.payload = payload;
                await base({
                    cmd: 'tauri',
                    __tauriModule: 'Event',
                    message: { cmd: 'emit', event: 'selection_changed', payload },
                    callback: 0,
                    error: 0,
                });
            };
            window.__TAURI_IPC__ = async (request) => {
                const done = (value) => window[`_${request.callback}`]?.(value);
                const fail = (value) => window[`_${request.error}`]?.(value);
                if (request.cmd === 'selection_payload') return done(state.payload);
                if (request.cmd === 'selection_open') {
                    await window.__setSelection({ ...state.payload, mode: 'capturing' });
                    if (state.holdCapture) await new Promise((resolve) => state.captureReleases.push(resolve));
                    await window.__setSelection({
                        ...state.payload,
                        mode: 'result',
                        runs: state.captureFail ? [] : state.sourceRuns,
                        captureError: state.captureFail ? '未读取到选中文字。请重新划词。' : null,
                    });
                    return done(null);
                }
                if (request.cmd === 'selection_set_pinned') {
                    state.pinned = request.pinned;
                    return done(null);
                }
                if (request.cmd === 'selection_dismiss') {
                    await window.__setSelection(null);
                    return done(null);
                }
                if (request.cmd === 'selection_status')
                    return done({ enabled: state.enabled, supported: true, listening: state.listening });
                if (request.cmd === 'selection_set_enabled') {
                    state.enabled = request.enabled;
                    return done(null);
                }
                if (request.cmd === 'plugin:store|set') state.settings[request.key] = request.value;
                if (
                    request.cmd === 'tauri' &&
                    request.__tauriModule === 'Http' &&
                    request.message.cmd === 'httpRequest'
                ) {
                    const text = request.message.options.body.payload.messages.at(-1).content;
                    state.requests.push(request.message.options);
                    if (state.hold) await new Promise((resolve) => state.releases.push(resolve));
                    if (state.fail) return fail('fixture network error');
                    const content = text.includes('Second source')
                        ? '第二段译文。'
                        : text.endsWith('Results')
                          ? '结果'
                          : text.includes('replacement')
                            ? '新的译文。'
                            : '预测 RNA 的几何结构。\n\n后面还有一句话。';
                    return done({
                        url: request.message.options.url,
                        status: 200,
                        headers: {},
                        data: JSON.stringify({ choices: [{ message: { content } }] }),
                    });
                }
                return base(request);
            };
        },
        { options }
    );
}

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const context = await browser.newContext({ viewport: { width: 520, height: 360 } });
    if (process.env.UI_DIST === '1') {
        const dist = path.resolve(__dirname, '../dist');
        await context.route('http://pot-ui.invalid/**', async (route) => {
            const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
            const file = path.resolve(dist, path.extname(pathname) ? pathname.slice(1) : 'index.html');
            assert.ok(file.startsWith(dist + path.sep));
            const contentType =
                { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[
                    path.extname(file)
                ] || 'application/octet-stream';
            await route.fulfill({ contentType, body: await fs.readFile(file) });
        });
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const url = process.env.UI_DIST === '1' ? 'http://pot-ui.invalid' : process.env.UI_URL || 'http://127.0.0.1:5175';
    try {
        await fixture(page);
        await page.goto(url);
        await page.getByRole('button', { name: '翻译选中文字' }).waitFor();
        if (process.env.SELECTION_BADGE_PREVIEW) await page.locator('.selection-badge').screenshot({ path: process.env.SELECTION_BADGE_PREVIEW, omitBackground: true });
        const badge = await page.getByRole('button', { name: '翻译选中文字' }).boundingBox();
        assert.equal(badge.width, 40);
        assert.equal(badge.height, 40);
        assert.equal(await page.locator('.selection-badge').evaluate(n => getComputedStyle(n).borderRadius), '50%');
        for (const selector of ['html', 'body', '#root']) {
            assert.equal(await page.locator(selector).evaluate(n => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)');
        }
        assert.equal(await page.evaluate(() => window.__selectionFixture.requests.length), 0);
        await page.getByRole('button', { name: '翻译选中文字' }).click();
        await page.waitForFunction(() => !document.querySelector('.selection-toolbar button[aria-label="复制译文"]').disabled);
        assert.equal(await page.locator('.selection-paragraph').count(), 3);
        assert.equal(
            await page.locator('.selection-paragraph').nth(1).textContent(),
            '预测 RNA 的几何结构。 后面还有一句话。'
        );
        assert.equal(await page.locator('.selection-translations br').count(), 0);
        assert.equal(
            await page
                .locator('.selection-paragraph')
                .first()
                .evaluate((n) => getComputedStyle(n).fontWeight),
            '700'
        );
        assert.equal(
            await page
                .locator('.selection-paragraph')
                .nth(1)
                .evaluate((n) => getComputedStyle(n).fontStyle),
            'italic'
        );
        assert.equal(
            await page
                .locator('.selection-paragraph')
                .nth(1)
                .evaluate((n) => getComputedStyle(n).whiteSpace),
            'normal'
        );
        assert.doesNotMatch(await page.locator('body').innerText(), /The geome|Second source|Results/);
        const requests = await page.evaluate(() => window.__selectionFixture.requests);
        assert.equal(requests.length, 3);
        assert.match(
            requests[1].body.payload.messages.at(-1).content,
            /geometrical RNA structure is predicted\. Another sentence follows\./
        );
        assert.match(requests[0].body.payload.messages[0].content, /untrusted data/);
        await page.getByRole('button', { name: '窗口置顶', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: '取消窗口置顶' }).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => window.__selectionFixture.pinned), true);
        if (process.env.SELECTION_PIN_PREVIEW) await page.screenshot({ path: process.env.SELECTION_PIN_PREVIEW, omitBackground: true });
        await page.getByRole('button', { name: '取消窗口置顶' }).click();
        assert.equal(await page.evaluate(() => window.__selectionFixture.pinned), false);
        await page.getByRole('button', { name: '复制译文' }).click();
        assert.equal(
            await page.evaluate(() => window.__fixture.clipboard),
            '结果\n\n预测 RNA 的几何结构。 后面还有一句话。\n\n第二段译文。'
        );
        await page.screenshot({ path: path.resolve('asset/selection-translation-preview.png') });

        await page.evaluate(async () => {
            window.__selectionFixture.fail = true;
            await window.__setSelection({ id: 2, mode: 'result', runs: [{ text: 'failure source' }] });
        });
        await page.getByRole('alert').filter({ hasText: 'fixture network error' }).waitFor();
        assert.doesNotMatch(await page.locator('body').innerText(), /failure source/);
        await page.evaluate(() => {
            window.__selectionFixture.fail = false;
        });
        await page.getByRole('button', { name: '重试' }).click();
        await page.waitForFunction(() => !document.querySelector('.selection-toolbar button[aria-label="复制译文"]').disabled);

        await page.evaluate(async () => {
            window.__selectionFixture.hold = true;
            await window.__setSelection({ id: 3, mode: 'result', runs: [{ text: 'stale source' }] });
        });
        await page.waitForFunction(() => window.__selectionFixture.releases.length === 1);
        await page.evaluate(async () => {
            window.__selectionFixture.hold = false;
            await window.__setSelection({ id: 4, mode: 'result', runs: [{ text: 'replacement source' }] });
        });
        await page.getByText('新的译文。', { exact: true }).waitFor();
        await page.evaluate(() => window.__selectionFixture.releases[0]());
        await page.waitForTimeout(100);
        assert.equal(await page.locator('.selection-translations').innerText(), '新的译文。');
        await page.setViewportSize({ width: 320, height: 240 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.getByRole('button', { name: '关闭划词翻译' }).click();
        await page.waitForFunction(() => !document.querySelector('.selection-result-window'));
        assert.deepEqual(errors, []);

        const empty = await context.newPage();
        await fixture(empty, { result: true, noService: true });
        await empty.goto(url);
        await empty.getByRole('alert').filter({ hasText: '启用文本翻译服务' }).waitFor();
        assert.doesNotMatch(await empty.locator('body').innerText(), /The geome|Second source|Results/);
        await empty.close();

        const deferred = await context.newPage();
        await deferred.setViewportSize({ width: 520, height: 360 });
        await fixture(deferred, { deferred: true });
        await deferred.goto(url);
        await deferred.getByRole('button', { name: '翻译选中文字' }).waitFor();
        assert.equal(await deferred.evaluate(() => window.__selectionFixture.requests.length), 0);
        await deferred.evaluate(() => {
            window.__selectionFixture.holdCapture = true;
        });
        await deferred.getByRole('button', { name: '翻译选中文字' }).click();
        await deferred.waitForFunction(() => window.__selectionFixture.captureReleases.length === 1);
        await deferred.getByRole('status').filter({ hasText: '正在读取选中文字' }).waitFor();
        assert.equal(await deferred.getByRole('button', { name: '复制译文' }).isDisabled(), true);
        assert.doesNotMatch(await deferred.locator('body').innerText(), /The geome|Second source|Results/);
        assert.equal(await deferred.evaluate(() => window.__selectionFixture.requests.length), 0);
        await deferred.evaluate(() => {
            window.__selectionFixture.holdCapture = false;
            window.__selectionFixture.captureFail = true;
            window.__selectionFixture.captureReleases[0]();
        });
        await deferred.getByRole('alert').filter({ hasText: '未读取到选中文字' }).waitFor();
        assert.equal(await deferred.evaluate(() => window.__selectionFixture.requests.length), 0);
        await deferred.evaluate(() => {
            window.__selectionFixture.captureFail = false;
        });
        await deferred.getByRole('button', { name: '重试' }).click();
        await deferred.getByText('第二段译文。', { exact: true }).waitFor();
        assert.doesNotMatch(await deferred.locator('body').innerText(), /The geome|Second source|Results|未读取到/);
        await deferred.keyboard.press('Escape');
        await deferred.waitForFunction(() => !document.querySelector('.selection-result-window'));
        await deferred.close();

        const settings = await context.newPage();
        await settings.setViewportSize({ width: 1000, height: 750 });
        await fixture(settings, { config: true });
        await settings.goto(`${url}/selection`);
        await settings.waitForURL('**/translate');
        assert.equal(await settings.getByRole('button', { name: '划词翻译', exact: true }).count(), 0);
        await settings.getByRole('switch', { name: '启用划词翻译按钮' }).focus();
        await settings.getByRole('switch', { name: '启用划词翻译按钮' }).press('Space');
        await settings.waitForFunction(() => window.__selectionFixture.enabled === false);
        assert.equal(await settings.evaluate(() => window.__selectionFixture.enabled), false);
        await settings.getByRole('status').filter({ hasText: '划词翻译已关闭' }).waitFor();
        await settings.getByLabel('划词翻译服务', { exact: true }).selectOption('openai@second');
        await settings.getByLabel('划词目标语言', { exact: true }).selectOption('en');
        await settings.waitForFunction(
            () =>
                window.__selectionFixture.settings.selection_translate_service === 'openai@second' &&
                window.__selectionFixture.settings.selection_target_language === 'en'
        );
        await settings.getByRole('button', { name: '启用划词翻译', exact: true }).click();
        await settings.getByRole('status').filter({ hasText: '划词监听已就绪' }).waitFor();
        await settings.evaluate(() => {
            window.__selectionFixture.listening = false;
        });
        await settings.getByRole('alert').filter({ hasText: '监听尚未就绪' }).waitFor();
        await settings.close();
        console.log(
            'Selection UI passed: deferred selection badge, no transmission before click, capture failure/retry, listener diagnostics, translation only, paragraphs/font styles, PDF restoration, copy, stale result isolation, dismiss and settings.'
        );
    } catch (error) {
        console.error(await page.locator('body').innerText());
        throw error;
    } finally {
        await browser.close();
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
