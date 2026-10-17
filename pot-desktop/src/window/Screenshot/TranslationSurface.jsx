import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { writeText } from '@tauri-apps/api/clipboard';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import { useTranslation } from 'react-i18next';
import { useConfig } from '../../hooks';
import { store } from '../../utils/store';
import { getServiceName, whetherPluginService } from '../../utils/service_instance';
import { invoke_plugin } from '../../utils/invoke_plugin';
import * as recognizeServices from '../../services/recognize';
import * as translateServices from '../../services/translate';
import detect from '../../utils/lang_detect';
import {
    detectScreenshotDomain,
    screenshotBlocks,
    screenshotServiceConfig,
    translateScreenshotBlocks,
} from '../../utils/screenshot_translation.mjs';
import './style.css';

const defaultTranslations = ['deepl', 'bing', 'lingva', 'yandex', 'google', 'ecdict'];
const promptServices = ['openai', 'ollama', 'chatglm', 'geminipro'];
const dictionaries = ['ecdict', 'bing_dict', 'cambridge_dict'];

async function loadService(type, key) {
    const name = getServiceName(key);
    const config = (await store.get(key)) ?? {};
    if (config.enable === false) return null;
    if (whetherPluginService(key)) {
        const info = JSON.parse(
            await readTextFile(`plugins/${type}/${name}/info.json`, { dir: BaseDirectory.AppConfig })
        );
        return {
            key,
            name,
            config,
            Language: info.language,
            title: config.instanceName || info.display || name,
            plugin: true,
        };
    }
    const service = (type === 'translate' ? translateServices : recognizeServices)[name];
    if (!service || (type === 'translate' && dictionaries.includes(name))) return null;
    return { ...service, key, name, config };
}

function FittedBlock({ block, width, height, scale }) {
    const ref = useRef(null);
    useLayoutEffect(() => {
        const node = ref.current;
        if (!node) return;
        const fit = () => {
            let size = Math.max(
                10,
                Math.min(
                    28,
                    (block.box.height * scale) / Math.max(1, block.text.length / Math.max(8, block.box.width / 8))
                )
            );
            node.style.fontSize = `${size}px`;
            while (
                size > 10 &&
                (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
            ) {
                size -= 0.5;
                node.style.fontSize = `${size}px`;
            }
        };
        fit();
        const observer = new ResizeObserver(fit);
        observer.observe(node);
        return () => observer.disconnect();
    }, [block, scale]);
    const Tag = block.kind === 'heading' ? 'h3' : 'p';
    return (
        <Tag
            ref={ref}
            className={`screenshot-block ${block.kind}`}
            tabIndex={0}
            style={{
                left: `${(100 * block.box.x) / width}%`,
                top: `${(100 * block.box.y) / height}%`,
                width: `${(100 * block.box.width) / width}%`,
                height: `${(100 * block.box.height) / height}%`,
            }}
        >
            {block.translation || block.text}
        </Tag>
    );
}

export default function TranslationSurface({ capture, onRecapture, onClose, floating = false }) {
    const { t } = useTranslation();
    const [translateKeys] = useConfig('translate_service_list', defaultTranslations);
    const [recognizeKeys] = useConfig('recognize_service_list', ['system', 'tesseract']);
    const [recognizeLanguage] = useConfig('recognize_language', 'auto');
    const [target, setTarget] = useConfig('screenshot_target_language', 'zh_cn');
    const [source, setSource] = useState('auto');
    const [services, setServices] = useState(null);
    const [translator, setTranslator] = useState('');
    const [recognizer, setRecognizer] = useState('');
    const [blocks, setBlocks] = useState([]);
    const [domain, setDomain] = useState('general');
    const [original, setOriginal] = useState(false);
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [resourceRetry, setResourceRetry] = useState(0);
    const revision = useRef(0);
    const ocrCache = useRef(null);
    const surfaceRef = useRef(null);
    const controlsRef = useRef(null);
    const [controlsPosition, setControlsPosition] = useState({ left: 12, top: 12 });
    const [scale, setScale] = useState(1);

    useEffect(() => {
        if (!translateKeys || !recognizeKeys) return;
        let disposed = false;
        const load = async () => {
            const failures = [];
            const loadList = async (type, keys) =>
                (
                    await Promise.all(
                        keys.map(async (key) => {
                            try {
                                return await loadService(type, key);
                            } catch (e) {
                                failures.push(`${key}: ${String(e)}`);
                                return null;
                            }
                        })
                    )
                ).filter(Boolean);
            const [translate, recognize] = await Promise.all([
                loadList('translate', translateKeys),
                loadList('recognize', recognizeKeys),
            ]);
            const [savedTranslator, savedRecognizer] = await Promise.all([
                store.get('screenshot_translate_service'),
                store.get('screenshot_recognize_service'),
            ]);
            if (disposed) return;
            setServices({ translate, recognize });
            setTranslator(
                (old) =>
                    translate.find((s) => s.key === old || s.key === savedTranslator)?.key ||
                    translate.find((s) => promptServices.includes(s.name))?.key ||
                    translate[0]?.key ||
                    ''
            );
            setRecognizer(
                (old) =>
                    recognize.find((s) => s.key === old || s.key === savedRecognizer)?.key || recognize[0]?.key || ''
            );
            setNotice(failures.join('\n'));
        };
        load().catch((e) => {
            if (!disposed) {
                setError(String(e));
                setStatus('error');
            }
        });
        return () => {
            disposed = true;
        };
    }, [translateKeys, recognizeKeys, resourceRetry]);

    useEffect(() => {
        if (!services || !capture || !target || recognizeLanguage === null) return;
        const current = ++revision.current;
        const isCurrent = () => revision.current === current;
        setError('');
        setBlocks([]);
        setOriginal(false);
        if (!translator || !recognizer) {
            setStatus('empty');
            return;
        }
        const run = async () => {
            const ocr = services.recognize.find((s) => s.key === recognizer);
            const service = services.translate.find((s) => s.key === translator);
            if (!ocr || !service) return;
            const ocrLanguage = source === 'auto' ? recognizeLanguage : source;
            if (!(ocrLanguage in ocr.Language)) throw new Error(t('screenshot.unsupported_ocr'));
            const cacheKey = `${capture.id}:${recognizer}:${ocrLanguage}`;
            let recognized = ocrCache.current?.key === cacheKey ? ocrCache.current.blocks : null;
            if (!recognized) {
                setStatus('recognizing');
                let result;
                if (ocr.plugin) {
                    const [func, utils] = await invoke_plugin('recognize', ocr.name);
                    if (!isCurrent()) return;
                    result = await func(capture.base64, ocr.Language[ocrLanguage], { config: ocr.config, utils });
                } else {
                    result = await (ocr.recognizeLayout || ocr.recognize)(capture.base64, ocr.Language[ocrLanguage], {
                        config: ocr.config,
                    });
                }
                if (!isCurrent()) return;
                recognized = screenshotBlocks(result, capture.width, capture.height);
                ocrCache.current = { key: cacheKey, blocks: recognized };
            }
            if (!recognized.length) throw new Error(t('screenshot.no_text'));
            const context = recognized.map((b) => b.text).join('\n\n');
            setDomain(detectScreenshotDomain(context));
            setBlocks(recognized);
            setStatus('translating');
            let from = source;
            if (from === 'auto') {
                try {
                    from = await detect(context);
                } catch {
                    from = /[\u4e00-\u9fff]/.test(context) ? 'zh_cn' : 'en';
                }
            }
            if (!isCurrent()) return;
            if (!(from in service.Language) || !(target in service.Language))
                throw new Error(t('screenshot.unsupported_language'));
            let func = service.translate,
                utils;
            if (service.plugin) [func, utils] = await invoke_plugin('translate', service.name);
            if (!isCurrent()) return;
            const config = screenshotServiceConfig(service.name, service.config, context);
            await translateScreenshotBlocks(
                recognized,
                (text, setResult) =>
                    from === target
                        ? Promise.resolve(text)
                        : func(text, service.Language[from], service.Language[target], {
                              config,
                              utils,
                              detect: from,
                              setResult,
                          }),
                {
                    isCurrent,
                    onUpdate: (translated) => setBlocks([...translated, ...recognized.slice(translated.length)]),
                }
            );
            if (isCurrent()) setStatus('done');
        };
        run().catch((e) => {
            if (isCurrent()) {
                setError(String(e));
                setStatus('error');
            }
        });
        return () => {
            revision.current++;
        };
    }, [capture, services, recognizer, translator, target, source, recognizeLanguage, t]);

    useEffect(() => {
        const node = surfaceRef.current;
        if (!node) return;
        const observer = new ResizeObserver(() => setScale(node.clientWidth / capture.width));
        observer.observe(node);
        return () => observer.disconnect();
    }, [capture]);

    useLayoutEffect(() => {
        if (!floating || !surfaceRef.current || !controlsRef.current) return;
        const position = () => {
            const rect = surfaceRef.current.getBoundingClientRect();
            const controls = controlsRef.current.getBoundingClientRect();
            const below = rect.bottom + 10;
            const top =
                below + controls.height < window.innerHeight - 12
                    ? below
                    : Math.max(12, rect.top - controls.height - 10);
            const left = Math.max(12, Math.min(rect.right - controls.width, window.innerWidth - controls.width - 12));
            setControlsPosition((old) => (old.top === top && old.left === left ? old : { top, left }));
        };
        const observer = new ResizeObserver(position);
        observer.observe(controlsRef.current);
        observer.observe(surfaceRef.current);
        window.addEventListener('resize', position);
        position();
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', position);
        };
    }, [floating, capture]);

    const remember = async (key, value) => {
        try {
            await store.set(key, value);
            await store.save();
        } catch (e) {
            setNotice(String(e));
        }
    };

    const select = (label, value, items, onChange) => (
        <label className='screenshot-select'>
            <span className='sr-only'>{label}</span>
            <select
                aria-label={label}
                value={value}
                onChange={(e) => {
                    revision.current++;
                    onChange(e.target.value);
                }}
            >
                {items.map(([key, title]) => (
                    <option
                        key={key}
                        value={key}
                    >
                        {title}
                    </option>
                ))}
            </select>
        </label>
    );
    const languageKeys = services?.translate.find((s) => s.key === translator)?.Language || { zh_cn: '', en: '' };
    const languages = Object.keys(languageKeys)
        .filter((k) => k !== 'auto')
        .map((key) => [key, t(`languages.${key}`)]);
    const serviceName = (s, type) =>
        s.config.instanceName || s.title || t(`services.${type}.${s.name}.title`, { defaultValue: s.name });
    const busy = ['loading', 'recognizing', 'translating'].includes(status);
    const hasTranslation = blocks.some((b) => b.translation);
    return (
        <div className={`screenshot-translation ${floating ? 'floating' : ''}`}>
            <div
                ref={surfaceRef}
                className='screenshot-result'
                style={{ aspectRatio: `${capture.width}/${capture.height}` }}
                aria-busy={busy}
            >
                <img
                    className='screenshot-original'
                    src={`data:image/png;base64,${capture.base64}`}
                    alt={t('screenshot.original')}
                    draggable={false}
                />
                {!original && blocks.length > 0 && (
                    <div className={`screenshot-paper ${blocks.every((b) => b.box) ? '' : 'text-only'}`}>
                        {blocks.map((block) =>
                            block.box ? (
                                <FittedBlock
                                    key={block.id}
                                    block={block}
                                    width={capture.width}
                                    height={capture.height}
                                    scale={scale}
                                />
                            ) : (
                                <div
                                    key={block.id}
                                    className={block.kind}
                                >
                                    {block.translation || block.text}
                                </div>
                            )
                        )}
                    </div>
                )}
                {busy && !blocks.length && (
                    <div
                        className='screenshot-busy'
                        role='status'
                    >
                        {t(`screenshot.${status}`)}
                    </div>
                )}
            </div>
            <div
                ref={controlsRef}
                className='screenshot-controls'
                style={floating ? controlsPosition : undefined}
            >
                <div
                    className='screenshot-toolbar'
                    aria-label={t('screenshot.title')}
                >
                    {select(
                        t('screenshot.source_language'),
                        source,
                        [['auto', t('languages.auto')], ...languages],
                        setSource
                    )}
                    <span aria-hidden>→</span>
                    {select(t('screenshot.target_language'), target || 'zh_cn', languages, setTarget)}
                    {services &&
                        select(
                            t('screenshot.translation_service'),
                            translator,
                            services.translate.map((s) => [s.key, serviceName(s, 'translate')]),
                            (key) => {
                                setTranslator(key);
                                remember('screenshot_translate_service', key);
                            }
                        )}
                    {services &&
                        select(
                            t('screenshot.ocr_service'),
                            recognizer,
                            services.recognize.map((s) => [s.key, serviceName(s, 'recognize')]),
                            (key) => {
                                ocrCache.current = null;
                                setRecognizer(key);
                                remember('screenshot_recognize_service', key);
                            }
                        )}
                    <button
                        onClick={() => setOriginal(!original)}
                        aria-pressed={original}
                    >
                        {t(original ? 'screenshot.show_translation' : 'screenshot.show_original')}
                    </button>
                    <button
                        disabled={!hasTranslation}
                        onClick={async () => {
                            try {
                                await writeText(
                                    blocks
                                        .map((b) => b.translation || '')
                                        .filter(Boolean)
                                        .join('\n\n')
                                );
                                setNotice(t('screenshot.copied'));
                            } catch (e) {
                                setNotice(String(e));
                            }
                        }}
                    >
                        {t('screenshot.copy')}
                    </button>
                    <button
                        onClick={() => {
                            revision.current++;
                            ocrCache.current = null;
                            setServices(null);
                            setStatus('loading');
                            setResourceRetry((n) => n + 1);
                        }}
                    >
                        {t('screenshot.retry')}
                    </button>
                    {onRecapture && (
                        <button
                            onClick={() => {
                                revision.current++;
                                onRecapture();
                            }}
                        >
                            {t('screenshot.recapture')}
                        </button>
                    )}
                    <button
                        onClick={() => {
                            revision.current++;
                            onClose();
                        }}
                    >
                        {t('screenshot.close')}
                    </button>
                </div>
                <div
                    className='screenshot-status'
                    role='status'
                >
                    {error ? (
                        <p role='alert'>{error}</p>
                    ) : status === 'empty' ? (
                        <p>{t('screenshot.no_service')}</p>
                    ) : (
                        <span>
                            {t(`screenshot.${status}`)}
                            {blocks.length > 0 &&
                                ` · ${t(`screenshot.domains.${domain}`)} · ${blocks.filter((b) => b.translation).length}/${blocks.length}`}
                        </span>
                    )}
                    {!promptServices.includes(getServiceName(translator)) && <p>{t('screenshot.standard_hint')}</p>}
                    {notice && <p>{notice}</p>}
                </div>
            </div>
        </div>
    );
}
