const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');
(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await installMock(page);
        await page.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            const state = (window.__paddle = { runs: [], writes: [], removals: [], empty: false });
            window.__TAURI_IPC__ = (request) => {
                const reply = (value) => window[`_${request.callback}`](value);
                if (request.cmd === 'plugin:store|get' && request.key === 'recognize_service_list')
                    return reply(['plugin.com.pot-app.paddle@test']);
                if (request.__tauriModule === 'Fs') {
                    const message = request.message;
                    if (message.cmd === 'readTextFile' && message.path.endsWith('info.json'))
                        return reply(
                            JSON.stringify({ display: 'Paddle OCR', language: { auto: 'chinese', en: 'en' } })
                        );
                    if (message.cmd === 'readTextFile' && message.path.endsWith('main.js'))
                        return reply(`async function recognize(base64, lang, options) {
                        const result = await options.utils.run('PaddleOCR-json.exe', ['--image_path=shared/pot_screenshot_cut.png', '--config_path=models/config_' + lang + '.txt']);
                        const json = JSON.parse(result.stdout.split('OCR init completed.')[1].trim());
                        return json.data.map(line => line.text).join('\\n');
                    }`);
                    if (message.cmd === 'writeFile') {
                        state.writes.push(message.path);
                        return reply(null);
                    }
                    if (message.cmd === 'removeFile') {
                        state.removals.push(message.path);
                        return reply(null);
                    }
                }
                if (request.cmd === 'run_binary') {
                    state.runs.push(request.args);
                    return reply({
                        status: 0,
                        stderr: '',
                        stdout:
                            'OCR init completed.\n' +
                            JSON.stringify(
                                state.empty
                                    ? { code: 101, data: 'No text' }
                                    : {
                                          code: 100,
                                          data: [
                                              {
                                                  text: 'Collection code reminder',
                                                  score: 0.99,
                                                  box: [
                                                      [40, 40],
                                                      [840, 40],
                                                      [840, 80],
                                                      [40, 80],
                                                  ],
                                              },
                                              {
                                                  text: 'The second panel is separate.',
                                                  score: 0.99,
                                                  box: [
                                                      [1040, 40],
                                                      [1600, 40],
                                                      [1600, 80],
                                                      [1040, 80],
                                                  ],
                                              },
                                          ],
                                      }
                            ),
                    });
                }
                return base(request);
            };
        });
        await page.goto(process.env.UI_URL || 'http://127.0.0.1:5173');
        await page.waitForFunction(() => document.querySelector('img.fixed')?.naturalWidth > 0);
        await page.mouse.move(194, 160);
        await page.mouse.down();
        await page.mouse.move(1064, 460);
        await page.mouse.up();
        await page.getByText('翻译完成', { exact: false }).waitFor();
        assert.equal(await page.locator('.screenshot-block').count(), 2);
        const first = await page.locator('.screenshot-block').first().boundingBox();
        assert.ok(Math.abs(first.x - 212) < 1 && Math.abs(first.y - 178) < 1);
        const state = await page.evaluate(() => window.__paddle);
        assert.equal(state.runs.length, 2, 'auto English should retry with the installed English model');
        assert.ok(
            state.runs.every(
                (args) =>
                    args.includes('--limit_side_len=4096') &&
                    args.some((arg) => /screenshot-layout-.*\.png/.test(arg)) &&
                    !args.some((arg) => arg.includes('pot_screenshot_cut.png'))
            )
        );
        assert.equal(state.writes.length, 1);
        assert.deepEqual(state.writes, state.removals);
        await page.evaluate(() => {
            window.__paddle.empty = true;
        });
        await page.getByRole('button', { name: '重试', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '未识别到完整文字' }).waitFor();
        const retried = await page.evaluate(() => window.__paddle);
        assert.equal(retried.writes.length, 2);
        assert.notEqual(retried.writes[0], retried.writes[1]);
        assert.deepEqual(retried.writes, retried.removals);
        assert.deepEqual(errors, []);
        console.log(
            'Paddle screenshot passed: native quadrilateral geometry, scaling, English model selection, private capture files, cleanup and no-text retry.'
        );
    } finally {
        await browser.close();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
