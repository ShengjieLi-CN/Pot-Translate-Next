import test from 'node:test';
import assert from 'node:assert/strict';
import { createOcrRouter, formatRecognizedText } from '../src/utils/ocr_provider.mjs';
import { createOcrRecognizer } from '../src/utils/ocr_cache.mjs';

function fixture(settings = {}) {
    const calls = [];
    const providers = {
        rapidocr: async (...args) => {
            calls.push({ name: 'rapidocr', args });
            return { text: 'rapidocr', lines: [] };
        },
    };
    return {
        calls,
        providers,
        recognize: createOcrRouter({ providers, readConfig: async (key) => settings[key] ?? null }),
    };
}

test('always routes to local RapidOCR even with legacy paddle configuration', async () => {
    const { calls, recognize } = fixture({
        ocr_provider: 'paddle',
        paddle_ocr: { apiKey: 'saved' },
        rapid_ocr: { threads: 4 },
    });
    assert.equal((await recognize('image', 'auto')).text, 'rapidocr');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args[2].config, { threads: 4 });
});

test('live selection config overrides persisted RapidOCR settings', async () => {
    const { calls, recognize } = fixture({ rapid_ocr: { threads: 2 } });
    await recognize('image', 'auto', { selection: { provider: 'rapidocr', config: { threads: 8 } } });
    assert.equal(calls[0].name, 'rapidocr');
    assert.deepEqual(calls[0].args[2].config, { threads: 8 });
});

test('local failure is surfaced directly', async () => {
    const f = fixture();
    f.providers.rapidocr = async () => {
        throw new Error('not installed');
    };
    await assert.rejects(f.recognize('image', 'auto'), /not installed/);
    assert.equal(f.calls.length, 0);
});

test('cancelled jobs never start recognition', async () => {
    const f = fixture();
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

test('formatRecognizedText normalizes hyphenated line breaks when joinLines is enabled', () => {
    const text = '  A geome-\ntrical method.\n\nNext paragraph.  ';
    assert.equal(formatRecognizedText(text), 'A geome-\ntrical method.\n\nNext paragraph.');
    assert.equal(formatRecognizedText(text, true), 'A geometrical method. Next paragraph.');
    assert.equal(formatRecognizedText('  end-to-end\nmethod ', true), 'end-to-end method');
});
