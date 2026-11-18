const encoder = new TextEncoder();

// Keep text intact while bounding UTF-8 request size, including CJK and emoji.
export function splitSpeechText(text, maxBytes = 480) {
    const points = Array.from(String(text || '').trim());
    const chunks = [];
    let start = 0;
    while (start < points.length) {
        let end = start,
            bytes = 0,
            boundary = start;
        while (end < points.length && bytes + encoder.encode(points[end]).length <= maxBytes) {
            bytes += encoder.encode(points[end]).length;
            end++;
            if (/[\s。！？.!?;；]/u.test(points[end - 1])) boundary = end;
        }
        if (end === start) throw new Error('语音分段长度设置过小。');
        if (end < points.length && boundary > start && boundary - start >= (end - start) / 2) end = boundary;
        chunks.push(points.slice(start, end).join(''));
        start = end;
    }
    return chunks;
}

export function speechErrorMessage(error) {
    let text = error instanceof Error ? error.message : String(error || '语音服务请求失败');
    const status = /Http Status:\s*(\d+)/i.exec(text)?.[1];
    const bytes = /\[(?:\s*\d+\s*,)*\s*\d+\s*\]\s*$/.exec(text)?.[0];
    if (bytes) {
        try {
            text = new TextDecoder().decode(new Uint8Array(JSON.parse(bytes)));
        } catch {}
    }
    try {
        const body = JSON.parse(text);
        text =
            body.msg ||
            body.message ||
            body.base_resp?.status_message ||
            (body.audio === null ? '服务未返回音频，可能是文本过长或服务暂不可用。' : body.error || '语音服务请求失败');
    } catch {}
    if (/returned null audio/i.test(text)) text = '服务返回空音频，当前文本暂时无法合成。';
    return `${status ? `HTTP ${status}：` : ''}${String(text)
        .replace(/Bearer\s+\S+/gi, 'Bearer <REDACTED>')
        .slice(0, 240)}`;
}

// A failed provider is skipped for the remainder of this reading. A later
// failure retries only the current, unplayed segment on the next enabled one.
export async function* synthesizeSpeechChunks(text, services, { isCurrent = () => true, onService = () => {} } = {}) {
    if (!services.length) throw new Error('请先在服务设置中启用语音合成服务。');
    const failed = new Map(),
        loaded = new Map();
    let announced;
    for (const chunk of splitSpeechText(text)) {
        if (!isCurrent()) return;
        let success = false;
        for (const service of services) {
            if (!isCurrent()) return;
            if (failed.has(service)) continue;
            try {
                if (!loaded.has(service)) loaded.set(service, await service.load());
                if (!isCurrent()) return;
                const adapter = loaded.get(service);
                const data = await adapter.synthesize(chunk);
                if (!isCurrent()) return;
                if (!(Array.isArray(data) || data instanceof Uint8Array) || !data.length)
                    throw new Error('语音合成服务未返回音频。');
                if (announced !== service) {
                    onService(adapter.title || service.title, failed.size > 0);
                    announced = service;
                }
                success = true;
                yield data;
                break;
            } catch (error) {
                if (!isCurrent()) return;
                failed.set(service, speechErrorMessage(error));
            }
        }
        if (!success) throw new Error([...failed].map(([service, error]) => `${service.title}：${error}`).join('\n'));
    }
}

export function createSpeechPlayer(createContext = () => new (window.AudioContext || window.webkitAudioContext)()) {
    let active = null;
    const stop = () => {
        const previous = active;
        if (!previous) return;
        active = null;
        previous.controller.abort();
        previous.context.close().catch(() => {});
        previous.onState('idle');
    };
    return {
        get active() {
            return active !== null;
        },
        stop,
        async play(input, { onState = () => {} } = {}) {
            stop();
            const state = { controller: new AbortController(), context: createContext(), onState };
            active = state;
            const isCurrent = () => active === state;
            onState('loading');
            try {
                await state.context.resume();
                if (!isCurrent()) return;
                const data = typeof input === 'function' ? input(isCurrent) : input;
                const chunks = data?.[Symbol.asyncIterator] ? data : [data];
                for await (const chunk of chunks) {
                    if (!isCurrent()) return;
                    const buffer = await state.context.decodeAudioData(new Uint8Array(chunk).buffer);
                    if (!isCurrent()) return;
                    const source = state.context.createBufferSource();
                    source.buffer = buffer;
                    source.connect(state.context.destination);
                    await new Promise((resolve, reject) => {
                        const finish = (error) => {
                            source.onended = null;
                            state.controller.signal.removeEventListener('abort', cancel);
                            source.disconnect();
                            if (error) reject(error);
                            else resolve();
                        };
                        const cancel = () => {
                            source.onended = null;
                            try {
                                source.stop();
                            } catch {}
                            finish();
                        };
                        source.onended = () => finish();
                        state.controller.signal.addEventListener('abort', cancel, { once: true });
                        try {
                            source.start();
                            onState('playing');
                        } catch (error) {
                            finish(error);
                        }
                    });
                    if (!isCurrent()) return;
                }
            } catch (error) {
                if (isCurrent()) throw new Error(speechErrorMessage(error));
            } finally {
                if (isCurrent()) stop();
            }
        },
    };
}
