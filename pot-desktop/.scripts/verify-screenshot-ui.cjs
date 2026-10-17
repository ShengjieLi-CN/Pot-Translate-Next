// Run against `pnpm dev --port 5173`. No live credentials or network services are used.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
let debugPage;

async function installMock(page, options = {}) {
    await page.route('http://screenshot.invalid/**', async (route) => {
        const data = await page.evaluate(() => window.__fixture.fullImage.split(',')[1]);
        await route.fulfill({ contentType: 'image/png', body: Buffer.from(data, 'base64') });
    });
    await page.addInitScript(
        ({ options }) => {
            window.__TAURI_METADATA__ = { __currentWindow: { label: options.label || 'screenshot' }, __windows: [] };
            const canvas = document.createElement('canvas');
            canvas.width = 1280;
            canvas.height = 720;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#e4e7ec';
            ctx.fillRect(0, 0, 1280, 720);
            ctx.fillStyle = '#fff';
            ctx.fillRect(180, 36, 920, 660);
            ctx.fillStyle = '#374151';
            ctx.font = '14px Arial';
            ctx.fillText('Pot Translate Next 3.1.0 · Screenshot translation', 210, 65);
            ctx.fillStyle = '#111827';
            ctx.font = 'bold 27px Georgia';
            ctx.fillText('Accurate RNA structure prediction', 210, 116);
            ctx.font = '16px Georgia';
            const left = [
                'Abstract',
                'RNA structure prediction connects molecular',
                'biology with computational methods.',
                'An end-to-end model supports ab initio RNA',
                'structure prediction from RNA sequences.',
                '',
                'The geome-',
                'trical structure is evaluated against',
                'experimental data. RNA and DNA retain',
                'their standard abbreviations.',
            ];
            const right = [
                'Methods',
                'A neural network represents molecular',
                'interactions and geometrical constraints.',
                'Professional terminology depends on the',
                'discipline of the complete document.',
                '',
                'Results',
                'The model predicts structures and',
                'interhelical angles. Formula: E = mc².',
                'The paragraphs preserve their hierarchy.',
            ];
            left.forEach((text, i) => ctx.fillText(text, 210, 190 + i * 25));
            right.forEach((text, i) => ctx.fillText(text, 650, 190 + i * 25));
            const fullImage = canvas.toDataURL('image/png');
            let cropped = '',
                listenerId = 0,
                cropWidth = 870,
                cropHeight = 300;
            const listeners = new Map();
            const settings = {
                app_language: 'zh_cn',
                app_theme: 'light',
                translate_detect_engine: 'local',
                translate_service_list: options.noService ? [] : ['openai@test', 'openai@second'],
                recognize_service_list: ['system'],
                recognize_language: 'auto',
                'openai@test': {
                    service: 'openai',
                    requestPath: 'https://translation.invalid/v1/chat/completions',
                    model: 'fixture',
                    apiKey: 'fake-test-key',
                    stream: false,
                    instanceName: '专业翻译',
                },
                'openai@second': {
                    service: 'openai',
                    requestPath: 'https://translation.invalid/v1/chat/completions',
                    model: 'fixture',
                    apiKey: 'fake-test-key',
                    stream: false,
                    instanceName: '备用服务',
                },
            };
            window.__fixture = {
                fullImage,
                calls: [],
                fail: false,
                delay: 0,
                clipboard: '',
                closed: false,
                mode: options.recognize ? false : true,
            };
            window.__TAURI__ = { convertFileSrc: () => 'http://screenshot.invalid/frozen.png' };
            const paragraphs = [
                ['Abstract', 16, 12, 105, 20, '摘要'],
                [
                    'RNA structure prediction connects molecular biology with computational methods. An end-to-end model supports ab initio RNA structure prediction from RNA sequences.',
                    16,
                    44,
                    385,
                    94,
                    'RNA结构预测将分子生物学与计算方法相结合。端到端模型支持根据RNA序列进行从头RNA结构预测。',
                ],
                [
                    'The geome-\ntrical structure is evaluated against experimental data. RNA and DNA retain their standard abbreviations.',
                    16,
                    170,
                    385,
                    94,
                    '利用实验数据评估几何结构。RNA和DNA保留其标准缩写。',
                ],
                ['Methods', 456, 12, 105, 20, '方法'],
                [
                    'A neural network represents molecular interactions and geometrical constraints. Professional terminology depends on the discipline of the complete document.',
                    456,
                    44,
                    385,
                    94,
                    '神经网络表示分子相互作用和几何约束。根据全文所属领域采用专业术语。',
                ],
                ['Results', 456, 170, 105, 20, '结果'],
                [
                    'The model predicts structures and interhelical angles. Formula: E = mc². The paragraphs preserve their hierarchy.',
                    456,
                    200,
                    385,
                    64,
                    '模型预测结构及螺旋间夹角。公式：E = mc²。译文保留原文的段落层级。',
                ],
            ];
            const emit = (event, payload) => {
                for (const item of listeners.values())
                    if (item.event === event) window[`_${item.handler}`]?.({ event, payload });
            };
            window.__TAURI_IPC__ = async (request) => {
                try {
                    let result = null;
                    const { cmd, message = {} } = request;
                    window.__fixture.calls.push(request);
                    if (cmd === 'plugin:store|get') result = settings[request.key] ?? null;
                    else if (cmd === 'plugin:store|set') settings[request.key] = request.value;
                    else if (cmd === 'screenshot_translate_mode') result = window.__fixture.mode;
                    else if (cmd === 'get_base64') result = cropped;
                    else if (cmd === 'lang_detect') result = 'en';
                    else if (cmd === 'cut_image') {
                        cropWidth = request.width;
                        cropHeight = request.height;
                        const cut = document.createElement('canvas');
                        cut.width = request.width;
                        cut.height = request.height;
                        cut.getContext('2d').drawImage(
                            canvas,
                            request.left,
                            request.top,
                            request.width,
                            request.height,
                            0,
                            0,
                            request.width,
                            request.height
                        );
                        cropped = cut.toDataURL('image/png').split(',')[1];
                    } else if (cmd === 'system_ocr_layout') {
                        if (options.noText) result = { text: '', lines: [] };
                        else if (options.textOnly)
                            result = { text: 'Abstract\n\nRNA structure prediction.\n\nMethods' };
                        else
                            result = {
                                lines: paragraphs.map(([text, x, y, width, height], paragraph) => ({
                                    text,
                                    paragraph,
                                    words: [
                                        {
                                            text,
                                            box: {
                                                x: (x * cropWidth) / 870,
                                                y: (y * cropHeight) / 300,
                                                width: (width * cropWidth) / 870,
                                                height: (height * cropHeight) / 300,
                                            },
                                        },
                                    ],
                                })),
                            };
                    } else if (cmd === 'tauri') {
                        const module = request.__tauriModule;
                        if (module === 'Path') result = message.paths?.join('/') || message.path || 'C:/mock';
                        else if (module === 'Os')
                            result = { osType: 'Windows_NT', arch: 'x86_64', version: '11' }[message.cmd];
                        else if (module === 'App') result = '3.1.0';
                        else if (module === 'Event') {
                            if (message.cmd === 'listen') {
                                result = ++listenerId;
                                listeners.set(result, message);
                            } else if (message.cmd === 'unlisten') listeners.delete(message.eventId);
                            else if (message.cmd === 'emit') emit(message.event, message.payload);
                        } else if (module === 'Window') {
                            const action = message.data?.cmd?.type;
                            if (action === 'currentMonitor')
                                result = {
                                    name: 'test',
                                    position: { x: -1280, y: 0 },
                                    size: { width: 1280, height: 720 },
                                    scaleFactor: 1,
                                };
                            if (action === 'close') window.__fixture.closed = true;
                        } else if (module === 'Clipboard' && message.cmd === 'writeText')
                            window.__fixture.clipboard = message.data;
                        else if (module === 'Fs' && message.cmd === 'exists') result = false;
                        else if (module === 'Http') {
                            if (message.cmd === 'createClient') result = 1;
                            else if (message.cmd === 'httpRequest') {
                                const text = message.options.body.payload.messages.at(-1).content;
                                const delay = window.__fixture.delay;
                                if (delay) await new Promise((r) => setTimeout(r, delay));
                                if (window.__fixture.fail) throw new Error('fixture network error');
                                const match = paragraphs.find(([source]) =>
                                    text.includes(source.replace(/geome-\ntrical/, 'geometrical'))
                                );
                                const content = match?.[5] || 'RNA结构预测。';
                                result = {
                                    url: message.options.url,
                                    status: 200,
                                    headers: {},
                                    data: JSON.stringify({ choices: [{ message: { content } }] }),
                                };
                            }
                        }
                    }
                    window[`_${request.callback}`]?.(result);
                } catch (error) {
                    window[`_${request.error}`]?.(String(error));
                }
            };
        },
        { options }
    );
}

module.exports = { installMock };
if (require.main === module)
    (async () => {
        const browser = await chromium.launch({
            headless: true,
            executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        });
        const errors = [];
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        debugPage = page;
        page.on('pageerror', (e) => errors.push(e.message));
        await installMock(page);
        await page.goto(process.env.UI_URL || 'http://127.0.0.1:5173');
        await page.getByText('拖动框选翻译区域', { exact: false }).waitFor();
        await page.waitForFunction(() => document.querySelector('img.fixed')?.naturalWidth > 0);
        await page.mouse.move(194, 160);
        await page.mouse.down();
        await page.mouse.move(1064, 460);
        await page.mouse.up();
        await page.getByText('翻译完成', { exact: false }).waitFor();
        assert.match(await page.locator('.screenshot-paper').innerText(), /从头RNA结构预测/);
        assert.equal(await page.locator('.screenshot-block').count(), 7);
        const requests = await page.evaluate(() =>
            window.__fixture.calls.filter((c) => c.message?.cmd === 'httpRequest')
        );
        assert.ok(
            requests.every((r) => r.message.options.body.payload.messages[0].content.includes('从头RNA结构预测'))
        );
        assert.ok(requests.some((r) => r.message.options.body.payload.messages.at(-1).content.includes('geometrical')));
        await page.getByRole('button', { name: '查看原图', exact: true }).click();
        assert.equal(await page.locator('.screenshot-paper').count(), 0);
        await page.getByRole('button', { name: '查看译文', exact: true }).click();
        await page.getByRole('button', { name: '复制译文', exact: true }).click();
        assert.match(await page.evaluate(() => window.__fixture.clipboard), /从头RNA/);
        await page.screenshot({ path: path.resolve('asset/screenshot-translation-preview.png') });
        await page.getByLabel('翻译服务', { exact: true }).selectOption('openai@second');
        await page.getByText('翻译完成', { exact: false }).waitFor();
        await page.evaluate(() => {
            window.__fixture.fail = true;
        });
        await page.getByRole('button', { name: '重试', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'fixture network error' }).waitFor();
        await page.evaluate(() => {
            window.__fixture.fail = false;
        });
        await page.getByRole('button', { name: '重试', exact: true }).click();
        await page.getByText('翻译完成', { exact: false }).waitFor();
        await page.getByRole('button', { name: '重新截图', exact: true }).click();
        await page.getByText('拖动框选翻译区域', { exact: false }).waitFor();
        await page.waitForFunction(
            () =>
                window.__fixture.calls.filter((c) => c.cmd === 'screenshot').length >= 2 &&
                document.querySelector('img.fixed')?.complete
        );
        await page.waitForTimeout(100);
        // Small region at the lower-right corner: every control remains inside the viewport.
        await page.mouse.move(1260, 695);
        await page.mouse.down();
        await page.mouse.move(1090, 610);
        await page.mouse.up();
        await page.getByText('翻译完成', { exact: false }).waitFor();
        const controls = await page.locator('.screenshot-controls').boundingBox();
        assert.ok(
            controls.x >= 0 &&
                controls.y >= 0 &&
                controls.x + controls.width <= 1280 &&
                controls.y + controls.height <= 720
        );
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => window.__fixture.closed), true);
        assert.deepEqual(errors, []);
        for (const options of [{ noService: true }, { noText: true }, { textOnly: true }, { recognize: true }]) {
            const testPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
            testPage.on('pageerror', (e) => errors.push(e.message));
            await installMock(testPage, options);
            await testPage.goto(process.env.UI_URL || 'http://127.0.0.1:5173');
            await testPage.getByText('拖动框选翻译区域', { exact: false }).waitFor();
            await testPage.waitForFunction(() => document.querySelector('img.fixed')?.naturalWidth > 0);
            await testPage.mouse.move(194, 160);
            await testPage.mouse.down();
            await testPage.mouse.move(1064, 460);
            await testPage.mouse.up();
            if (options.noService) await testPage.getByText('请先在主窗口', { exact: false }).waitFor();
            else if (options.noText)
                await testPage.getByRole('alert').filter({ hasText: '未识别到完整文字' }).waitFor();
            else if (options.textOnly) {
                await testPage.getByText('翻译完成', { exact: false }).waitFor();
                assert.equal(await testPage.locator('.text-only').count(), 1);
            } else {
                await testPage.waitForFunction(() => window.__fixture.closed);
                assert.ok(
                    await testPage.evaluate(() =>
                        window.__fixture.calls.some(
                            (c) => c.message?.event === 'success' && c.message?.windowLabel === 'screenshot'
                        )
                    )
                );
            }
            await testPage.close();
        }
        assert.deepEqual(errors, []);
        console.log(
            'Screenshot UI passed: overlay, domain prompt, correction, comparison, clipboard, service switching, retry, recapture, small regions, Escape, no service/text, text-only OCR and recognition regression.'
        );
        await browser.close();
    })().catch(async (error) => {
        console.error(error);
        if (debugPage)
            console.error(
                await debugPage.evaluate(() => ({
                    body: document.body.innerText,
                    calls: window.__fixture?.calls.slice(-10),
                }))
            );
        process.exit(1);
    });
