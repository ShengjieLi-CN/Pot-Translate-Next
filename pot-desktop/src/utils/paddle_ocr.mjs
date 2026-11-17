// Protocol: PaddlePaddle/PaddleOCR api_sdk/typescript/src/internal/http.ts.
export const PADDLE_MODELS = ['PP-OCRv5', 'PP-OCRv6', 'PP-OCRv5-latin'];
export const DEFAULT_PADDLE_CONFIG = { model: 'PP-OCRv5', apiKey: '' };
export const PADDLE_JOBS_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs';

function boxFrom(points) {
    if (!Array.isArray(points)) return null;
    if (points.length === 4 && points.every(Number.isFinite)) {
        const [x, y, right, bottom] = points;
        return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
    }
    if (points.length < 4 || !points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
        return null;
    const x = Math.min(...points.map((p) => p[0]));
    const y = Math.min(...points.map((p) => p[1]));
    const width = Math.max(...points.map((p) => p[0])) - x;
    const height = Math.max(...points.map((p) => p[1])) - y;
    return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function parsePaddleResult(jsonl) {
    let records;
    try {
        records = jsonl
            .trim()
            .split(/\r?\n/)
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line));
    } catch {
        throw new Error('Paddle OCR 返回的识别结果格式无效。');
    }
    if (!records.length) throw new Error('Paddle OCR 返回的结果文件为空。');
    const texts = [],
        lines = [];
    for (const record of records) {
        if (record.errorCode && record.errorCode !== 0) throw new Error('Paddle OCR 图片处理失败，请重新截图后重试。');
        const pages = record?.result?.ocrResults;
        if (!Array.isArray(pages)) throw new Error('Paddle OCR 返回的结果缺少 ocrResults。');
        for (const page of pages) {
            const result = page?.prunedResult;
            if (!Array.isArray(result?.rec_texts) || !result.rec_texts.every((text) => typeof text === 'string')) {
                throw new Error('Paddle OCR 返回的结果缺少文字数据。');
            }
            result.rec_texts.forEach((text, i) => {
                if (!text.trim()) return;
                texts.push(text);
                const box =
                    boxFrom(result.rec_polys?.[i]) || boxFrom(result.rec_boxes?.[i]) || boxFrom(result.dt_polys?.[i]);
                if (box) lines.push({ text, box, words: [{ text, box }] });
            });
        }
    }
    // If any geometry is missing, retain all text in the existing text-only view.
    const info = records[0]?.result?.dataInfo;
    const dimensions =
        Number.isFinite(info?.width) && Number.isFinite(info?.height) && info.width > 0 && info.height > 0
            ? { width: info.width, height: info.height }
            : {};
    return { text: texts.join('\n'), lines: lines.length === texts.length ? lines : [], ...dimensions };
}

export async function requestPaddleOcr(
    base64,
    config,
    {
        request,
        formBody,
        isCurrent = () => true,
        now = Date.now,
        sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        timeoutMs = 60000,
        retryEmpty = true,
    }
) {
    const apiKey = String(config?.apiKey || '').trim();
    const model = config?.model || DEFAULT_PADDLE_CONFIG.model;
    if (!apiKey) throw new Error('请先在「文字识别 → Paddle OCR」中填写 API Key（AI Studio 访问令牌）。');
    if (!PADDLE_MODELS.includes(model)) throw new Error('请选择有效的 Paddle OCR 模型。');
    if (!base64) throw new Error('没有可识别的图片。');
    const mime = base64.startsWith('data:image/jpeg;') ? 'image/jpeg' : 'image/png';
    let bytes;
    try {
        bytes = Array.from(atob(base64.replace(/^data:image\/[^;]+;base64,/, '')), (c) => c.charCodeAt(0));
    } catch {
        throw new Error('图片数据无效，请重新截图。');
    }
    const deadline = now() + timeoutMs;
    const check = () => {
        if (!isCurrent()) throw new Error('已取消文字识别。');
        if (now() >= deadline) throw new Error('Paddle OCR 云端排队或识别超时，可选择 PP-OCRv5 后重试。');
    };
    const send = async (url, options, authenticated = true) => {
        check();
        let response;
        try {
            response = await request(url, {
                ...options,
                headers: authenticated ? { ...options.headers, Authorization: `Bearer ${apiKey}` } : {},
                timeout: Math.max(1, Math.min(60, Math.ceil((deadline - now()) / 1000))),
            });
        } catch {
            throw new Error('无法连接 Paddle OCR，请检查网络后重试。');
        }
        check();
        if (response.status === 401 || response.status === 403)
            throw new Error('Paddle OCR API Key 无效或无访问权限，请检查 AI Studio 访问令牌。');
        if (response.status === 429) throw new Error('Paddle OCR 调用过于频繁或额度不足，请稍后重试。');
        if (!response.ok) throw new Error(`Paddle OCR 请求失败（HTTP ${response.status}）。`);
        if (!authenticated) return response.data;
        const payload = response.data;
        if (payload?.code !== undefined && payload.code !== 0)
            throw new Error(`Paddle OCR 服务返回错误（${payload.code}），请检查令牌、模型权限及调用额度。`);
        if (!payload?.data) throw new Error('Paddle OCR 返回的数据格式无效。');
        return payload.data;
    };
    const recognizeOnce = async (detailed) => {
        const job = await send(PADDLE_JOBS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'multipart/form-data' },
            body: formBody({
                model,
                // Upright screenshots need neither rotation classifiers nor document unwarping.
                // The server's 960px default can erase small type in wide document crops.
                optionalPayload: JSON.stringify({
                    useDocOrientationClassify: false,
                    useDocUnwarping: false,
                    useTextlineOrientation: false,
                    textDetLimitSideLen: detailed ? 2560 : 1536,
                    textDetLimitType: 'max',
                    textDetBoxThresh: detailed ? 0.3 : 0.4,
                    visualize: false,
                }),
                file: { file: bytes, mime, fileName: mime === 'image/jpeg' ? 'screenshot.jpg' : 'screenshot.png' },
            }),
        });
        if (typeof job.jobId !== 'string' || !job.jobId) throw new Error('Paddle OCR 未返回识别任务编号。');
        let interval = 500;
        while (true) {
            const status = await send(`${PADDLE_JOBS_URL}/${encodeURIComponent(job.jobId)}`, { method: 'GET' });
            if (status.state === 'failed')
                throw new Error('Paddle OCR 识别任务失败，请检查所选模型权限或重新截图后重试。');
            if (status.state === 'done') {
                const url = status.resultUrl?.jsonUrl;
                let parsed;
                try {
                    parsed = new URL(url);
                } catch {
                    /* checked below */
                }
                if (parsed?.protocol !== 'https:') throw new Error('Paddle OCR 未返回有效的结果下载地址。');
                const data = await send(url, { method: 'GET', responseType: 2 }, false);
                if (typeof data !== 'string') throw new Error('Paddle OCR 返回的结果文件格式无效。');
                return parsePaddleResult(data);
            }
            if (!['pending', 'running'].includes(status.state)) throw new Error('Paddle OCR 返回了未知的任务状态。');
            await sleep(Math.min(interval, Math.max(0, deadline - now())));
            interval = Math.min(2000, interval * 1.5);
        }
    };
    const result = await recognizeOnce(false);
    // Never assume a successful cloud job with no detected regions means the crop was empty.
    // Retry once with more detail, on the same selected Paddle model and within the same deadline.
    return result.text.trim() || !retryEmpty ? result : recognizeOnce(true);
}

// One short-lived successful image per window; failures and empty detections are never cached.
// Subscribers share an in-flight job, but cancelling one view cannot cancel another active view.
export function createPaddleRecognizer(run, { now = Date.now, ttlMs = 120000 } = {}) {
    let cached = null;
    const pending = new Set();
    const same = (entry, image, model, apiKey) =>
        entry.image === image && entry.model === model && entry.apiKey === apiKey;
    return async (image, config, isCurrent = () => true) => {
        const model = config?.model || DEFAULT_PADDLE_CONFIG.model;
        const apiKey = String(config?.apiKey || '').trim();
        if (!isCurrent()) throw new Error('已取消文字识别。');
        if (cached && (cached.until <= now() || cached.model !== model || cached.apiKey !== apiKey)) cached = null;
        if (cached && same(cached, image, model, apiKey)) return cached.result;
        let entry = [...pending].find(
            (item) => same(item, image, model, apiKey) && [...item.users].some((active) => active())
        );
        const subscriber = () => isCurrent();
        if (!entry) {
            entry = { image, model, apiKey, users: new Set([subscriber]) };
            pending.add(entry);
            entry.promise = Promise.resolve()
                .then(() => run(image, { ...config, model, apiKey }, () => [...entry.users].some((active) => active())))
                .then((result) => {
                    if (result.text?.trim() && [...entry.users].some((active) => active())) {
                        cached = { image, model, apiKey, result, until: now() + ttlMs };
                    }
                    return result;
                })
                .finally(() => pending.delete(entry));
        } else entry.users.add(subscriber);
        try {
            const result = await entry.promise;
            if (!isCurrent()) throw new Error('已取消文字识别。');
            return result;
        } finally {
            entry.users.delete(subscriber);
        }
    };
}
