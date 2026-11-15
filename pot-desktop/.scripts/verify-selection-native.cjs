// Run against a local Windows build launched with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223.
// Uses real selection capture, Tauri commands and native WebView windows.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const invoke = (page, cmd, args = {}) => page.evaluate(({ cmd, args }) => new Promise((resolve, reject) => {
    const callback = Math.floor(Math.random() * 1e9);
    const error = callback + 1;
    const cleanup = () => { delete window[`_${callback}`]; delete window[`_${error}`]; };
    window[`_${callback}`] = value => { cleanup(); resolve(value); };
    window[`_${error}`] = value => { cleanup(); reject(new Error(value)); };
    window.__TAURI_IPC__({ cmd, ...args, callback, error });
}), { cmd, args });

const nativeWindow = (page, type, extra = {}) => invoke(page, 'tauri', {
    __tauriModule: 'Window', message: { cmd: 'manage', data: { cmd: { type, ...extra } } },
});

(async () => {
    const app = await chromium.connectOverCDP(process.env.POT_CDP_URL || 'http://127.0.0.1:9223');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pot-selection-test-'));
    const controlFile = path.join(fixtureDir, 'selection.json');
    const sourceProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(__dirname, 'selection-native-source.ps1'), '-ControlFile', controlFile], {stdio: 'pipe'});
    let sourceErrors = '';
    sourceProcess.stderr.on('data', data => { sourceErrors += data.toString(); });
    let requestId = 0;
    const created = [];
    try {
        const context = app.contexts()[0];
        const open = async text => {
            const next = context.waitForEvent('page', { timeout: 15000 });
            fs.writeFileSync(controlFile, JSON.stringify({id: ++requestId, text}));
            const page = await next;
            created.push(page);
            await page.waitForFunction(() => window.__TAURI_IPC__);
            await page.evaluate(() => {
                const original = window.__TAURI_IPC__;
                window.__resizeTrace = [];
                window.__TAURI_IPC__ = request => {
                    if (request.cmd === 'selection_resize') window.__resizeTrace.push({id: request.id, width: request.width, height: request.height, viewport: [innerWidth, innerHeight]});
                    return original(request);
                };
            });
            await page.waitForFunction(() => document.querySelector('.selection-result-window'), { timeout: 15000 });
            let payload;
            for (let i = 0; i < 100; i++) {
                payload = await invoke(page, 'selection_payload');
                if (payload?.mode === 'result') break;
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            assert.equal(payload.mode, 'result');
            assert.equal(payload.captureError, null);
            assert.equal(payload.runs.map(run => run.text).join('').trim(), text);
            const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpi: devicePixelRatio }));
            assert.equal(dimensions.width, 300, JSON.stringify(dimensions));
            assert.equal(dimensions.height, 400, JSON.stringify(dimensions));
            const physical = await nativeWindow(page, 'innerSize');
            assert.equal(physical.width, Math.round(300 * dimensions.dpi));
            assert.equal(physical.height, Math.round(400 * dimensions.dpi));
            return { page, payload, dimensions };
        };
        const first = await open('First independent selection window.');
        await first.page.getByRole('button', { name: '窗口置顶', exact: true }).click();
        await first.page.getByRole('button', { name: '取消窗口置顶' }).waitFor();
        await nativeWindow(first.page, 'setPosition', {payload: {type: 'Logical', data: {x: 800, y: 100}}});
        const second = await open('Second independent selection window.');
        assert.deepEqual(await invoke(first.page, 'selection_payload'), first.payload);
        assert.equal(await first.page.getByRole('button', { name: '取消窗口置顶' }).count(), 1);
        assert.equal(await second.page.getByRole('button', { name: '窗口置顶', exact: true }).count(), 1);
        // A result cannot pin or resize another result by supplying its ID.
        await assert.rejects(invoke(second.page, 'selection_set_pinned', { id: first.payload.id, pinned: false }));
        await nativeWindow(first.page, 'setSize', { payload: { type: 'Logical', data: { width: 680, height: 640 } } });
        const third = await open('Third independent selection window.');
        assert.deepEqual(await invoke(second.page, 'selection_payload'), second.payload);
        assert.deepEqual(await first.page.evaluate(() => [innerWidth, innerHeight]), [680, 640]);
        await Promise.all([second.page.waitForEvent('close'), second.page.getByRole('button', { name: '关闭划词翻译' }).click()]);
        assert.equal(first.page.isClosed(), false);
        assert.equal(third.page.isClosed(), false);
        assert.deepEqual(await invoke(first.page, 'selection_payload'), first.payload);
        // Exercise the actual WebView measurement and native resize with long
        // rendered content, independent of network/provider response timing.
        const label = await third.page.evaluate(() => window.__TAURI_METADATA__.__currentWindow.label);
        await invoke(third.page, 'tauri', {__tauriModule: 'Event', message: {
            cmd: 'emit', event: 'selection_changed', windowLabel: label,
            payload: {...third.payload, captureError: '窗口自动适配测试文本。'.repeat(400)},
        }});
        await third.page.waitForFunction(() => innerWidth > 300 && innerHeight > 400);
        const grownSize = await third.page.evaluate(() => ({width: innerWidth, height: innerHeight}));
        assert.ok(grownSize.width <= 480 && grownSize.height <= 640, JSON.stringify(grownSize));
        assert.equal(await third.page.locator('.selection-content').evaluate(n => n.scrollHeight > n.clientHeight), true);
        assert.deepEqual(await first.page.evaluate(() => [innerWidth, innerHeight]), [680, 640]);
        await Promise.all([third.page.waitForEvent('close'), third.page.keyboard.press('Escape')]);
        assert.equal(first.page.isClosed(), false);
        console.log(JSON.stringify({ passed: true, windows: 3, defaultSize: first.dimensions, grownSize,
            checks: ['native selection capture', 'independent payloads', 'pinned window permits new selections',
                'per-window commands', 'native content auto-fit and overflow scrolling', 'manual resize preserved', 'close isolation', 'Escape isolation'] }));
    } catch (error) {
        if (sourceErrors) console.error(sourceErrors);
        if (fs.existsSync(controlFile + '.error')) console.error(fs.readFileSync(controlFile + '.error', 'utf8'));
        for (const page of created) if (!page.isClosed()) console.error(await page.evaluate(() => ({label: window.__TAURI_METADATA__.__currentWindow.label, size: [innerWidth, innerHeight], trace: window.__resizeTrace})));
        throw error;
    } finally {
        for (const page of created) if (!page.isClosed()) await nativeWindow(page, 'close').catch(() => {});
        sourceProcess.kill();
        await app.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
