export const DEFAULT_STT = {
    endpoint: 'http://127.0.0.1:8000/v1/audio/transcriptions',
    apiKey: '',
    model: '',
    responseFormat: 'diarized_json',
    extra: '{}',
    diarization: true,
    speakerMode: 'embedding',
    references: false,
    chunkSeconds: 8,
    threshold: 0.8,
};

export function validateStt(config) {
    const url = new URL(config.endpoint);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error('STT 地址必须是 HTTP/HTTPS 接口，且不能包含用户名或密码。');
    if (!config.model?.trim()) throw new Error('请填写 STT 模型名称。');
    const extra = JSON.parse(config.extra || '{}');
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('附加参数必须是 JSON 对象。');
    if (
        [
            'file',
            'model',
            'stream',
            'response_format',
            'language',
            'known_speaker_names',
            'known_speaker_references',
        ].some((k) => k in extra)
    )
        throw new Error('附加参数不能覆盖文件、模型、语言、流式开关、返回格式或说话人参考音频。');
    if (!(Number(config.chunkSeconds) >= 3 && Number(config.chunkSeconds) <= 30))
        throw new Error('分段长度应为 3–30 秒。');
    if (!(Number(config.threshold) > 0 && Number(config.threshold) <= 1))
        throw new Error('声纹相似度阈值应大于 0 且不超过 1。');
    return extra;
}

export function encodeWav(pcm, sampleRate) {
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
        throw new Error('Unsupported audio sample rate');
    const buffer = new ArrayBuffer(44 + pcm.length * 2),
        view = new DataView(buffer);
    const write = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    write(0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, pcm.length * 2, true);
    pcm.forEach((sample, i) =>
        view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767)), true)
    );
    return new Uint8Array(buffer);
}

export function pcmFromBase64(value) {
    const raw = atob(value),
        view = new DataView(Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer);
    if (view.byteLength % 2) throw new Error('Invalid PCM packet');
    return Float32Array.from({ length: view.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true) / 32768);
}

export function bytesBase64(bytes) {
    let value = '';
    for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(value);
}

export function concatenate(parts) {
    const result = new Float32Array(parts.reduce((n, part) => n + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        result.set(part, offset);
        offset += part.length;
    }
    return result;
}

export class PcmChunker {
    constructor(sampleRate, seconds = 8, overlap = 0.75) {
        this.rate = sampleRate;
        this.size = Math.round(seconds * sampleRate);
        this.overlap = Math.round(overlap * sampleRate);
        this.buffer = new Float32Array();
        this.offset = 0;
        this.fresh = 0;
    }
    push(samples) {
        this.buffer = concatenate([this.buffer, samples]);
        this.fresh += samples.length;
        const chunks = [];
        while (this.buffer.length >= this.size) {
            chunks.push({
                pcm: this.buffer.slice(0, this.size),
                offset: this.offset / this.rate,
                sampleRate: this.rate,
            });
            const advance = this.size - this.overlap;
            this.buffer = this.buffer.slice(advance);
            this.offset += advance;
            this.fresh = this.buffer.length - this.overlap;
        }
        return chunks;
    }
    flush() {
        const chunk =
            this.fresh > 0 && this.buffer.length
                ? { pcm: this.buffer, offset: this.offset / this.rate, sampleRate: this.rate }
                : null;
        this.offset += this.buffer.length;
        this.buffer = new Float32Array();
        this.fresh = 0;
        return chunk;
    }
}

export function normalizeTranscript(response, duration) {
    const data = typeof response === 'string' ? { text: response } : response?.data ?? response;
    if (!data || typeof data !== 'object') throw new Error('STT 返回值必须包含 text 或 segments。');
    if (data.error) throw new Error('STT 服务返回错误，请检查模型和附加参数。');
    const raw = data.segments || data.utterances || data.results?.utterances;
    if (raw != null && !Array.isArray(raw)) throw new Error('STT segments 必须是数组。');
    if (!raw && typeof data.text !== 'string') throw new Error('STT 返回值缺少 text 或 segments。');
    const segments = raw || (data.text?.trim() ? [{ text: data.text, start: 0, end: duration }] : []);
    return segments
        .flatMap((s) => {
            const text = String(s.text ?? s.transcript ?? '').trim();
            if (!text || Number(s.no_speech_prob || 0) > 0.8) return [];
            const start = Math.max(0, Math.min(duration, Number(s.start ?? s.start_time ?? 0)));
            const end = Math.max(start, Math.min(duration, Number(s.end ?? s.end_time ?? duration)));
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
            const rawSpeaker = s.speaker ?? s.speaker_id ?? null;
            return [
                {
                    text,
                    start,
                    end,
                    speaker: rawSpeaker == null ? null : String(rawSpeaker),
                    embedding: s.speaker_embedding ?? s.embedding ?? data.speaker_embeddings?.[rawSpeaker] ?? null,
                    language: s.language ?? data.language ?? null,
                },
            ];
        })
        .sort((a, b) => a.start - b.start);
}

export function cosineSimilarity(a, b) {
    if (
        !Array.isArray(a) ||
        !Array.isArray(b) ||
        !a.length ||
        a.length !== b.length ||
        !a.every(Number.isFinite) ||
        !b.every(Number.isFinite)
    )
        return -1;
    const dot = a.reduce((s, n, i) => s + n * b[i], 0);
    const length = Math.sqrt(a.reduce((s, n) => s + n * n, 0) * b.reduce((s, n) => s + n * n, 0));
    return length ? dot / length : -1;
}

export class SpeakerRegistry {
    constructor({ mode = 'embedding', threshold = 0.8 } = {}) {
        this.mode = mode;
        this.threshold = threshold;
        this.people = [];
        this.global = new Map();
    }
    create(embedding = null) {
        const person = { id: `speaker_${this.people.length + 1}`, embedding, reference: null };
        this.people.push(person);
        return person.id;
    }
    assign(segment, local = new Map(), previous = [], offset = 0) {
        if (segment.speaker == null && !segment.embedding) return null;
        if (this.people.some((p) => p.id === segment.speaker && p.reference)) return segment.speaker;
        const localKey = segment.speaker;
        if (localKey != null && local.has(localKey)) return local.get(localKey);
        let id = null;
        if (this.mode === 'embedding' && segment.embedding) {
            const ranked = this.people
                .map((p) => [p, cosineSimilarity(p.embedding, segment.embedding)])
                .sort((a, b) => b[1] - a[1]);
            if (ranked[0]?.[1] >= this.threshold) id = ranked[0][0].id;
            else id = this.create(segment.embedding);
        } else if (this.mode === 'global' && localKey != null) {
            id = this.global.get(localKey);
            if (!id) {
                id = this.create();
                this.global.set(localKey, id);
            }
        } else {
            // Chunk-local labels (A/B) have no identity meaning across requests.
            // Only an overlapping, already labelled utterance can connect them.
            const overlap = previous.filter(
                (p) =>
                    p.speaker &&
                    Math.min(p.end, segment.end + offset) - Math.max(p.start, segment.start + offset) > 0.15
            );
            if (overlap.length && new Set(overlap.map((p) => p.speaker)).size === 1) id = overlap[0].speaker;
            if (!id) id = this.create();
        }
        if (localKey != null) local.set(localKey, id);
        return id;
    }
    references() {
        return this.people
            .filter((p) => p.reference)
            .slice(0, 4)
            .map((p) => ({ name: p.id, audio: p.reference }));
    }
    learnReference(id, segment, pcm, sampleRate) {
        const person = this.people.find((p) => p.id === id);
        if (!person || person.reference || segment.end - segment.start < 2) return;
        const clip = pcm.slice(
            Math.ceil(segment.start * sampleRate),
            Math.floor(Math.min(segment.end, segment.start + 8) * sampleRate)
        );
        if (clip.length / sampleRate >= 2)
            person.reference = `data:audio/wav;base64,${bytesBase64(encodeWav(clip, sampleRate))}`;
    }
}

export function trimTranscriptOverlap(previous, text) {
    const before = String(previous ?? '').trim(),
        next = text.trim();
    if (before === next) return '';
    const max = Math.min(before.length, next.length);
    for (let n = max; n >= 3; n--) {
        if (
            before.slice(-n).toLocaleLowerCase() === next.slice(0, n).toLocaleLowerCase() &&
            (!/[a-z]/i.test(next[n - 1]) || !/[a-z]/i.test(next[n] || ''))
        )
            return next.slice(n).trim();
    }
    return next;
}

export function formatTime(seconds, milliseconds = false) {
    const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000));
    const time = [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
        .map((v) => String(v).padStart(2, '0'))
        .join(':');
    return milliseconds ? `${time},${String(ms % 1000).padStart(3, '0')}` : time;
}

export function exportTranscript(rows, format = 'txt', names = {}) {
    const name = (r) => (r.speaker ? names[r.speaker] || `讲话人 ${r.speaker.split('_').at(-1)}` : '说话人未识别');
    if (format === 'json') return JSON.stringify({ version: '3.1.2', speakers: names, segments: rows }, null, 2);
    if (format === 'srt')
        return rows
            .map(
                (r, i) =>
                    `${i + 1}\n${formatTime(r.start, true)} --> ${formatTime(r.end, true)}\n[${name(r)}] ${r.text}\n${r.translation || ''}\n`
            )
            .join('\n');
    return rows.map((r) => `${formatTime(r.start)} ${name(r)}\n${r.text}\n${r.translation || ''}`).join('\n\n');
}
