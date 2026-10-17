import { invoke } from '@tauri-apps/api/tauri';
import { invoke_plugin } from '../utils/invoke_plugin';
import { selectionResult, selectionServiceConfig } from '../utils/selection_translation.mjs';
export { loadLiveTranslators as loadSelectionTranslators } from './live_interpretation';

export async function translateSelection(blocks, service, target, isCurrent, update) {
    const context = blocks.map((b) => b.text).join('\n\n');
    // Selection stays local until the user clicks the badge or invokes the shortcut.
    const from = await invoke('lang_detect', { text: context });
    if (!isCurrent()) return;
    if (!(from in service.Language) || !(target in service.Language))
        throw new Error('当前翻译服务不支持此语言方向，请在划词翻译设置中切换服务或目标语言。');
    let func = service.translate,
        utils;
    if (service.plugin) [func, utils] = await invoke_plugin('translate', service.name);
    if (!isCurrent()) return;
    const config = selectionServiceConfig(service.name, service.config);
    // Preserve source paragraphs instead of splitting the translation into sentences.
    for (const block of blocks) {
        if (!isCurrent()) return;
        const show = (value) => {
            if (isCurrent()) update(block.id, selectionResult(value));
        };
        const value =
            from === target
                ? block.text
                : await func(block.text, service.Language[from], service.Language[target], {
                      config,
                      utils,
                      detect: from,
                      setResult: show,
                  });
        if (!isCurrent()) return;
        show(value);
        if (!selectionResult(value)) throw new Error('翻译服务返回了空译文，请重试或切换服务。');
    }
}
