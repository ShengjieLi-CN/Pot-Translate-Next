import { invoke } from '@tauri-apps/api/tauri';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import { store } from '../utils/store';
import { getServiceName, whetherPluginService } from '../utils/service_instance';
import { invoke_plugin } from '../utils/invoke_plugin';
import * as services from './tts';

export async function synthesizeSelection(text, isCurrent) {
    const keys = (await store.get('tts_service_list')) ?? ['lingva_tts'];
    for (const key of keys) {
        const config = (await store.get(key)) || {};
        if (!isCurrent()) return;
        if (config.enable === false) continue;
        const name = getServiceName(key);
        const plugin = whetherPluginService(key);
        const info = plugin
            ? JSON.parse(await readTextFile(`plugins/tts/${name}/info.json`, { dir: BaseDirectory.AppConfig }))
            : services[name];
        if (!info) throw new Error('语音合成服务不可用，请在服务设置中检查。');
        const language = plugin ? info.language : info.Language;
        const detected = await invoke('lang_detect', { text });
        if (!isCurrent()) return;
        if (!language || !(detected in language)) throw new Error('当前语音合成服务不支持原文语言，请在服务设置中切换。');
        const [tts, utils] = plugin ? await invoke_plugin('tts', name) : [info.tts, undefined];
        if (!isCurrent()) return;
        const data = await tts(text, language[detected], { config, utils });
        if (!isCurrent()) return;
        if (!data?.length) throw new Error('语音合成服务未返回音频，请重试或检查服务配置。');
        return data;
    }
    throw new Error('请先在服务设置中启用语音合成服务。');
}
