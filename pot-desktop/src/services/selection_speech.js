import { invoke } from '@tauri-apps/api/tauri';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import { store } from '../utils/store';
import { getServiceName, whetherPluginService } from '../utils/service_instance';
import { invoke_plugin } from '../utils/invoke_plugin';
import { synthesizeSpeechChunks } from '../utils/speech.mjs';

export async function* synthesizeSpeech(text, { language, isCurrent = () => true, onService } = {}) {
    const keys = (await store.get('tts_service_list')) ?? [];
    const detected = language || (await invoke('lang_detect', { text }));
    if (!isCurrent()) return;
    const available = [];
    for (const key of keys) {
        const config = (await store.get(key)) || {};
        if (!isCurrent()) return;
        if (config.enable === false) continue;
        const name = getServiceName(key);
        if (!whetherPluginService(key)) continue;
        const service = {
            title: config.instanceName || name,
            load: async () => {
                const info = JSON.parse(
                    await readTextFile(`plugins/tts/${name}/info.json`, { dir: BaseDirectory.AppConfig })
                );
                if (!info) throw new Error('语音合成服务不可用，请在服务设置中检查。');
                service.title = config.instanceName || info.display || info.title || name;
                const languages = info.language;
                if (!languages || !(detected in languages)) throw new Error('当前服务不支持原文语言。');
                const [tts, utils] = await invoke_plugin('tts', name);
                return {
                    title: service.title,
                    synthesize: (chunk) => tts(chunk, languages[detected], { config, utils, isCurrent }),
                };
            },
        };
        available.push(service);
    }
    yield* synthesizeSpeechChunks(text, available, { isCurrent, onService });
}

export function synthesizeSelection(text, isCurrent, onService) {
    return synthesizeSpeech(text, { isCurrent, onService });
}
