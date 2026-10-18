import detect from '../../../utils/lang_detect';
import { osType } from '../../../utils/env';
import { invoke } from '@tauri-apps/api';
import { Language } from './info';
import { needsEnglishScreenshotFallback, recognizeEnglishScreenshot } from '../../../utils/screenshot_ocr.mjs';

export async function recognize(_, lang) {
    const linuxLangMap = {
        auto: 'auto',
        zh_cn: 'chi_sim',
        zh_tw: 'chi_tra',
        en: 'eng',
        yue: 'chi_sim',
        ja: 'jpn',
        ko: 'kor',
        fr: 'fra',
        es: 'spa',
        ru: 'rus',
        de: 'deu',
        it: 'ita',
        tr: 'tur',
        pt: 'por',
        pt_br: 'por',
        vi: 'vie',
        id: 'ind',
        th: 'tha',
        ms: 'msa',
        ar: 'ara',
        hi: 'hin',
        uk: 'ukr',
        he: 'heb',
    };
    const windowsLangMap = {
        auto: 'auto',
        zh_cn: 'zh-CN',
        zh_tw: 'zh-TW',
        en: 'en-US',
        yue: 'zh-HK',
        ja: 'ja-JP',
        ko: 'ko-KR',
        fr: 'fr-FR',
        es: 'es-ES',
        ru: 'ru-RU',
        de: 'de-DE',
        it: 'it-IT',
        tr: 'tr-TR',
        pt: 'pt-PT',
        pt_br: 'pt-BR',
        vi: 'vi-VN',
        id: 'id-ID',
        th: 'th-TH',
        ms: 'ms-MY',
        ar: 'ar-SA',
        hi: 'hi-IN',
        uk: 'uk-UA',
        he: 'he-IL',
    };
    const macOSLangMap = {
        auto: 'auto',
        zh_cn: 'zh-Hans',
        zh_tw: 'zh-Hant',
        en: 'en-US',
        yue: 'zh-Hans',
        ja: 'ja-JP',
        ko: 'ko-KR',
        fr: 'fr-FR',
        es: 'es-ES',
        ru: 'ru-RU',
        de: 'de-DE',
        it: 'it-IT',
        tr: 'tr-TR',
        pt: 'pt-PT',
        pt_br: 'pt-BR',
        vi: 'vi-VN',
        id: 'id-ID',
        th: 'th-TH',
        ms: 'ms-MY',
        ar: 'ar-SA',
        hi: 'hi-IN',
        uk: 'uk-UA',
        he: 'he-IL',
    };
    let result = '';
    switch (osType) {
        case 'Linux':
            result = await invoke('system_ocr', { lang: linuxLangMap[lang] });
            if (lang === Language.auto && (await detect(result)) === Language.zh_cn) {
                result = result.replaceAll(' ', '');
            } else {
                if (lang === Language.zh_cn || lang === Language.zh_tw) {
                    result = result.replaceAll(' ', '');
                }
            }
            return result.trim();
        case 'Darwin':
            result = await invoke('system_ocr', { lang: macOSLangMap[lang] });
            return result.trim();
        case 'Windows_NT':
            result = await invoke('system_ocr', { lang: windowsLangMap[lang] });
            if (lang === Language.auto && (await detect(result)) === Language.zh_cn) {
                result = result.replaceAll(' ', '');
            } else {
                if (lang === Language.zh_cn || lang === Language.zh_tw || lang === Language.ja) {
                    result = result.replaceAll(' ', '');
                }
            }
            return result.trim();
    }
}

export * from './Config';
export * from './info';

// The screenshot surface needs word geometry; regular OCR keeps its string API.
export async function recognizeLayout(base64, lang) {
    // Pass this capture's immutable pixels, rather than rereading a shared crop
    // which another screenshot/OCR window may already have overwritten.
    if (osType === 'Windows_NT') {
        const windowsLang =
            { zh_cn: 'zh-CN', zh_tw: 'zh-TW', yue: 'zh-HK', en: 'en-US', pt_br: 'pt-BR' }[lang] ||
            lang.replace('_', '-');
        let result;
        try {
            result = await invoke('system_ocr_layout', { lang: windowsLang, base64 });
        } catch (error) {
            if (!['auto', 'en', 'en-US'].includes(lang)) throw error;
            return recognizeEnglishScreenshot(base64);
        }
        if (needsEnglishScreenshotFallback(result) || (result.englishAvailable === false && !result.lines?.length)) {
            try {
                return await recognizeEnglishScreenshot(base64, result);
            } catch {
                return result;
            } // Keep usable native results if the worker fails.
        }
        return result;
    }
    return { text: await recognize(base64, lang) };
}
