import { invoke } from '@tauri-apps/api/tauri';

export async function translate(text, from, to) {
    if (!['zh', 'en'].includes(to)) throw new Error('LibreTranslate 离线版仅支持中译英和英译中。');
    const source = from === 'auto' ? (/[\u3400-\u9fff\uf900-\ufaff]/u.test(text) ? 'zh' : 'en') : from;
    if (!['zh', 'en'].includes(source)) throw new Error('LibreTranslate 离线版仅支持中译英和英译中。');
    if (source === to) return text;
    return invoke('libretranslate_translate', { text, source, target: to });
}
export * from './Config';
export * from './info';
