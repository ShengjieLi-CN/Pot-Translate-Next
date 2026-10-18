import { invoke } from '@tauri-apps/api/tauri';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import { store } from '../utils/store';
import { getServiceName, whetherPluginService } from '../utils/service_instance';
import { invoke_plugin } from '../utils/invoke_plugin';
import * as services from './translate';
import { bytesBase64, encodeWav, normalizeTranscript, validateStt } from '../utils/live_interpretation.mjs';
import sttTestAudio from '../assets/stt-test.wav?url';

const excluded = ['ecdict', 'bing_dict', 'cambridge_dict'];

export async function loadLiveTranslators(keys) {
    const result = [];
    for (const key of keys) {
        const config = (await store.get(key)) || {},
            name = getServiceName(key);
        if (excluded.includes(name) || config.enable === false) continue;
        try {
            if (whetherPluginService(key)) {
                const info = JSON.parse(
                    await readTextFile(`plugins/translate/${name}/info.json`, { dir: BaseDirectory.AppConfig })
                );
                result.push({
                    key,
                    name,
                    config,
                    Language: info.language,
                    title: config.instanceName || info.display || name,
                    plugin: true,
                });
            } else if (services[name])
                result.push({ ...services[name], name, key, config, title: config.instanceName || name });
        } catch {
            /* A broken plugin does not hide healthy built-in services. */
        }
    }
    return result;
}

const sttLanguages = { zh_cn: 'zh', zh_tw: 'zh', pt_pt: 'pt', pt_br: 'pt', en: 'en', ja: 'ja', ko: 'ko', auto: 'auto' };

export async function transcribeLiveChunk(chunk, config, source, references = []) {
    return requestTranscription(encodeWav(chunk.pcm, chunk.sampleRate), config, source, references);
}

async function requestTranscription(audio, config, source, references = []) {
    validateStt(config);
    return invoke('live_transcribe', {
        config: {
            provider: config.provider || 'custom',
            diarization: Boolean(config.diarization),
            endpoint: config.endpoint.trim(),
            apiKey: config.apiKey,
            model: config.model.trim(),
            responseFormat: config.diarization
                ? config.responseFormat
                : config.responseFormat === 'diarized_json'
                  ? 'json'
                  : config.responseFormat,
            extra: config.extra || '{}',
        },
        audio: bytesBase64(audio),
        language: sttLanguages[source] || source.split('_')[0],
        references,
    });
}

export async function testSttModel(config) {
    validateStt(config);
    const sample = await window.fetch(sttTestAudio);
    if (!sample.ok) throw new Error('无法加载内置 STT 测试音频。');
    const audio = new Uint8Array(await sample.arrayBuffer());
    const started = performance.now();
    // An offline synthesized English phrase, never microphone or system audio.
    const response = await requestTranscription(audio, config, 'en');
    const segments = normalizeTranscript(response, 2.745);
    return {
        seconds: (performance.now() - started) / 1000,
        text: segments.map((segment) => segment.text).join(' '),
        speakerCount: new Set(segments.map((segment) => segment.speaker).filter((speaker) => speaker != null)).size,
    };
}

export function createLiveTranslator(service, source, target) {
    return async (text, language, setResult) => {
        let from = source;
        if (from === 'auto') {
            const map = { zh: 'zh_cn', 'zh-CN': 'zh_cn', 'zh-TW': 'zh_tw', pt: 'pt_pt' };
            from = map[language] || language;
            if (!from || !(from in service.Language)) from = await invoke('lang_detect', { text });
        }
        if (from === target) return text;
        if (!(from in service.Language) || !(target in service.Language))
            throw new Error('当前翻译服务不支持所选语言方向。');
        let translate = service.translate,
            utils;
        if (service.plugin) [translate, utils] = await invoke_plugin('translate', service.name);
        return translate(text, service.Language[from], service.Language[target], {
            config: service.config,
            utils,
            detect: from,
            setResult,
        });
    };
}
