import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcrRouter } from '../src/utils/ocr_provider.mjs';
import { createOcrRecognizer } from '../src/utils/ocr_cache.mjs';
function fixture(settings = {}) {
    const calls = [];
    const providers = Object.fromEntries(
        ['rapidocr', 'paddle'].map((name) => [
            name,
            async (...args) => {
                calls.push({ name, args });
                return { text: name, lines: [] };
            },
        ])
    );
    return {
        calls,
        providers,
        recognize: createOcrRouter({ providers, readConfig: async (key) => settings[key] ?? null }),
    };
}
test('a legacy configuration defaults to RapidOCR even with saved Paddle credentials', async () => {
    const { calls, recognize } = fixture({ paddle_ocr: { apiKey: 'saved' } });
    assert.equal((await recognize('image', 'auto')).text, 'rapidocr');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[2].config, null);
});
test('explicit Paddle selection uses its saved model and key', async () => {
    const config = { model: 'PP-OCRv5', apiKey: 'saved' };
    const { calls, recognize } = fixture({ ocr_provider: 'paddle', paddle_ocr: config });
    assert.equal((await recognize('image', 'auto')).text, 'paddle');
    assert.deepEqual(calls[0].args[2].config, config);
});
test('live selection overrides persisted provider without mixing provider settings', async () => {
    const { calls, recognize } = fixture({ ocr_provider: 'paddle', paddle_ocr: { apiKey: 'saved' } });
    await recognize('image', 'auto', { selection: { provider: 'rapidocr', config: { threads: 4 } } });
    assert.equal(calls[0].name, 'rapidocr');
    assert.deepEqual(calls[0].args[2].config, { threads: 4 });
});
test('local failure is surfaced without silently uploading to Paddle', async () => {
    const f = fixture();
    f.providers.rapidocr = async () => {
        throw new Error('not installed');
    };
    await assert.rejects(f.recognize('image', 'auto'), /not installed/);
    assert.equal(f.calls.length, 0);
});
test('unknown providers and cancelled jobs never start recognition', async () => {
    const f = fixture({ ocr_provider: '__proto__' });
    await assert.rejects(f.recognize('image', 'auto'), /有效/);
    await assert.rejects(f.recognize('image', 'auto', { isCurrent: () => false }), /取消/);
    assert.equal(f.calls.length, 0);
});
test('cancellation while reading settings prevents recognition and discards late results', async () => {
    let current = true,
        called = false;
    const router = createOcrRouter({
        readConfig: async () => {
            current = false;
            return null;
        },
        providers: {
            rapidocr: async () => {
                called = true;
            },
        },
    });
    await assert.rejects(router('image', 'auto', { isCurrent: () => current }), /取消/);
    assert.equal(called, false);
    current = true;
    const f = fixture();
    f.providers.rapidocr = async () => {
        current = false;
        return { text: 'late' };
    };
    await assert.rejects(f.recognize('image', 'auto', { isCurrent: () => current }), /取消/);
});
test('local OCR shares repeated images and invalidates when CPU settings change', async () => {
    let runs = 0;
    const recognize = createOcrRecognizer(async () => {
        runs++;
        return { text: 'recognized', lines: [] };
    });
    await Promise.all([recognize('image', { threads: 2 }), recognize('image', { threads: 2 })]);
    await recognize('image', { threads: 2 });
    assert.equal(runs, 1);
    await recognize('image', { threads: 4 });
    assert.equal(runs, 2);
});
