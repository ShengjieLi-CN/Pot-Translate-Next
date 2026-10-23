const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
process.env.PLAYWRIGHT_MODULE_PATH ||= 'C:/Users/ShengjieLi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
const { installMock } = require('./verify-screenshot-ui.cjs');
(async () => {
    const browser = await chromium.launch({ headless: true, channel: 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1150, height: 850 } });
        const errors = []; page.on('pageerror', (e) => errors.push(e.message));
        await installMock(page, { label: 'config' });
        await page.addInitScript(() => {
            const original = window.__TAURI_IPC__;
            const state = { url: '', directory: '/夸克/Pot Translate Next', has_token: false };
            window.__openlist = { calls: [], failUpload: false, failRestore: false, removed: false };
            window.__TAURI_IPC__ = (request) => {
                const done = (value) => window[`_${request.callback}`]?.(value);
                const fail = (value) => window[`_${request.error}`]?.(value);
                window.__openlist.calls.push(request);
                if (request.cmd === 'plugin:store|get' && request.key === 'backup_type') return done('quark');
                if (request.cmd === 'quark_drive') {
                    const { operate, options } = request;
                    if (operate === 'configure') { state.url = options.url; state.directory = options.directory; state.has_token = !!options.token || state.has_token; return done(state); }
                    if (operate === 'backup') return window.__openlist.failUpload ? fail('OpenList 尚未确认上传完成') : done({ name: 'PotTranslateNext-test.zip' });
                    if (operate === 'restore') return window.__openlist.failRestore ? fail('OpenList 下载失败') : done({});
                    if (operate === 'remove') { window.__openlist.removed = true; return done({}); }
                    if (operate === 'list') return done(window.__openlist.removed ? [] : [{ name: 'old-backup.zip', size: 3 }]);
                    if (operate === 'test') return done({ count: 1 });
                    return done(state);
                }
                if (request.cmd === 'tauri' && request.__tauriModule === 'Dialog') return done(true);
                return original(request);
            };
        });
        const dist = path.resolve(__dirname, '../dist');
        await page.route('http://127.0.0.1:43827/**', async (route) => {
            const url = new URL(route.request().url());
            const relative = path.extname(url.pathname) ? decodeURIComponent(url.pathname.slice(1)) : 'index.html';
            const file = path.resolve(dist, relative); assert.ok(file.startsWith(dist + path.sep));
            const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream';
            await route.fulfill({ contentType, body: await fs.readFile(file) });
        });
        await page.goto('http://127.0.0.1:43827/backup');
        await page.getByText('夸克网盘同步 · OpenList', { exact: true }).waitFor();
        await page.getByLabel('OpenList 服务地址').fill('https://drive.example/openlist');
        await page.getByLabel('OpenList 服务令牌').fill('fixture-token');
        await page.getByLabel('夸克备份目录').fill('/夸克/备份');
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
        await page.getByText('设置已保存', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('OpenList 服务令牌').inputValue(), '');
        await page.getByRole('button', { name: '测试连接', exact: true }).click();
        await page.getByText('OpenList 连接成功', { exact: true }).waitFor();
        await page.getByRole('button', { name: '立即同步', exact: true }).click();
        await page.getByText('同步成功', { exact: true }).waitFor();
        await page.getByRole('button', { name: '恢复备份', exact: true }).click();
        await page.getByRole('button', { name: 'old-backup.zip', exact: true }).click();
        await page.getByText('恢复成功，正在重启应用', { exact: true }).waitFor();
        await page.getByRole('button', { name: '恢复备份', exact: true }).click();
        await page.getByRole('button', { name: '删除', exact: true }).click();
        await page.getByText('备份已删除', { exact: true }).waitFor();
        await page.getByText('暂无备份', { exact: true }).waitFor();
        await page.getByRole('button', { name: '打开 OpenList', exact: true }).click();
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.evaluate(() => { window.__openlist.failUpload = true; });
        await page.getByRole('button', { name: '立即同步', exact: true }).click();
        await page.getByText('OpenList 尚未确认上传完成', { exact: true }).waitFor();
        const calls = await page.evaluate(() => window.__openlist.calls);
        assert.ok(calls.some((v) => v.cmd === 'quark_drive' && v.operate === 'restore' && v.options.name === 'old-backup.zip'));
        assert.ok(calls.some((v) => v.cmd === 'quark_drive' && v.operate === 'remove' && v.options.name === 'old-backup.zip'));
        assert.ok(!calls.some((v) => ['start_auth', 'poll_auth', 'cancel_auth'].includes(v.operate)));
        assert.ok(calls.some((v) => v.__tauriModule === 'Shell' && v.message.path === 'https://drive.example/openlist'));
        await page.getByRole('button', { name: '夸克网盘', exact: true }).click();
        assert.deepEqual((await page.getByRole('menuitem').allTextContents()).sort(), ['WebDAV', '夸克网盘', '本地备份'].sort());
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
        console.log('PASS: OpenList settings/token retention/test/backup/restore/delete/errors; removed direct login; only Quark/WebDAV/local choices (mocked native IPC).');
    } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
