const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
        await installMock(page, { label: 'config' });
        await page.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            window.__paragraphRequests = [];
            window.__TAURI_IPC__ = async (request) => {
                const done = (value) => window[`_${request.callback}`]?.(value);
                if (request.cmd === 'get_font_list') return done(['Arial']);
                if (request.cmd === 'plugin:store|get' && request.key === 'history_disable') return done(true);
                if (request.cmd === 'tauri' && request.__tauriModule === 'Http' && request.message.cmd === 'httpRequest') {
                    const text = request.message.options.body.payload.messages.at(-1).content;
                    window.__paragraphRequests.push(text);
                    // Simulate a provider that introduces a line break within each sentence.
                    return done({ status: 200, headers: {}, data: JSON.stringify({ choices: [{ message: { content: '译文第一部分\n第二部分。' } }] }) });
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
        const source = page.locator('.sentence-source-input');
        await source.waitFor();
        const cases = [
            { source: 'RNA structure is complex. Data is scarce. Prediction is difficult.', expected: '译文第一部分 第二部分。 译文第一部分 第二部分。 译文第一部分 第二部分。', count: 3 },
            { source: 'One. Two.\n\nThree.\nFour.', expected: '译文第一部分 第二部分。 译文第一部分 第二部分。\n\n译文第一部分 第二部分。\n译文第一部分 第二部分。', count: 4 },
        ];
        for (const fixture of cases) {
            await source.fill(fixture.source);
            await source.press('Enter');
            const result = page.locator('.sentence-translation');
            await page.waitForFunction((expected) => document.querySelector('.sentence-translation')?.textContent === expected, fixture.expected);
            assert.equal(await result.textContent(), fixture.expected);
            assert.equal(await result.locator('.sentence-target').count(), fixture.count);
            const sentence = result.locator('.sentence-target').nth(1);
            await sentence.hover();
            assert.equal(await page.locator('.sentence-source mark').textContent(), fixture.source.includes('Two.') ? 'Two.' : 'Data is scarce.');
            await sentence.focus();
            assert.ok((await sentence.getAttribute('class')).includes('sentence-highlight'));
            // The copy button is the second button in the result card's footer.
            const copy = result.locator('xpath=../following-sibling::*').locator('button').nth(1);
            await copy.click();
            assert.equal(await page.evaluate(() => window.__fixture.clipboard), fixture.expected);
        }
        await page.screenshot({ path: path.resolve(__dirname, '../../paragraph-ui.png'), fullPage: true });
        assert.deepEqual(errors, []);
        console.log('PASS: single paragraph, blank lines, hard breaks, provider wraps, sentence hover/focus and copied text.');
    } catch (error) {
        console.error(await page.locator('body').innerText());
        console.error('Page errors:', errors);
        throw error;
    } finally {
        await browser.close();
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
