import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPaddleOcr, parsePaddleResult, PADDLE_MODELS, PADDLE_JOBS_URL } from '../src/utils/paddle_ocr.mjs';
import { screenshotBlocks } from '../src/utils/screenshot_translation.mjs';
const config = { model: 'PP-OCRv6', apiKey: 'test-token' };
const result = (prunedResult) => JSON.stringify({ result: { ocrResults: [{ prunedResult }] } });
const fixture = result({
    rec_texts: ['Hello Paddle', '你好世界'],
    rec_polys: [
        [
            [20, 30],
            [180, 30],
            [180, 50],
            [20, 50],
        ],
        [
            [20, 80],
            [180, 80],
            [180, 100],
            [20, 100],
        ],
    ],
});
function transport(responses) {
    const calls = [];
    let time = 0;
    return {
        calls,
        formBody: (value) => value,
        now: () => time,
        sleep: async (ms) => {
            time += ms;
        },
        request: async (url, options) => {
            calls.push({ url, ...options });
            const response = responses.shift();
            assert.ok(response, 'unexpected network request');
            return { ok: true, status: 200, ...response };
        },
    };
}
const job = { data: { data: { jobId: 'test/job' } } };
const done = { data: { data: { state: 'done', resultUrl: { jsonUrl: 'https://results.example.test/file.jsonl' } } } };

test('cloud OCR sends selected model and image, polls jobs and downloads JSONL without leaking credentials', async () => {
    for (const model of PADDLE_MODELS) {
        const io = transport([job, { data: { data: { state: 'pending' } } }, done, { data: fixture }]);
        const output = await requestPaddleOcr('aW1hZ2U=', { ...config, model }, io);
        assert.equal(output.text, 'Hello Paddle\n你好世界');
        assert.equal(io.calls[0].url, PADDLE_JOBS_URL);
        assert.equal(io.calls[0].headers.Authorization, 'Bearer test-token');
        assert.equal(io.calls[0].headers['Content-Type'], 'multipart/form-data');
        assert.equal(io.calls[0].body.model, model);
        assert.deepEqual(io.calls[0].body.file.file, [105, 109, 97, 103, 101]);
        assert.equal(JSON.parse(io.calls[0].body.optionalPayload).useDocUnwarping, false);
        assert.equal(io.calls[1].url, `${PADDLE_JOBS_URL}/test%2Fjob`);
        assert.deepEqual(io.calls[3].headers, {});
        assert.equal(io.calls[3].responseType, 2);
    }
});

test('Paddle polygon and rectangular bounds preserve in-place translation coordinates', () => {
    const parsed = parsePaddleResult(fixture);
    assert.deepEqual(parsed.lines[0].box, { x: 20, y: 30, width: 160, height: 20 });
    const blocks = screenshotBlocks(parsed, 300, 200);
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[0].box, parsed.lines[0].box);
    const rect = parsePaddleResult(result({ rec_texts: ['Text'], rec_boxes: [[12, 13, 80, 33]] }));
    assert.deepEqual(rect.lines[0].box, { x: 12, y: 13, width: 68, height: 20 });
});

test('empty images remain empty and incomplete coordinates retain every recognized line', () => {
    assert.deepEqual(parsePaddleResult(result({ rec_texts: [] })), { text: '', lines: [] });
    assert.deepEqual(parsePaddleResult(result({ rec_texts: ['one', 'two'], rec_boxes: [[1, 2, 10, 20]] })), {
        text: 'one\ntwo',
        lines: [],
    });
    for (const invalid of ['', 'not-json', '{}', result({}), result({ rec_texts: [12] })]) {
        assert.throws(() => parsePaddleResult(invalid), /Paddle OCR/);
    }
});

test('missing credentials, invalid models and bad image data fail before network access', async () => {
    for (const [image, settings, message] of [
        ['aQ==', {}, /API Key/],
        ['aQ==', { ...config, model: 'system' }, /模型/],
        ['', config, /图片/],
        ['%%%', config, /图片/],
    ]) {
        const io = transport([]);
        await assert.rejects(requestPaddleOcr(image, settings, io), message);
        assert.equal(io.calls.length, 0);
    }
});

test('authentication, quota and server failures give useful errors without raw credentials', async () => {
    for (const [status, message] of [
        [401, /API Key/],
        [403, /权限/],
        [429, /额度/],
        [503, /HTTP 503/],
    ]) {
        const io = transport([{ ok: false, status, data: 'test-token' }]);
        await assert.rejects(
            requestPaddleOcr('aQ==', config, io),
            (error) => message.test(error.message) && !error.message.includes('test-token')
        );
    }
    await assert.rejects(
        requestPaddleOcr('aQ==', config, transport([{ data: { code: 100, msg: 'test-token' } }])),
        /服务返回错误/
    );
    await assert.rejects(
        requestPaddleOcr(
            'aQ==',
            config,
            transport([job, { data: { data: { state: 'failed', errorMsg: 'test-token' } } }])
        ),
        /任务失败/
    );
});

test('polling times out, cancellation stops requests and malformed responses fail explicitly', async () => {
    const io = transport([job, { data: { data: { state: 'running' } } }]);
    await assert.rejects(requestPaddleOcr('aQ==', config, { ...io, timeoutMs: 100 }), /超时/);
    await assert.rejects(requestPaddleOcr('aQ==', config, { ...transport([]), isCurrent: () => false }), /取消/);
    for (const responses of [
        [{ data: { data: {} } }],
        [job, { data: { data: { state: 'other' } } }],
        [job, { data: { data: { state: 'done', resultUrl: { jsonUrl: 'http://localhost/private' } } } }],
    ])
        await assert.rejects(requestPaddleOcr('aQ==', config, transport(responses)), /Paddle OCR/);
});

test('wide screenshots use explicit detection resolution and skip unnecessary orientation passes', async () => {
    const io = transport([job, done, { data: fixture }]);
    await requestPaddleOcr('data:image/jpeg;base64,aW1hZ2U=', config, io);
    const body = io.calls[0].body;
    assert.equal(body.file.mime, 'image/jpeg');
    assert.equal(body.file.fileName, 'screenshot.jpg');
    assert.equal(JSON.parse(body.optionalPayload).textDetLimitSideLen, 1536);
    assert.equal(JSON.parse(body.optionalPayload).useTextlineOrientation, false);
});

test('successful but empty detections retry once with detail, and propagate image dimensions', async () => {
    const detailed = JSON.stringify({
        result: {
            dataInfo: { width: 1000, height: 500 },
            ocrResults: [{ prunedResult: { rec_texts: ['Recovered'], rec_boxes: [[10, 20, 200, 40]] } }],
        },
    });
    const io = transport([job, done, { data: result({ rec_texts: [] }) }, job, done, { data: detailed }]);
    const output = await requestPaddleOcr('aQ==', config, io);
    assert.equal(io.calls.filter((c) => c.method === 'POST').length, 2);
    assert.equal(JSON.parse(io.calls[3].body.optionalPayload).textDetLimitSideLen, 2560);
    assert.equal(output.text, 'Recovered');
    assert.equal(output.width, 1000);
    assert.equal(screenshotBlocks(output, 2000, 1000)[0].box.width, 380);
    const empty = transport([
        job,
        done,
        { data: result({ rec_texts: [] }) },
        job,
        done,
        { data: result({ rec_texts: [] }) },
    ]);
    assert.equal((await requestPaddleOcr('aQ==', config, empty)).text, '');
    assert.equal(empty.calls.length, 6);
});

test('Paddle per-image errors are not treated as blank successful recognition', () => {
    assert.throws(() => parsePaddleResult(JSON.stringify({ errorCode: 500, result: { ocrResults: [] } })), /处理失败/);
});

test('in-flight OCR is shared; completed images are reused, and model/key/expiry invalidate the cache', async () => {
    const { createPaddleRecognizer } = await import('../src/utils/paddle_ocr.mjs');
    let calls = 0,
        time = 0,
        finish;
    const recognize = createPaddleRecognizer(
        async () => {
            calls++;
            await new Promise((resolve) => (finish = resolve));
            return { text: 'found', lines: [] };
        },
        { now: () => time, ttlMs: 100 }
    );
    const first = recognize('image', config),
        second = recognize('image', config);
    await Promise.resolve();
    assert.equal(calls, 1);
    finish();
    await Promise.all([first, second]);
    await recognize('image', config);
    assert.equal(calls, 1);
    for (const settings of [{ ...config, model: 'PP-OCRv5' }, { ...config, apiKey: 'changed' }, config]) {
        const next = recognize('image', settings);
        await Promise.resolve();
        finish();
        await next;
    }
    assert.equal(calls, 4);
    time = 101;
    const expired = recognize('image', config);
    await Promise.resolve();
    finish();
    await expired;
    assert.equal(calls, 5);
});

test('one OCR subscriber can cancel without losing the other, and empty/error responses are not cached', async () => {
    const { createPaddleRecognizer } = await import('../src/utils/paddle_ocr.mjs');
    let active = true,
        finish;
    const recognize = createPaddleRecognizer(async (_image, _config, isCurrent) => {
        await new Promise((resolve) => (finish = resolve));
        assert.equal(isCurrent(), true);
        return { text: 'found' };
    });
    const first = recognize('image', config, () => active),
        second = recognize('image', config);
    const cancelled = assert.rejects(first, /取消/);
    await Promise.resolve();
    active = false;
    finish();
    await cancelled;
    assert.equal((await second).text, 'found');
    let count = 0;
    const noCache = createPaddleRecognizer(async () => {
        count++;
        if (count < 3) throw new Error('offline');
        return { text: '' };
    });
    await assert.rejects(noCache('image', config), /offline/);
    await assert.rejects(noCache('image', config), /offline/);
    await noCache('image', config);
    await noCache('image', config);
    assert.equal(count, 4);
});
