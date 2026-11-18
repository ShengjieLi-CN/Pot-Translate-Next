import test from 'node:test';
import assert from 'node:assert/strict';
import {
    splitSpeechText,
    synthesizeSpeechChunks,
    speechErrorMessage,
    createSpeechPlayer,
} from '../src/utils/speech.mjs';
const collect = async (source) => {
    const out = [];
    for await (const part of source) out.push(part);
    return out;
};
const failure = `Http Request Error\nHttp Status: 500\n${JSON.stringify(Array.from(new TextEncoder().encode(JSON.stringify({ status: 500, msg: 'returned null audio', path: '/dictvoice' }))))}`;
const provider = (title, synthesize) => ({ title, load: async () => ({ title, synthesize }) });
test('the captured Youdao 500 falls through to enabled backup and does not recur for every chunk', async () => {
    let failed = 0;
    const received = [],
        switched = [];
    const text = 'The same subjects are measured multiple times. '.repeat(60);
    const chunks = await collect(
        synthesizeSpeechChunks(
            text,
            [
                provider('有道', async () => {
                    failed++;
                    throw failure;
                }),
                provider('火山', async (part) => {
                    received.push(part);
                    assert.ok(new TextEncoder().encode(part).length <= 480);
                    return [1, 2, 3];
                }),
            ],
            { onService: (title) => switched.push(title) }
        )
    );
    assert.equal(failed, 1);
    assert.ok(chunks.length > 1);
    assert.equal(received.join(''), text.trim());
    assert.ok(switched.every((x) => x === '火山'));
});
test('long multilingual text is neither truncated nor split inside unicode code points', () => {
    for (const text of [
        '中文😀测试。'.repeat(200),
        'word '.repeat(800),
        'x'.repeat(1500),
        '第一段。\n\nSecond paragraph. '.repeat(30),
    ]) {
        const parts = splitSpeechText(text);
        assert.equal(parts.join(''), text.trim());
        assert.ok(parts.every((p) => new TextEncoder().encode(p).length <= 480));
        assert.ok(parts.every((p) => !/[\ud800-\udfff]/u.test(p.replaceAll('😀', ''))));
    }
});
test('all failed providers report decoded readable errors without byte arrays', async () => {
    await assert.rejects(
        collect(
            synthesizeSpeechChunks('Example', [
                provider('有道', async () => {
                    throw failure;
                }),
            ])
        ),
        (e) => /有道/.test(e.message) && /返回空音频/.test(e.message) && !e.message.includes('[123,')
    );
    assert.match(
        speechErrorMessage('{"audio":null,"base_resp":{"status_code":400,"status_message":""}}'),
        /未返回音频/
    );
});
test('cancellation prevents fallback, subsequent synthesis and publication of a late response', async () => {
    let current = true,
        release,
        other = 0;
    const pending = collect(
        synthesizeSpeechChunks(
            'Long text '.repeat(100),
            [
                provider('first', () => new Promise((resolve) => (release = resolve))),
                provider('other', async () => {
                    other++;
                    return [2];
                }),
            ],
            { isCurrent: () => current }
        )
    );
    await new Promise((resolve) => setImmediate(resolve));
    current = false;
    release([1]);
    assert.deepEqual(await pending, []);
    assert.equal(other, 0);
});
test('empty audio falls through and no providers gives an actionable message', async () => {
    assert.deepEqual(
        await collect(
            synthesizeSpeechChunks('Hi', [
                provider('empty', async () => []),
                provider('ok', async () => new Uint8Array([4])),
            ])
        ),
        [new Uint8Array([4])]
    );
    await assert.rejects(collect(synthesizeSpeechChunks('Hi', [])), /启用语音合成服务/);
});
function audioFixture() {
    const sources = [];
    let closed = 0;
    return {
        sources,
        get closed() {
            return closed;
        },
        createContext: () => ({
            destination: {},
            resume: async () => {},
            close: async () => {
                closed++;
            },
            decodeAudioData: async (data) => ({ length: data.byteLength }),
            createBufferSource: () => {
                const s = {
                    connect() {},
                    disconnect() {},
                    start() {
                        s.started = true;
                    },
                    stop() {
                        s.stopped = true;
                    },
                };
                sources.push(s);
                return s;
            },
        }),
    };
}
test('player decodes and plays each audio independently in order, never concatenating compressed bytes', async () => {
    const f = audioFixture(),
        p = createSpeechPlayer(f.createContext);
    let requests = 0;
    const done = p.play(async function* () {
        requests++;
        yield [1];
        requests++;
        yield [2, 3];
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(requests, 1);
    assert.equal(f.sources[0].buffer.length, 1);
    f.sources[0].onended();
    await new Promise((r) => setImmediate(r));
    assert.equal(requests, 2);
    assert.equal(f.sources[1].buffer.length, 2);
    f.sources[1].onended();
    await done;
    assert.equal(p.active, false);
    assert.equal(f.closed, 1);
});
test('stopping playback and pending synthesis does not start later segments', async () => {
    const f = audioFixture(),
        p = createSpeechPlayer(f.createContext);
    let requests = 0;
    const done = p.play(async function* () {
        requests++;
        yield [1];
        requests++;
        yield [2];
    });
    await new Promise((r) => setImmediate(r));
    p.stop();
    await done;
    assert.equal(requests, 1);
    assert.equal(f.sources[0].stopped, true);
    let release;
    const pending = p.play(async function* () {
        yield await new Promise((r) => (release = r));
    });
    await new Promise((r) => setImmediate(r));
    p.stop();
    release([9]);
    await pending;
    assert.equal(f.sources.length, 1);
});

test('a later failure retries only the unplayed segment and announces fallback once', async () => {
    const text = 'A sentence to read. '.repeat(80);
    const parts = splitSpeechText(text),
        first = [],
        backup = [],
        notices = [];
    const output = await collect(
        synthesizeSpeechChunks(
            text,
            [
                provider('first', async (part) => {
                    first.push(part);
                    if (first.length === 2) throw failure;
                    return [1];
                }),
                provider('backup', async (part) => {
                    backup.push(part);
                    return [2];
                }),
            ],
            { onService: (title, fallback) => notices.push({ title, fallback }) }
        )
    );
    assert.deepEqual(first, parts.slice(0, 2));
    assert.deepEqual(backup, parts.slice(1));
    assert.equal(output.length, parts.length);
    assert.deepEqual(notices, [
        { title: 'first', fallback: false },
        { title: 'backup', fallback: true },
    ]);
});

test('audio start failure releases context, reports the error and allows a subsequent reading', async () => {
    const f = audioFixture();
    const p = createSpeechPlayer(() => {
        const context = f.createContext(),
            createSource = context.createBufferSource;
        context.createBufferSource = () => {
            const source = createSource();
            source.start = () => {
                throw new Error('Audio output unavailable');
            };
            return source;
        };
        return context;
    });
    await assert.rejects(p.play([1]), /Audio output unavailable/);
    assert.equal(p.active, false);
    assert.equal(f.closed, 1);
    await assert.rejects(p.play([1]), /Audio output unavailable/);
    assert.equal(f.closed, 2);
});
