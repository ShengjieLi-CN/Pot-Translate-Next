import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody } from '@nextui-org/react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/api/dialog';
import { writeBinaryFile, writeTextFile } from '@tauri-apps/api/fs';
import { useNavigate } from 'react-router-dom';
import { useConfig } from '../../../../hooks';
import { store } from '../../../../utils/store';
import { languageList } from '../../../../utils/language';
import {
    DEFAULT_STT,
    PcmChunker,
    pcmFromBase64,
    concatenate,
    encodeWav,
    formatTime,
    exportTranscript,
    validateStt,
} from '../../../../utils/live_interpretation.mjs';
import { LiveSession } from '../../../../utils/live_session.mjs';
import {
    createLiveTranslator,
    loadLiveTranslators,
    transcribeLiveChunk,
    testSttModel,
} from '../../../../services/live_interpretation';
import './style.css';

let draft = { rows: [], names: {}, audioUrl: '', audioBytes: null, seconds: 0 };

export default function LiveInterpretation() {
    const { i18n, t } = useTranslation();
    const L = (cn, en) => (i18n.language.startsWith('zh') ? cn : en);
    const navigate = useNavigate();
    const [savedConfig] = useConfig('live_stt', DEFAULT_STT);
    const [config, setConfig] = useState(DEFAULT_STT);
    const [translateKeys] = useConfig('translate_service_list', [
        'deepl',
        'bing',
        'lingva',
        'yandex',
        'google',
        'ecdict',
    ]);
    const [translators, setTranslators] = useState([]);
    const [translator, setTranslator] = useState('');
    const [source, setSource] = useState('auto');
    const [target, setTarget] = useState('zh_cn');
    const [input, setInput] = useState('system');
    const [settings, setSettings] = useState(false);
    const [rows, setRows] = useState(draft.rows);
    const [names, setNames] = useState(draft.names);
    const [status, setStatus] = useState('idle');
    const [seconds, setSeconds] = useState(draft.seconds);
    const [audioUrl, setAudioUrl] = useState(draft.audioUrl);
    const [wave, setWave] = useState(Array(64).fill(0));
    const [pending, setPending] = useState(0);
    const [failed, setFailed] = useState(0);
    const [error, setError] = useState('');
    const [warning, setWarning] = useState('');
    const [notice, setNotice] = useState('');
    const [testingStt, setTestingStt] = useState(false);
    const [sttTestResult, setSttTestResult] = useState(null);
    const sttTestRevision = useRef(0);
    const [playbackTime, setPlaybackTime] = useState(0);
    const [autoScroll, setAutoScroll] = useState(true);
    const engine = useRef(null);
    const captureId = useRef(null);
    const chunker = useRef(null);
    const recording = useRef({ parts: [], rate: 16000, samples: 0, lastSequence: -1 });
    const stopIntent = useRef('stopped');
    const transcriptEnd = useRef(null);
    const audio = useRef(null);
    const mounted = useRef(true);
    const subscriptions = useRef(Promise.resolve([]));
    const importCancelled = useRef(false);
    const runKind = useRef('live');
    const fileInput = useRef(null);
    const active = ['starting', 'recording', 'stopping', 'paused', 'importing'].includes(status);
    const editingDisabled = active || pending > 0 || testingStt;

    useEffect(() => {
        sttTestRevision.current++;
        setSttTestResult(null);
    }, [config]);

    useEffect(() => {
        if (savedConfig) setConfig({ ...DEFAULT_STT, ...savedConfig });
    }, [savedConfig]);
    useEffect(() => {
        if (!translateKeys) return;
        let disposed = false;
        loadLiveTranslators(translateKeys)
            .then(async (list) => {
                const selected = await store.get('live_translate_service');
                if (!disposed) {
                    setTranslators(list);
                    setTranslator(
                        (old) => list.find((s) => s.key === old || s.key === selected)?.key || list[0]?.key || ''
                    );
                }
            })
            .catch((e) => {
                if (!disposed) setError(String(e));
            });
        return () => {
            disposed = true;
        };
    }, [translateKeys]);

    const finishAudio = () => {
        const record = recording.current;
        if (!record.samples) return;
        const bytes = encodeWav(concatenate(record.parts), record.rate);
        if (draft.audioUrl) URL.revokeObjectURL(draft.audioUrl);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
        draft.audioBytes = bytes;
        draft.audioUrl = url;
        draft.seconds = record.samples / record.rate;
        if (mounted.current) setAudioUrl(url);
    };

    const requestStop = async (intent = 'stopped') => {
        stopIntent.current = intent;
        importCancelled.current = true;
        const id = captureId.current;
        if (!id) {
            if (mounted.current) setStatus(intent);
            return;
        }
        if (mounted.current) setStatus('stopping');
        try {
            await invoke('live_audio_stop', { session: id });
        } catch (e) {
            if (mounted.current) setError(String(e));
        }
    };

    useEffect(() => {
        mounted.current = true;
        subscriptions.current = Promise.all([
            listen('live-audio-frame', ({ payload }) => {
                if (payload.session !== captureId.current || !chunker.current || !mounted.current) return;
                try {
                    const record = recording.current;
                    if (record.lastSequence >= 0 && payload.sequence !== record.lastSequence + 1)
                        throw new Error('音频数据包中断，请停止后重试。');
                    record.lastSequence = payload.sequence;
                    if (payload.sampleRate !== record.rate) throw new Error('音频采样率发生变化，请重新开始。');
                    const samples = pcmFromBase64(payload.pcm);
                    record.parts.push(samples);
                    record.samples += samples.length;
                    setSeconds(record.samples / record.rate);
                    setWave((old) => [...old.slice(1), Math.min(1, payload.peak || 0)]);
                    for (const part of chunker.current.push(samples)) engine.current?.enqueue(part);
                    if (record.samples / record.rate >= 1800) {
                        setWarning('已达到 30 分钟会话上限，请导出后开始新会话。');
                        requestStop();
                    }
                } catch (e) {
                    setError(String(e));
                    requestStop('paused');
                }
            }),
            listen('live-audio-stopped', ({ payload }) => {
                if (payload.session !== captureId.current) return;
                captureId.current = null;
                const tail = chunker.current?.flush();
                if (tail) engine.current?.enqueue(tail);
                finishAudio();
                if (mounted.current) setStatus(stopIntent.current);
            }),
            listen('live-audio-error', ({ payload }) => {
                if (payload.session === captureId.current && mounted.current) setError(payload.error);
            }),
        ]);
        subscriptions.current.catch((e) => {
            if (mounted.current) setError(String(e));
        });
        return () => {
            mounted.current = false;
            importCancelled.current = true;
            engine.current?.cancel();
            if (captureId.current) invoke('live_audio_stop', { session: captureId.current }).catch(() => {});
            finishAudio();
            subscriptions.current.then((list) => list.forEach((unlisten) => unlisten())).catch(() => {});
        };
    }, []);

    useEffect(() => {
        draft.rows = rows;
    }, [rows]);
    useEffect(() => {
        draft.names = names;
    }, [names]);
    useEffect(() => {
        if (autoScroll && rows.length) transcriptEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [rows, autoScroll]);

    const prepare = async () => {
        validateStt(config);
        const service = translators.find((s) => s.key === translator);
        if (!service)
            throw new Error(L('请先配置至少一个文本翻译服务。', 'Configure a text translation service first.'));
        if (!(target in service.Language))
            throw new Error(L('翻译服务不支持当前目标语言。', 'The translator does not support the target language.'));
        await store.set('live_stt', config);
        await store.set('live_translate_service', translator);
        await store.save();
        engine.current?.cancel();
        if (draft.audioUrl) URL.revokeObjectURL(draft.audioUrl);
        draft = { rows: [], names: {}, audioUrl: '', audioBytes: null, seconds: 0 };
        setRows([]);
        setNames({});
        setAudioUrl('');
        setSeconds(0);
        setPending(0);
        setFailed(0);
        setWarning('');
        setError('');
        setNotice('');
        recording.current = { parts: [], samples: 0, rate: 16000, lastSequence: -1 };
        chunker.current = new PcmChunker(16000, Number(config.chunkSeconds));
        engine.current = new LiveSession({
            config,
            transcribe: (part, references) => transcribeLiveChunk(part, config, source, references),
            translate: createLiveTranslator(service, source, target),
            onRows: (next) => {
                if (mounted.current) setRows(next);
            },
            onState: (state) => {
                if (!mounted.current) return;
                setPending(state.pending);
                setFailed(state.failed);
                if (state.error !== undefined) setError(state.error);
                if (state.warning !== undefined) setWarning(state.warning);
            },
            onBackpressure: () => {
                if (mounted.current) {
                    setWarning('处理速度暂时落后或服务出错，已暂停采集；待队列完成或重试后可继续。');
                    if (runKind.current === 'live') requestStop('paused');
                }
            },
        });
    };

    const start = async (resume = false) => {
        if (['starting', 'recording', 'stopping', 'importing'].includes(status)) return;
        try {
            setStatus('starting');
            runKind.current = 'live';
            audio.current?.pause();
            await subscriptions.current;
            if (!resume) await prepare();
            if (!mounted.current) return;
            recording.current.lastSequence = -1;
            stopIntent.current = 'stopped';
            const id = crypto.randomUUID();
            captureId.current = id;
            await invoke('live_audio_start', { session: id, source: input });
            if (mounted.current && captureId.current === id) setStatus('recording');
        } catch (e) {
            captureId.current = null;
            if (mounted.current) {
                setError(String(e));
                setStatus('stopped');
            }
        }
    };

    const saveSettings = async () => {
        try {
            validateStt(config);
            await store.set('live_stt', config);
            await store.save();
            setNotice(L('STT 配置已保存。', 'STT settings saved.'));
        } catch (e) {
            setError(String(e));
        }
    };

    const testModel = async () => {
        if (editingDisabled) return;
        const revision = ++sttTestRevision.current;
        setSttTestResult(null);
        setTestingStt(true);
        try {
            const result = await testSttModel(config);
            if (mounted.current && sttTestRevision.current === revision)
                setSttTestResult({ ...result, kind: result.text ? 'success' : 'warning' });
        } catch (error) {
            if (mounted.current && sttTestRevision.current === revision)
                setSttTestResult({ kind: 'error', message: String(error) });
        } finally {
            if (mounted.current) setTestingStt(false);
        }
    };

    const importAudio = async (file) => {
        if (!file) return;
        try {
            if (file.size > 100 * 1024 * 1024) throw new Error('音频文件不能超过 100MB。');
            runKind.current = 'file';
            setStatus('starting');
            await prepare();
            const context = new AudioContext();
            let decoded;
            try {
                decoded = await context.decodeAudioData(await file.arrayBuffer());
            } finally {
                await context.close();
            }
            if (decoded.duration > 1800) throw new Error('音频文件不能超过 30 分钟。');
            const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
            const node = offline.createBufferSource();
            node.buffer = decoded;
            node.connect(offline.destination);
            node.start();
            const rendered = await offline.startRendering();
            if (!mounted.current) return;
            const pcm = rendered.getChannelData(0).slice();
            recording.current = { parts: [pcm], samples: pcm.length, rate: 16000, lastSequence: -1 };
            finishAudio();
            setSeconds(pcm.length / 16000);
            setStatus('importing');
            importCancelled.current = false;
            const size = Math.round(Number(config.chunkSeconds) * 16000),
                advance = size - 12000;
            for (
                let offset = 0;
                offset < pcm.length && !importCancelled.current && mounted.current;
                offset += advance
            ) {
                while (
                    (engine.current.queue.length >= 3 || engine.current.failed.length) &&
                    !importCancelled.current &&
                    mounted.current
                )
                    await new Promise((r) => setTimeout(r, 100));
                if (importCancelled.current || !mounted.current) break;
                engine.current.enqueue({
                    pcm: pcm.slice(offset, offset + size),
                    sampleRate: 16000,
                    offset: offset / 16000,
                });
                if (offset + size >= pcm.length) break;
            }
            if (mounted.current) setStatus('stopped');
        } catch (e) {
            if (mounted.current) {
                setError(String(e));
                setStatus('stopped');
            }
        }
        if (fileInput.current) fileInput.current.value = '';
    };

    const exportFile = async (format) => {
        try {
            const path = await save({
                defaultPath: `同声传译.${format}`,
                filters: [{ name: format.toUpperCase(), extensions: [format] }],
            });
            if (!path) return;
            if (format === 'wav') {
                if (!draft.audioBytes) return;
                await writeBinaryFile(path, draft.audioBytes);
            } else await writeTextFile(path, exportTranscript(rows, format, names));
            setNotice(L('已导出。', 'Exported.'));
        } catch (e) {
            setError(String(e));
        }
    };

    const update = (key, value) => {
        setConfig((old) => ({ ...old, [key]: value }));
        setNotice('');
    };
    const formField = (label, key, type = 'text') => (
        <label className='live-field'>
            {label}
            <input
                aria-label={label}
                type={type}
                value={config[key]}
                disabled={editingDisabled}
                autoComplete='off'
                spellCheck={false}
                onChange={(e) => update(key, e.target.value)}
            />
        </label>
    );
    const select = (label, value, options, change, disabled = editingDisabled) => (
        <label className='live-field'>
            <span>{label}</span>
            <select
                aria-label={label}
                value={value}
                disabled={disabled}
                onChange={(e) => change(e.target.value)}
            >
                {options.map(([key, text]) => (
                    <option
                        key={key}
                        value={key}
                    >
                        {text}
                    </option>
                ))}
            </select>
        </label>
    );
    const langOptions = languageList.map((key) => [key, t(`languages.${key}`)]);
    const speakers = [...new Set(rows.map((r) => r.speaker).filter(Boolean))];
    const rowSpeaker = (row) =>
        row.speaker
            ? names[row.speaker] || `${L('讲话人', 'Speaker')} ${row.speaker.split('_').at(-1)}`
            : L('说话人未识别', 'Unknown speaker');

    return (
        <div className='live-page'>
            <div className='live-page-heading'>
                <div>
                    <h2>{L('同声传译', 'Live interpretation')}</h2>
                    <p>
                        {L(
                            '实时转写 · 逐段翻译 · 区分说话人',
                            'Live transcription · Translation · Speaker diarization'
                        )}
                    </p>
                </div>
                <Button
                    size='sm'
                    variant='flat'
                    onPress={() => setSettings(!settings)}
                >
                    {L('STT 模型设置', 'STT settings')}
                </Button>
            </div>
            <Card
                shadow='none'
                className='bg-content1 rounded-[12px]'
            >
                <CardBody className='gap-4'>
                    <div className='live-wave-player'>
                        <span
                            className={`live-record-indicator ${status === 'recording' ? 'running' : ''}`}
                            aria-label={
                                status === 'recording' ? L('正在录音', 'Recording') : L('未录音', 'Not recording')
                            }
                        />
                        <strong>{formatTime(seconds)}</strong>
                        <div
                            className='live-wave'
                            aria-hidden
                        >
                            {wave.map((peak, i) => (
                                <span
                                    key={i}
                                    style={{ height: `${Math.max(8, peak * 100)}%` }}
                                />
                            ))}
                        </div>
                        <span className='live-status'>
                            {
                                {
                                    idle: L('准备就绪', 'Ready'),
                                    starting: L('准备中', 'Starting'),
                                    recording: L('正在聆听', 'Listening'),
                                    stopping: L('正在停止', 'Stopping'),
                                    paused: L('已暂停', 'Paused'),
                                    stopped: L('已停止', 'Stopped'),
                                    importing: L('转写音频', 'Transcribing file'),
                                }[status]
                            }
                        </span>
                    </div>
                    <div className='live-action-bar'>
                        {status === 'paused' ? (
                            <Button
                                size='sm'
                                color='primary'
                                onPress={() => start(true)}
                                isDisabled={failed > 0 || pending >= 6}
                            >
                                {L('继续', 'Resume')}
                            </Button>
                        ) : (
                            <Button
                                size='sm'
                                color='primary'
                                onPress={() => start()}
                                isDisabled={active || pending > 0 || testingStt}
                            >
                                {L('开始同传', 'Start')}
                            </Button>
                        )}
                        <Button
                            size='sm'
                            variant='flat'
                            onPress={() => requestStop('paused')}
                            isDisabled={status !== 'recording'}
                        >
                            {L('暂停', 'Pause')}
                        </Button>
                        <Button
                            size='sm'
                            variant='flat'
                            onPress={() => requestStop()}
                            isDisabled={!['recording', 'paused', 'importing'].includes(status)}
                        >
                            {L('结束', 'Stop')}
                        </Button>
                        <Button
                            size='sm'
                            variant='light'
                            onPress={() => fileInput.current.click()}
                            isDisabled={editingDisabled}
                        >
                            {L('导入音频', 'Import audio')}
                        </Button>
                        <input
                            type='file'
                            accept='audio/*'
                            ref={fileInput}
                            className='hidden'
                            aria-label={L('选择音频文件', 'Choose audio file')}
                            onChange={(e) => importAudio(e.target.files?.[0])}
                        />
                        <span
                            className='live-queue'
                            role='status'
                        >
                            {pending > 0 ? `${L('处理中', 'Pending')} ${pending}` : L('转写队列已完成', 'Queue idle')}
                        </span>
                    </div>
                    {audioUrl && (
                        <audio
                            ref={audio}
                            aria-label={L('会话音频回放', 'Session audio')}
                            controls
                            src={audioUrl}
                            onTimeUpdate={(e) => setPlaybackTime(e.currentTarget.currentTime)}
                        />
                    )}
                    <div className='live-language-bar'>
                        {select(
                            L('原文语言', 'Source language'),
                            source,
                            [['auto', t('languages.auto')], ...langOptions],
                            setSource
                        )}
                        <button
                            aria-label={L('交换语言', 'Swap languages')}
                            disabled={editingDisabled || source === 'auto'}
                            onClick={() => {
                                setSource(target);
                                setTarget(source);
                            }}
                        >
                            ⇄
                        </button>
                        {select(L('目标语言', 'Target language'), target, langOptions, setTarget)}
                    </div>
                    <div className='live-source-options'>
                        {select(
                            L('音频来源', 'Audio source'),
                            input,
                            [
                                ['system', L('系统声音', 'System audio')],
                                ['microphone', L('麦克风', 'Microphone')],
                            ],
                            setInput
                        )}
                        {select(
                            L('翻译服务', 'Translator'),
                            translator,
                            translators.map((s) => [s.key, s.title]),
                            setTranslator
                        )}
                    </div>
                    {!translators.length && (
                        <button
                            className='text-primary text-sm text-left'
                            onClick={() => navigate('/service')}
                        >
                            {L('请先到服务设置启用文本翻译服务。', 'Enable a text translator in service settings.')}
                        </button>
                    )}
                </CardBody>
            </Card>

            {settings && (
                <Card
                    shadow='none'
                    className='bg-content1 rounded-[12px]'
                >
                    <CardBody className='live-settings'>
                        <h3>{L('自定义 Speech-to-Text 模型', 'Custom Speech-to-Text model')}</h3>
                        <p className='live-help'>
                            {L(
                                '使用兼容 multipart 音频转写接口。本地模型无需 API Key；云端请填写自己的访问凭据。',
                                'Use a multipart-compatible transcription endpoint. Local servers may not require an API key.'
                            )}
                        </p>
                        {formField(L('STT 接口地址', 'STT endpoint'), 'endpoint', 'url')}
                        <div className='live-source-options'>
                            {formField('API Key', 'apiKey', 'password')}
                            {formField(L('STT 模型名称', 'STT model'), 'model')}
                        </div>
                        <div className='live-source-options'>
                            {select(
                                L('返回格式', 'Response format'),
                                config.responseFormat,
                                [
                                    ['diarized_json', 'diarized_json'],
                                    ['verbose_json', 'verbose_json'],
                                    ['json', 'json'],
                                ],
                                (v) => update('responseFormat', v)
                            )}
                            {formField(L('分段长度（秒）', 'Chunk length (seconds)'), 'chunkSeconds', 'number')}
                        </div>
                        <label className='live-check'>
                            <input
                                type='checkbox'
                                checked={config.diarization}
                                disabled={editingDisabled}
                                onChange={(e) => update('diarization', e.target.checked)}
                            />
                            {L('区分说话人', 'Speaker diarization')}
                        </label>
                        {select(
                            L('说话人关联方式', 'Speaker matching'),
                            config.speakerMode,
                            [
                                ['embedding', L('声纹向量（推荐）', 'Voice embeddings (recommended)')],
                                ['global', L('服务返回会话级 ID', 'Session-wide speaker IDs')],
                                ['local', L('片段标签 + 重叠语音', 'Chunk labels + overlapping speech')],
                            ],
                            (v) => update('speakerMode', v)
                        )}
                        {config.speakerMode === 'embedding' &&
                            formField(
                                L('声纹相似度阈值（0–1）', 'Voice similarity threshold (0–1)'),
                                'threshold',
                                'number'
                            )}
                        <label className='live-check'>
                            <input
                                type='checkbox'
                                checked={config.references}
                                disabled={editingDisabled}
                                onChange={(e) => update('references', e.target.checked)}
                            />
                            {L(
                                '发送说话人参考音频（接口需支持）',
                                'Send speaker reference clips (requires server support)'
                            )}
                        </label>
                        <p className='live-help'>
                            {L(
                                '同一片段的 A/B 标签不能直接代表跨片段的同一个人。声纹模式需返回 speaker_embedding；会话 ID 模式需服务保证 ID 稳定；参考音频模式最多发送 4 位说话人的 2–8 秒语音。',
                                'A/B chunk labels are not stable identities. Embedding mode needs speaker_embedding; global IDs must be stable on the server. References send 2–8 second clips for up to four speakers.'
                            )}
                        </p>
                        <label className='live-field'>
                            {L('附加参数（JSON）', 'Extra parameters (JSON)')}
                            <textarea
                                aria-label={L('附加参数（JSON）', 'Extra parameters (JSON)')}
                                value={config.extra}
                                disabled={editingDisabled}
                                spellCheck={false}
                                onChange={(e) => update('extra', e.target.value)}
                            />
                        </label>
                        <div className='live-action-bar'>
                            <Button
                                size='sm'
                                color='primary'
                                onPress={saveSettings}
                                isDisabled={editingDisabled}
                            >
                                {L('保存 STT 配置', 'Save STT settings')}
                            </Button>
                            <Button
                                size='sm'
                                variant='flat'
                                onPress={testModel}
                                isLoading={testingStt}
                                isDisabled={editingDisabled}
                            >
                                {L(testingStt ? '测试中…' : '测试模型', testingStt ? 'Testing…' : 'Test model')}
                            </Button>
                            <Button
                                size='sm'
                                variant='light'
                                isDisabled={editingDisabled}
                                onPress={() =>
                                    setConfig({
                                        ...DEFAULT_STT,
                                        endpoint: 'https://api.openai.com/v1/audio/transcriptions',
                                        model: 'gpt-4o-transcribe-diarize',
                                        speakerMode: 'local',
                                        references: true,
                                        extra: '{"chunking_strategy":"auto"}',
                                    })
                                }
                            >
                                {L('填入兼容说话人分离示例', 'Fill diarization example')}
                            </Button>
                        </div>
                        <p className='live-help'>
                            {L(
                                '测试使用当前填写的配置发送一段内置英文合成语音，不录音、不调用翻译服务，也不会自动保存配置；接口可能收取一次转写费用。',
                                'Tests the current settings with a built-in synthetic English clip. No recording, translation or automatic saving. Your provider may charge for one transcription.'
                            )}
                        </p>
                        {sttTestResult && (
                            <div
                                className='live-messages'
                                role={sttTestResult.kind === 'error' ? 'alert' : 'status'}
                                aria-label={L('STT 模型测试结果', 'STT model test result')}
                            >
                                <p
                                    className={
                                        sttTestResult.kind === 'error'
                                            ? 'text-danger'
                                            : sttTestResult.kind === 'warning'
                                              ? 'text-warning-600'
                                              : 'text-success-600'
                                    }
                                >
                                    {sttTestResult.kind === 'error'
                                        ? `${L('测试失败', 'Test failed')}：${sttTestResult.message}`
                                        : `${L(sttTestResult.kind === 'success' ? '接口测试成功' : '接口已连通，但未识别出测试语音', sttTestResult.kind === 'success' ? 'Endpoint test passed' : 'Connected, but no test speech was recognized')} · ${sttTestResult.seconds.toFixed(2)}s`}
                                </p>
                                {sttTestResult.text && (
                                    <p>
                                        {L('转写结果', 'Transcript')}：{sttTestResult.text}
                                    </p>
                                )}
                                {sttTestResult.kind !== 'error' && (
                                    <p className='live-help'>
                                        {L('测试语音内容', 'Test phrase')}: This is a speech recognition test.
                                        {sttTestResult.speakerCount > 0
                                            ? L(' 已返回说话人标签。', ' Speaker labels returned.')
                                            : L(' 未返回说话人标签。', ' No speaker labels returned.')}
                                        {L(
                                            ' 单人短音频不能验证多人分离效果。',
                                            ' A single-speaker clip cannot verify multi-speaker diarization.'
                                        )}
                                    </p>
                                )}
                            </div>
                        )}
                    </CardBody>
                </Card>
            )}
            <p className='live-help'>
                {L(
                    '音频只在点击开始或导入后处理，发送至你配置的 STT 接口；转写文本发送至所选翻译服务。未配置接口不会开始采集。延迟取决于分段长度及服务速度。',
                    'Audio is processed only after Start or Import, sent to your configured STT endpoint; text goes to the selected translator. Latency depends on chunk length and service speed.'
                )}
            </p>
            {(error || warning || notice) && (
                <div className='live-messages'>
                    {error && <p role='alert'>{error}</p>}
                    {warning && <p className='text-warning-600'>{warning}</p>}
                    {notice && <p role='status'>{notice}</p>}
                    {engine.current && (failed > 0 || rows.some((r) => r.status === 'error')) && (
                        <button
                            onClick={() => {
                                try {
                                    validateStt(config);
                                    const service = translators.find((s) => s.key === translator);
                                    if (!service) throw new Error('请选择翻译服务。');
                                    engine.current.config = config;
                                    engine.current.registry.mode = config.speakerMode;
                                    engine.current.registry.threshold = Number(config.threshold);
                                    engine.current.transcribe = (part, references) =>
                                        transcribeLiveChunk(part, config, source, references);
                                    engine.current.translate = createLiveTranslator(service, source, target);
                                    engine.current.retry();
                                } catch (e) {
                                    setError(String(e));
                                }
                            }}
                        >
                            {L('重试失败片段', 'Retry failed segments')}
                        </button>
                    )}
                </div>
            )}

            <div className='live-transcript-heading'>
                <h3>{L('转写与译文', 'Transcript & translation')}</h3>
                <label className='live-check'>
                    <input
                        type='checkbox'
                        checked={autoScroll}
                        onChange={(e) => setAutoScroll(e.target.checked)}
                    />
                    {L('自动滚动', 'Auto-scroll')}
                </label>
            </div>
            {speakers.length > 0 && (
                <div className='live-speakers'>
                    {speakers.map((id) => (
                        <label key={id}>
                            <span>{`${L('讲话人', 'Speaker')} ${id.split('_').at(-1)}`}</span>
                            <input
                                aria-label={`${L('重命名讲话人', 'Rename speaker')} ${id.split('_').at(-1)}`}
                                value={names[id] ?? ''}
                                placeholder={L('重命名', 'Rename')}
                                onChange={(e) => setNames((old) => ({ ...old, [id]: e.target.value }))}
                            />
                        </label>
                    ))}
                </div>
            )}
            <div
                className='live-transcript'
                role='region'
                aria-label={L('同声传译记录', 'Interpretation transcript')}
            >
                {!rows.length && (
                    <div className='live-empty'>
                        <span>◉</span>
                        <p>
                            {L(
                                '开始聆听，原文和译文将显示在这里',
                                'Start listening to see the transcript and translation here'
                            )}
                        </p>
                        <small>
                            {L('每条记录包含时间戳及说话人信息', 'Each utterance includes a timestamp and speaker')}
                        </small>
                    </div>
                )}
                {rows.map((row) => (
                    <article
                        key={row.id}
                        className={`live-utterance ${audio.current && !audio.current.paused && playbackTime >= row.start && playbackTime < row.end ? 'playing' : ''}`}
                    >
                        <div className='live-utterance-meta'>
                            <button
                                disabled={!audioUrl}
                                onClick={() => {
                                    audio.current.currentTime = row.start;
                                    audio.current.play().catch((e) => setError(String(e)));
                                }}
                            >
                                {formatTime(row.start)}
                            </button>
                            <span
                                className={`live-speaker-color color-${row.speaker ? Number(row.speaker.split('_').at(-1)) % 6 : 0}`}
                            >
                                {rowSpeaker(row)}
                            </span>
                        </div>
                        <div className='live-utterance-text'>
                            <p>{row.text}</p>
                            <p className='live-translation'>
                                {row.translation || (row.status === 'pending' ? L('正在翻译…', 'Translating…') : '')}
                            </p>
                            {row.error && <p className='text-danger text-xs'>{row.error}</p>}
                        </div>
                    </article>
                ))}
                <div ref={transcriptEnd} />
            </div>
            <div className='live-exports'>
                {['txt', 'srt', 'json'].map((format) => (
                    <Button
                        key={format}
                        size='sm'
                        variant='light'
                        isDisabled={!rows.length}
                        onPress={() => exportFile(format)}
                    >
                        {L('导出', 'Export')} {format.toUpperCase()}
                    </Button>
                ))}
                <Button
                    size='sm'
                    variant='light'
                    isDisabled={!audioUrl || active}
                    onPress={() => exportFile('wav')}
                >
                    {L('保存音频', 'Save audio')}
                </Button>
            </div>
        </div>
    );
}
