import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_STT,
    validateStt,
    encodeWav,
    bytesBase64,
    pcmFromBase64,
    PcmChunker,
    normalizeTranscript,
    cosineSimilarity,
    SpeakerRegistry,
    trimTranscriptOverlap,
    exportTranscript,
    formatTime,
} from '../src/utils/live_interpretation.mjs';
import { LiveSession } from '../src/utils/live_session.mjs';

const config = { ...DEFAULT_STT, model: 'custom-diarize', speakerMode: 'global' };
const chunk = (offset = 0) => ({ pcm: new Float32Array(16000 * 3).fill(0.2), sampleRate: 16000, offset });
const untilIdle = async (session) => {
    for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 1));
        if (!session.processing && !session.translating) return;
    }
    throw new Error('Session did not finish');
};

test('STT configuration accepts custom local servers and rejects malformed or overriding fields', () => {
    assert.deepEqual(validateStt(config), {});
    assert.throws(() => validateStt({ ...config, model: '' }), /模型/);
    assert.throws(() => validateStt({ ...config, endpoint: 'file:///tmp/test' }), /HTTP/);
    assert.throws(() => validateStt({ ...config, endpoint: 'https://user:secret@example.com' }), /用户名/);
    for (const extra of ['[]', 'null', 'not-json', '{"file":"x"}', '{"model":"x"}', '{"stream":true}'])
        assert.throws(() => validateStt({ ...config, extra }));
    for (const seconds of [0, 2, 31, NaN]) assert.throws(() => validateStt({ ...config, chunkSeconds: seconds }));
    assert.throws(() => validateStt({ ...config, threshold: 1.5 }));
});

test('WAV encoder emits mono PCM16 with accurate headers and clipping', () => {
    const bytes = encodeWav(new Float32Array([-2, -1, 0, 1, 2]), 16000),
        view = new DataView(bytes.buffer);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
    assert.equal(view.getUint32(24, true), 16000);
    assert.equal(view.getUint32(40, true), 10);
    assert.equal(view.getInt16(44, true), -32768);
    assert.equal(view.getInt16(52, true), 32767);
    assert.deepEqual([...pcmFromBase64(bytesBase64(bytes.slice(44)))].slice(0, 3), [-1, -1, 0]);
    assert.throws(() => pcmFromBase64('AA=='), /PCM/);
});

test('PCM chunking preserves overlap, timeline and pause/resume without repeated tail', () => {
    const c = new PcmChunker(16000, 3, 0.75);
    assert.equal(c.push(new Float32Array(16000)).length, 0);
    const first = c.push(new Float32Array(32000));
    assert.equal(first[0].offset, 0);
    assert.equal(first[0].pcm.length, 48000);
    assert.equal(c.flush(), null);
    assert.equal(c.push(new Float32Array(8000)).length, 0);
    const tail = c.flush();
    assert.equal(tail.offset, 3);
    assert.equal(tail.pcm.length, 8000);
    assert.equal(c.flush(), null);
    const second = new PcmChunker(16000, 3, 0.75);
    const output = second.push(new Float32Array(84000));
    assert.deepEqual(
        output.map((c) => c.offset),
        [0, 2.25]
    );
});

test('STT normalization handles diarized and custom responses without inventing speakers', () => {
    const segments = normalizeTranscript(
        {
            text: 'Hello',
            segments: [
                { text: 'Hello', start: -1, end: 3, speaker: 'A', speaker_embedding: [1, 0] },
                { text: 'silence', start: 0, end: 2, no_speech_prob: 0.99 },
                { text: 'invalid', start: 'x', end: 4 },
            ],
        },
        2
    );
    assert.deepEqual(segments[0], { text: 'Hello', start: 0, end: 2, speaker: 'A', embedding: [1, 0], language: null });
    assert.equal(segments.length, 1);
    assert.equal(normalizeTranscript({ text: 'One speaker unknown' }, 3)[0].speaker, null);
    assert.equal(
        normalizeTranscript({ utterances: [{ transcript: 'Hi', start_time: 0, end_time: 1, speaker_id: 0 }] }, 3)[0]
            .speaker,
        '0'
    );
    assert.deepEqual(normalizeTranscript({ text: '' }, 3), []);
});

test('voice embeddings associate the same timbre across chunks and distinguish different voices', () => {
    const registry = new SpeakerRegistry();
    const first = registry.assign({ speaker: 'A', embedding: [1, 0, 0] }, new Map());
    const other = registry.assign({ speaker: 'A', embedding: [0, 1, 0] }, new Map());
    assert.notEqual(first, other);
    assert.equal(registry.assign({ speaker: 'Z', embedding: [0.99, 0.01, 0] }, new Map()), first);
    assert.equal(cosineSimilarity([1, 0], [2, 0]), 1);
    assert.equal(cosineSimilarity([0, 0], [1, 0]), -1);
    assert.equal(cosineSimilarity([NaN], [1]), -1);
});

test('chunk-local labels do not become false session identities; global IDs remain stable', () => {
    const registry = new SpeakerRegistry({ mode: 'local' });
    const first = registry.assign({ speaker: 'A', start: 0, end: 2 }, new Map());
    assert.notEqual(registry.assign({ speaker: 'A', start: 0, end: 2 }, new Map()), first);
    assert.equal(
        registry.assign({ speaker: 'C', start: 0, end: 2 }, new Map(), [{ speaker: first, start: 5, end: 7 }], 5),
        first
    );
    const global = new SpeakerRegistry({ mode: 'global' });
    assert.equal(global.assign({ speaker: 'doctor' }, new Map()), global.assign({ speaker: 'doctor' }, new Map()));
    assert.equal(global.assign({ speaker: null }), null);
});

test('speaker references retain 2–8 seconds and recognize server-returned reference names', () => {
    const r = new SpeakerRegistry({ mode: 'local' });
    const id = r.create();
    r.learnReference(id, { start: 0, end: 1 }, chunk().pcm, 16000);
    assert.equal(r.references().length, 0);
    r.learnReference(id, { start: 0, end: 3 }, chunk().pcm, 16000);
    assert.match(r.references()[0].audio, /^data:audio\/wav;base64,/);
    assert.equal(r.assign({ speaker: id }, new Map()), id);
});

test('overlap restoration and subtitle export preserve multilingual text and speaker names', () => {
    assert.equal(trimTranscriptOverlap('Hello world', 'world again'), 'again');
    assert.equal(trimTranscriptOverlap('这是原文', '这是原文'), '');
    assert.equal(trimTranscriptOverlap('some words', 'wordsmith'), 'wordsmith');
    assert.equal(formatTime(3661.125, true), '01:01:01,125');
    const rows = [{ text: 'RNA', translation: '核糖核酸', speaker: 'speaker_1', start: 1.25, end: 3 }];
    assert.match(
        exportTranscript(rows, 'srt', { speaker_1: 'Alice' }),
        /00:00:01,250 --> 00:00:03,000\n\[Alice\] RNA\n核糖核酸/
    );
    assert.equal(JSON.parse(exportTranscript(rows, 'json')).segments.length, 1);
});

test('live pipeline transcribes and translates in independent ordered queues', async () => {
    const calls = [];
    let release;
    const session = new LiveSession({
        config,
        transcribe: async (c) => {
            calls.push(c.offset);
            return { segments: [{ text: `Phrase ${c.offset}`, start: 0, end: 2, speaker: 'A' }] };
        },
        translate: async (text, _, update) => {
            if (!release)
                await new Promise((r) => {
                    release = r;
                });
            update('partial');
            return `译 ${text}`;
        },
    });
    session.enqueue(chunk(0));
    session.enqueue(chunk(3));
    await new Promise((r) => setTimeout(r, 5));
    assert.deepEqual(calls, [0, 3]);
    assert.equal(session.rows.length, 2);
    release();
    await untilIdle(session);
    assert.ok(session.rows.every((r) => r.status === 'done'));
    assert.equal(session.rows[0].speaker, session.rows[1].speaker);
});

test('adjacent repeated utterances are retained while overlapping duplicates are removed', async () => {
    const s = new LiveSession({
        config,
        transcribe: async () => ({ segments: [{ text: 'Yes', start: 0, end: 2, speaker: 'A' }] }),
        translate: async (t) => t,
    });
    s.enqueue(chunk(0));
    await untilIdle(s);
    s.enqueue(chunk(2));
    await untilIdle(s);
    assert.equal(s.rows.length, 2);
    s.enqueue(chunk(2));
    await untilIdle(s);
    assert.equal(s.rows.length, 2);
});

test('STT failure preserves audio, pauses the request train and retries only on request', async () => {
    let calls = 0,
        paused = 0,
        fail = true;
    const s = new LiveSession({
        config,
        onBackpressure: () => paused++,
        transcribe: async () => {
            calls++;
            if (fail) throw new Error('bad endpoint');
            return { text: 'Recovered' };
        },
        translate: async (t) => t,
    });
    s.enqueue(chunk());
    s.enqueue(chunk(3));
    await untilIdle(s);
    s.enqueue(chunk(6));
    await untilIdle(s);
    assert.equal(calls, 1);
    assert.equal(s.failed.length, 3);
    assert.ok(paused > 0);
    fail = false;
    s.retry();
    await untilIdle(s);
    assert.equal(calls, 4);
    assert.equal(s.failed.length, 0);
    assert.equal(s.rows.length, 3);
});

test('translation failure can retry while cancellation suppresses late audio and text', async () => {
    let fail = true,
        calls = 0;
    const s = new LiveSession({
        config,
        transcribe: async () => ({ text: 'hello' }),
        translate: async () => {
            calls++;
            if (fail) throw new Error('translation');
            return '你好';
        },
    });
    s.enqueue(chunk());
    await untilIdle(s);
    assert.equal(s.rows[0].status, 'error');
    fail = false;
    s.retry();
    await untilIdle(s);
    assert.equal(s.rows[0].translation, '你好');
    assert.equal(calls, 2);
    let release,
        updates = 0;
    const cancelled = new LiveSession({
        config,
        transcribe: async () => {
            await new Promise((r) => {
                release = r;
            });
            return { text: 'late' };
        },
        translate: async () => 'late',
        onRows: () => updates++,
    });
    cancelled.enqueue(chunk());
    cancelled.cancel();
    release();
    await untilIdle(cancelled);
    assert.equal(updates, 0);
    assert.equal(cancelled.rows.length, 0);
});
