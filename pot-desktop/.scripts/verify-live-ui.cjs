const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { installMock } = require('./verify-screenshot-ui.cjs');

(async () => {
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await installMock(page, { label: 'config' });
    await page.addInitScript(() => {
        const base = window.__TAURI_IPC__;
        const live = (window.__liveFixture = {
            settings: null,
            starts: 0,
            stt: [],
            current: null,
            sequence: 0,
            responses: 0,
            fail: false,
            empty: false,
            hold: false,
            exports: [],
        });
        const emit = (event, payload) =>
            base({
                cmd: 'tauri',
                __tauriModule: 'Event',
                message: { cmd: 'emit', event, payload },
                callback: 0,
                error: 0,
            });
        window.__pushLiveAudio = async (seconds = 6) => {
            const samples = new Int16Array(Math.round(seconds * 16000));
            for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.1) * 5000;
            const bytes = new Uint8Array(samples.buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            await emit('live-audio-frame', {
                session: live.current,
                sampleRate: 16000,
                sequence: live.sequence++,
                peak: 0.35,
                pcm: btoa(binary),
            });
        };
        window.__TAURI_IPC__ = async (request) => {
            const done = (value) => window[`_${request.callback}`]?.(value);
            const fail = (value) => window[`_${request.error}`]?.(value);
            if (request.cmd === 'plugin:store|get' && request.key === 'live_stt') return done(live.settings);
            if (request.cmd === 'plugin:store|set' && request.key === 'live_stt') {
                live.settings = request.value;
                return done(null);
            }
            if (request.cmd === 'live_audio_start') {
                live.current = request.session;
                live.starts++;
                live.sequence = 0;
                return done(null);
            }
            if (request.cmd === 'live_audio_stop') {
                done(null);
                await emit('live-audio-stopped', { session: request.session });
                live.current = null;
                return;
            }
            if (request.cmd === 'live_transcribe') {
                live.stt.push({ ...request, audio: '[not logged]' });
                if (live.hold)
                    await new Promise((resolve) => {
                        live.release = resolve;
                    });
                if (live.fail) return fail('STT fixture unavailable');
                if (live.empty) return done({ text: '' });
                const number = live.responses++;
                return done({
                    language: 'en',
                    segments: [
                        {
                            start: 0,
                            end: 2.7,
                            text: number ? 'Thank you for the question.' : 'Welcome to our RNA structure seminar.',
                            speaker: number ? 'X' : 'A',
                            speaker_embedding: [1, 0, 0],
                        },
                        {
                            start: 2.8,
                            end: 5.8,
                            text: number
                                ? 'The model preserves molecular geometry.'
                                : 'Can you explain the prediction method?',
                            speaker: number ? 'Y' : 'B',
                            speaker_embedding: [0, 1, 0],
                        },
                    ],
                });
            }
            if (request.cmd === 'tauri' && request.__tauriModule === 'Dialog' && request.message.cmd === 'saveDialog')
                return done('C:/mock/export.srt');
            if (
                request.cmd === 'tauri' &&
                request.__tauriModule === 'Fs' &&
                ['writeFile', 'writeTextFile'].includes(request.message.cmd)
            ) {
                live.exports.push(request.message);
                return done(null);
            }
            return base(request);
        };
    });
    try {
        await page.goto(`${process.env.UI_URL || 'http://127.0.0.1:5174'}/live`);
        await page.locator('.live-page').getByRole('heading', { name: '同声传译', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.__liveFixture.starts), 0);
        await page.getByRole('button', { name: '开始同传', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'STT 模型名称' }).waitFor();
        assert.equal(await page.evaluate(() => window.__liveFixture.starts), 0);
        await page.getByRole('button', { name: 'STT 模型设置' }).click();
        await page.getByLabel('STT 模型名称', { exact: true }).fill('custom-voice-stt');
        await page.getByLabel('分段长度（秒）', { exact: true }).fill('6');
        await page.getByLabel('发送说话人参考音频（接口需支持）', { exact: true }).check();
        await page.getByRole('button', { name: '保存 STT 配置', exact: true }).click();
        await page.getByText('STT 配置已保存。', { exact: true }).waitFor();
        await page.getByLabel('STT 模型名称', { exact: true }).fill('unsaved-test-model');
        await page.evaluate(() => {
            window.__liveFixture.hold = true;
        });
        await page.getByRole('button', { name: '测试模型', exact: true }).click();
        await page.waitForFunction(() => typeof window.__liveFixture.release === 'function');
        assert.equal(await page.getByRole('button', { name: /测试中/ }).isDisabled(), true);
        assert.equal(await page.getByRole('button', { name: '开始同传', exact: true }).isDisabled(), true);
        await page.evaluate(() => {
            window.__liveFixture.hold = false;
            window.__liveFixture.release();
        });
        await page.getByLabel('STT 模型测试结果', { exact: true }).filter({ hasText: '接口测试成功' }).waitFor();
        assert.equal(await page.evaluate(() => window.__liveFixture.stt.at(-1).config.model), 'unsaved-test-model');
        assert.equal(await page.evaluate(() => window.__liveFixture.settings.model), 'custom-voice-stt');
        assert.equal(await page.evaluate(() => window.__liveFixture.starts), 0);
        assert.equal(await page.locator('.live-utterance').count(), 0);
        assert.equal(
            await page.evaluate(() => window.__fixture.calls.filter((c) => c.message?.cmd === 'httpRequest').length),
            0
        );
        await page.evaluate(() => {
            window.__liveFixture.empty = true;
        });
        await page.getByRole('button', { name: '测试模型', exact: true }).click();
        await page.getByLabel('STT 模型测试结果', { exact: true }).filter({ hasText: '未识别出测试语音' }).waitFor();
        await page.evaluate(() => {
            window.__liveFixture.empty = false;
            window.__liveFixture.fail = true;
        });
        await page.getByRole('button', { name: '测试模型', exact: true }).click();
        await page.getByLabel('STT 模型测试结果', { exact: true }).filter({ hasText: '测试失败' }).waitFor();
        await page.getByLabel('STT 模型名称', { exact: true }).fill('custom-voice-stt');
        assert.equal(await page.getByLabel('STT 模型测试结果', { exact: true }).count(), 0);
        await page.evaluate(() => {
            window.__liveFixture.fail = false;
            window.__liveFixture.stt = [];
            window.__liveFixture.responses = 0;
        });
        await page.getByRole('button', { name: 'STT 模型设置' }).click();
        await page.getByRole('button', { name: '开始同传', exact: true }).click();
        await page.getByText('正在聆听', { exact: true }).waitFor();
        await page.evaluate(() => window.__pushLiveAudio(6));
        await page.getByText('Welcome to our RNA structure seminar.', { exact: true }).waitFor();
        await page.waitForFunction(
            () =>
                document.querySelectorAll('.live-translation').length === 2 &&
                [...document.querySelectorAll('.live-translation')].every((e) => e.textContent !== '正在翻译…')
        );
        await page.evaluate(() => window.__pushLiveAudio(5.25));
        await page.getByText('The model preserves molecular geometry.', { exact: true }).waitFor();
        assert.equal(await page.locator('.live-speakers input').count(), 2);
        const stt = await page.evaluate(() => window.__liveFixture.stt);
        assert.equal(stt[0].config.model, 'custom-voice-stt');
        assert.equal(stt[1].references.length, 2);
        await page.getByRole('button', { name: '暂停', exact: true }).click();
        await page.getByText('已暂停', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('会话音频回放').count(), 1);
        await page.getByRole('button', { name: '继续', exact: true }).click();
        await page.getByText('正在聆听', { exact: true }).waitFor();
        await page.evaluate(() => window.__pushLiveAudio(1));
        await page.getByRole('button', { name: '结束', exact: true }).click();
        await page.getByText('已停止', { exact: true }).waitFor();
        await page.getByText('转写队列已完成', { exact: true }).waitFor();
        await page.getByLabel('重命名讲话人 1', { exact: true }).fill('主讲人');
        await page.getByRole('button', { name: '导出 SRT', exact: true }).click();
        assert.equal(await page.evaluate(() => window.__liveFixture.exports.length), 1);
        await page.locator('.live-page').evaluate((element) => {
            element.parentElement.scrollTop = 0;
        });
        await page.screenshot({ path: path.resolve('asset/live-interpretation-preview.png') });
        await page.getByRole('button', { name: '开始同传', exact: true }).click();
        await page.getByText('正在聆听', { exact: true }).waitFor();
        await page.evaluate(() => {
            window.__liveFixture.fail = true;
            return window.__pushLiveAudio(6);
        });
        await page.getByRole('alert').filter({ hasText: 'STT fixture unavailable' }).waitFor();
        await page.getByText('已暂停', { exact: true }).waitFor();
        await page.evaluate(() => {
            window.__liveFixture.fail = false;
        });
        await page.getByRole('button', { name: '重试失败片段', exact: true }).click();
        await page.getByText('转写队列已完成', { exact: true }).waitFor();
        await page.getByRole('button', { name: '结束', exact: true }).click();
        await page.getByText('已停止', { exact: true }).waitFor();
        const { encodeWav } = await import('../src/utils/live_interpretation.mjs');
        const synthetic = Float32Array.from({ length: 16000 * 6 }, (_, i) => 0.1 * Math.sin(i * 0.08));
        await page.getByLabel('选择音频文件', { exact: true }).setInputFiles({
            name: 'synthetic.wav',
            mimeType: 'audio/wav',
            buffer: Buffer.from(encodeWav(synthetic, 16000)),
        });
        await page.waitForFunction(() => document.querySelectorAll('.live-utterance').length >= 2);
        await page.getByText('转写队列已完成', { exact: true }).waitFor();
        await page.setViewportSize({ width: 800, height: 600 });
        assert.equal(
            await page.evaluate(
                () =>
                    document.querySelector('.live-page').scrollWidth <=
                    document.querySelector('.live-page').clientWidth + 1
            ),
            true
        );
        assert.deepEqual(errors, []);
        console.log(
            'Live UI passed: model test success/empty/failure, unsaved settings, no recording or translation during testing, validation before recording, custom model settings, audio frames, STT speaker references, two stable voices, translation, pause/resume, tail flush, playback, rename, export, audio import, error recovery, 800px layout.'
        );
    } catch (error) {
        console.error(await page.locator('body').innerText());
        throw error;
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
