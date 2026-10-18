// Publishable examples: synthetic text only, no desktop capture or live account.
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        await installMock(page, { label: 'config' });
        await page.addInitScript(() => {
            const base = window.__TAURI_IPC__;
            window.__TAURI_IPC__ = (request) => {
                const reply = (value) => window[`_${request.callback}`]?.(value);
                if (request.cmd === 'get_font_list') return reply(['Arial']);
                if (request.__tauriModule === 'App') return reply('3.2.1');
                if (request.__tauriModule === 'Http' && request.message?.cmd === 'httpRequest') {
                    const prompt = request.message.options.body.payload.messages.at(-1).content;
                    const text = prompt.includes('Technical terms') ? '专业术语应结合上下文准确翻译。' : '科学模型帮助我们理解周围的世界。';
                    return reply({ status: 200, headers: {}, data: JSON.stringify({ choices: [{ message: { content: text } }] }) });
                }
                return base(request);
            };
        });
        await page.goto(process.env.UI_URL || 'http://127.0.0.1:5173/input');
        await page.locator('.sentence-source-input').fill('Scientific models help us understand the world around us. Technical terms should be translated accurately in context.');
        await page.getByText('专业术语应结合上下文准确翻译。', { exact: true }).waitFor();
        await page.getByText('科学模型帮助我们理解周围的世界。', { exact: true }).hover();
        await page.screenshot({ path: 'asset/main-translation-preview.png' });
        fs.copyFileSync('asset/main-translation-preview.png', 'asset/bilingual-preview.png');
        console.log('Generated synthetic input translation previews.');
    } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
