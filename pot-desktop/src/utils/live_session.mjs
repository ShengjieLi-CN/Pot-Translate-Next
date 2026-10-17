import { normalizeTranscript, SpeakerRegistry, trimTranscriptOverlap } from './live_interpretation.mjs';

// A bounded serial STT queue and a separate translation queue keep transcripts
// moving while a translator is slow. A session never drops speech silently.
export class LiveSession {
    constructor({ transcribe, translate, config, onRows = () => {}, onState = () => {}, onBackpressure = () => {} }) {
        Object.assign(this, { transcribe, translate, config, onRows, onState, onBackpressure });
        this.registry = new SpeakerRegistry({ mode: config.speakerMode, threshold: Number(config.threshold) });
        this.rows = [];
        this.queue = [];
        this.translations = [];
        this.failed = [];
        this.active = true;
        this.processing = false;
        this.translating = false;
        this.counter = 0;
    }
    state(extra = {}) {
        if (this.active)
            this.onState({
                pending:
                    this.queue.length + this.translations.length + Number(this.processing) + Number(this.translating),
                failed: this.failed.length,
                ...extra,
            });
    }
    publish() {
        if (this.active) this.onRows([...this.rows]);
    }
    enqueue(chunk) {
        if (!this.active || !chunk.pcm.length) return;
        const energy = chunk.pcm.reduce((sum, value) => sum + value * value, 0) / chunk.pcm.length;
        if (energy < 0.00000025) return; // Digital silence; keep the recording timeline intact.
        if (this.failed.length) {
            this.failed.push(chunk);
            this.state();
            return;
        }
        this.queue.push(chunk);
        this.state();
        if (this.queue.length >= 6) this.onBackpressure();
        this.process();
    }
    async process() {
        if (this.processing || !this.active) return;
        this.processing = true;
        while (this.queue.length && this.active) {
            const chunk = this.queue.shift();
            this.state();
            try {
                const data = await this.transcribe(chunk, this.config.references ? this.registry.references() : []);
                if (!this.active) break;
                const segments = normalizeTranscript(data, chunk.pcm.length / chunk.sampleRate);
                const local = new Map();
                const previous = [...this.rows];
                let missing = false;
                let missingVoice = false;
                for (const segment of segments) {
                    const speaker = this.config.diarization
                        ? this.registry.assign(segment, local, previous, chunk.offset)
                        : null;
                    if (this.config.diarization && !speaker) missing = true;
                    if (
                        this.config.diarization &&
                        this.config.speakerMode === 'embedding' &&
                        !segment.embedding &&
                        !this.config.references
                    )
                        missingVoice = true;
                    if (this.config.references && speaker)
                        this.registry.learnReference(speaker, segment, chunk.pcm, chunk.sampleRate);
                    const start = chunk.offset + segment.start,
                        end = chunk.offset + segment.end;
                    const last = [...this.rows].reverse().find((r) => r.speaker === speaker && r.end > start + 0.03);
                    const text = last ? trimTranscriptOverlap(last.text, segment.text) : segment.text;
                    if (!text || (last && end <= last.end + 0.03)) continue;
                    const row = {
                        id: ++this.counter,
                        start: last ? Math.max(start, last.end) : start,
                        end,
                        text,
                        speaker,
                        language: segment.language,
                        translation: '',
                        status: 'pending',
                        error: '',
                    };
                    this.rows.push(row);
                    this.translations.push(row);
                }
                this.publish();
                this.state({
                    warning: missing
                        ? 'STT 未返回说话人标签或声纹，当前片段显示为“未识别”。请选择支持说话人分离的模型。'
                        : missingVoice
                          ? '模型仅返回片段标签，未返回声纹向量；跨片段身份暂按重叠语音关联。请使用支持声纹的模型或调整说话人关联方式。'
                          : '',
                });
                if (this.translations.length >= 24) this.onBackpressure();
                this.processTranslations();
            } catch (error) {
                if (this.active) {
                    this.failed.push(chunk);
                    this.state({ error: String(error) });
                    this.onBackpressure();
                    // Stop the request train on a bad endpoint/key; preserve the backlog for retry.
                    this.failed.push(...this.queue.splice(0));
                    break;
                }
            }
        }
        this.processing = false;
        this.state();
    }
    async processTranslations() {
        if (this.translating || !this.active) return;
        this.translating = true;
        while (this.translations.length && this.active) {
            const row = this.translations.shift();
            this.state();
            try {
                const result = await this.translate(row.text, row.language, (value) => {
                    if (this.active && typeof value === 'string') {
                        row.translation = value;
                        this.publish();
                    }
                });
                if (!this.active) break;
                if (typeof result !== 'string' || !result.trim() || result === '[STREAM]')
                    throw new Error('请选择文本翻译服务，当前服务未返回译文。');
                row.translation = result.trim();
                row.status = 'done';
                row.error = '';
            } catch (error) {
                if (this.active) {
                    row.status = 'error';
                    row.error = String(error);
                }
            }
            this.publish();
        }
        this.translating = false;
        this.state();
    }
    retry() {
        this.queue.unshift(...this.failed.splice(0));
        for (const row of this.rows)
            if (row.status === 'error') {
                row.status = 'pending';
                row.error = '';
                this.translations.push(row);
            }
        this.state({ error: '', warning: '' });
        this.process();
        this.processTranslations();
        this.publish();
    }
    cancel() {
        this.active = false;
        this.queue = [];
        this.translations = [];
        this.failed = [];
    }
}
