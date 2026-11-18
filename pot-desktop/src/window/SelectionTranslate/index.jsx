import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow, currentMonitor } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/api/clipboard';
import { useTranslation } from 'react-i18next';
import { store } from '../../utils/store';
import { useConfig } from '../../hooks/useConfig';
import { selectionBlocks, selectionTextStyle } from '../../utils/selection_translation.mjs';
import { loadSelectionTranslators, translateSelection } from '../../services/selection_translation';
import { RiPushpinLine, RiPushpinFill, RiVolumeUpLine, RiStopFill } from 'react-icons/ri';
import { synthesizeSelection } from '../../services/selection_speech';
import { createSpeechPlayer } from '../../utils/speech.mjs';
import './style.css';

export default function SelectionTranslate() {
    const { i18n, t } = useTranslation();
    const L = (cn, en) => (i18n.language.startsWith('zh') ? cn : en);
    const [selection, setSelection] = useState(null);
    const [blocks, setBlocks] = useState([]);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [copied, setCopied] = useState(false);
    const [opening, setOpening] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [pinBusy, setPinBusy] = useState(false);
    const [speechState, setSpeechState] = useState('idle');
    const [speechError, setSpeechError] = useState('');
    const [speechNotice, setSpeechNotice] = useState('');
    const [speechPlayer] = useState(() => createSpeechPlayer());
    const [serviceName, setServiceName] = useState('');
    const [opacity] = useConfig('selection_window_opacity', 100);
    const [savedServiceKey, setSavedServiceKey] = useConfig('selection_translate_service', '');
    const [serviceKey, setServiceKey] = useState(null);
    const [serviceOptions, setServiceOptions] = useState([]);
    const [activeService, setActiveService] = useState('');
    const serviceLabel = (service) => service.config?.instanceName || (service.plugin ? service.title : t(`services.${service.name}.title`, { defaultValue: service.title || service.name }));
    const current = useRef(0);
    const contentRef = useRef(null);

    // Remember the default for future windows without retranslating other open results.
    useEffect(() => {
        if (serviceKey === null && savedServiceKey !== null) setServiceKey(savedServiceKey);
    }, [savedServiceKey, serviceKey]);

    const stopSpeech = () => speechPlayer.stop();
    useEffect(() => {
        setSpeechError('');
        setSpeechNotice('');
        stopSpeech();
        return stopSpeech;
    }, [selection?.id, selection?.mode]);

    const readOriginal = async () => {
        if (speechState !== 'idle') { stopSpeech(); return; }
        const text = selectionBlocks(selection?.runs).map((block) => block.text).join('\n\n').trim();
        if (!text) return;
        setSpeechError('');
        setSpeechNotice('');
        try {
            await speechPlayer.play(
                isCurrent => synthesizeSelection(text, isCurrent, (title, fallback) => {
                    if (isCurrent()) setSpeechNotice(`${fallback ? '已切换至' : '朗读服务：'}${title}`);
                }),
                { onState: setSpeechState }
            );
        } catch (error) {
            setSpeechError(`原文朗读失败：${error.message}`);
        }
    };

    const selectedId = useRef(null);

    useEffect(() => {
        if (selection?.mode !== 'result') return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const monitor = await currentMonitor();
                if (cancelled || selectedId.current !== selection.id) return;
                const content = contentRef.current;
                if (!content) return;
                const dpi = monitor?.scaleFactor || window.devicePixelRatio || 1;
                const availableWidth = monitor ? monitor.size.width / dpi : screen.availWidth;
                const availableHeight = monitor ? monitor.size.height / dpi : screen.availHeight;
                const maxWidth = Math.max(40, availableWidth - 32);
                const maxHeight = Math.max(40, availableHeight - 96);
                // Grow vertically first, then widen long translations. Preserve a
                // user's larger window, and leave very long content scrollable.
                let width = Math.min(maxWidth, Math.max(300, window.innerWidth));
                const widthLimit = Math.min(maxWidth, Math.max(480, width));
                const heightLimit = Math.min(maxHeight, Math.max(640, window.innerHeight));
                const chromeHeight = content.parentElement.clientHeight - content.clientHeight + 2;
                const copy = content.cloneNode(true);
                copy.setAttribute('aria-hidden', 'true');
                Object.assign(copy.style, { position: 'fixed', left: '-10000px', top: '0',
                    height: 'auto', minHeight: '0', maxHeight: 'none', flex: 'none',
                    overflow: 'visible', boxSizing: 'border-box', visibility: 'hidden' });
                content.parentElement.appendChild(copy);
                let height;
                try {
                    do {
                        copy.style.width = `${Math.max(1, width - 2)}px`;
                        height = Math.ceil(copy.getBoundingClientRect().height) + chromeHeight;
                        if (height <= heightLimit || width >= widthLimit) break;
                        width = Math.min(widthLimit, width + 40);
                    } while (true);
                } finally { copy.remove(); }
                height = Math.min(heightLimit, Math.max(400, window.innerHeight, height));
                if (!cancelled && (Math.abs(width - window.innerWidth) > 1 || Math.abs(height - window.innerHeight) > 1)) {
                    await invoke('selection_resize', { id: selection.id, width, height });
                }
            } catch { /* A closed window or unavailable monitor must not interrupt translation. */ }
        }, 120);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [selection, blocks, status, error, speechError, speechNotice, serviceName]);


    useEffect(() => {
        let disposed = false,
            eventSeen = false;
        const accept = (value) => {
            if (!disposed) {
                current.current++;
                if (selectedId.current !== (value?.id ?? null)) setPinned(false);
                selectedId.current = value?.id ?? null;
                setSelection(value);
                setBlocks([]);
                setError('');
                setCopied(false);
                setOpening(false);
                setStatus('idle');
                setServiceName('');
            }
        };
        const unlisten = appWindow.listen('selection_changed', ({ payload }) => {
            eventSeen = true;
            accept(payload);
        });
        unlisten
            .then(() => invoke('selection_payload'))
            .then((payload) => {
                if (!eventSeen) accept(payload);
            })
            .catch((e) => {
                if (!disposed) setError(String(e));
            });
        return () => {
            disposed = true;
            current.current++;
            unlisten.then((fn) => fn());
        };
    }, []);

    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                invoke('selection_dismiss').catch(() => {});
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
        if (selection?.mode !== 'result' || serviceKey === null) return;
        const revision = ++current.current;
        const isCurrent = () => current.current === revision;
        setStatus('loading');
        setError('');
        setCopied(false);
        const source = selectionBlocks(selection.runs);
        // No source text is placed in the result DOM, including while loading or on failure.
        setBlocks(source.map(({ text, ...block }) => ({ ...block, translation: '' })));
        const run = async () => {
            if (selection.captureError) throw new Error(selection.captureError);
            if (!source.length) throw new Error(L('请先选中需要翻译的文字。', 'Select text to translate first.'));
            const keys = (await store.get('translate_service_list')) || ['deepl', 'bing', 'lingva', 'yandex', 'google'];
            const services = await loadSelectionTranslators(keys);
            if (!isCurrent()) return;
            setServiceOptions(services);
            const service = services.find((s) => s.key === serviceKey) || services[0];
            if (!service)
                throw new Error(
                    L('请先在服务设置中启用文本翻译服务。', 'Enable a text translation service in Settings first.')
                );
            if (!isCurrent()) return;
            setServiceName(serviceLabel(service));
            setActiveService(service.key);
            const target =
                (await store.get('selection_target_language')) ||
                (await store.get('translate_target_language')) ||
                'zh_cn';
            await translateSelection(source, service, target, isCurrent, (id, translation) =>
                setBlocks((old) => old.map((b) => (b.id === id ? { ...b, translation } : b)))
            );
            if (isCurrent()) setStatus('done');
        };
        run().catch((e) => {
            if (isCurrent()) {
                setStatus('error');
                setError(String(e));
            }
        });
        return () => {
            current.current++;
        };
    }, [selection, retry, serviceKey]);

    const dismiss = () => invoke('selection_dismiss');
    const open = async () => {
        if (opening || selection.mode === 'capturing') return;
        const id = selection.id;
        setOpening(true);
        setError('');
        try {
            await invoke('selection_open', { id });
        } catch (e) {
            if (selectedId.current === id) setError(String(e));
        } finally {
            if (selectedId.current === id) setOpening(false);
        }
    };
    if (!selection) return null;
    if (selection.mode === 'badge')
        return (
            <button
                className='selection-badge'
                aria-label={L('翻译选中文字', 'Translate selection')}
                onClick={open}
                disabled={opening}
                title={error || L('翻译选中文字', 'Translate selection')}
            >
                {opening ? '…' : '译'}
            </button>
        );
    return (
        <section
            className='selection-result-window'
            style={{ '--selection-opacity': Math.max(35, Math.min(100, opacity ?? 100)) / 100 }}
            aria-label={L('划词译文', 'Selection translation')}
        >
            <header className='selection-toolbar'>
                <div
                    className='selection-drag'
                    data-tauri-drag-region
                >
                    {L('划词翻译', 'Selection translation')}
                </div>
                <button
                    aria-label={speechState === 'idle' ? '朗读选中原文' : '停止朗读'}
                    title={speechState === 'loading' ? '正在合成原文语音，点击取消' : speechState === 'playing' ? '停止朗读' : '朗读选中原文'}
                    aria-pressed={speechState !== 'idle'}
                    disabled={selection.mode !== 'result' || !selection.runs?.some((run) => run.text?.trim())}
                    onClick={readOriginal}
                >
                    {speechState === 'loading' ? '…' : speechState === 'playing' ? <RiStopFill aria-hidden size={16} /> : <RiVolumeUpLine aria-hidden size={16} />}
                </button>
                <button
                    aria-label={pinned ? '取消窗口置顶' : '窗口置顶'}
                    title={pinned ? '取消窗口置顶' : '窗口置顶'}
                    aria-pressed={pinned}
                    disabled={pinBusy || selection.mode !== 'result'}
                    onClick={async () => {
                        const id = selection.id;
                        setPinBusy(true);
                        try {
                            await invoke('selection_set_pinned', { id, pinned: !pinned });
                            if (selectedId.current === id) setPinned(!pinned);
                        } catch (e) {
                            if (selectedId.current === id) setError(String(e));
                        } finally { setPinBusy(false); }
                    }}
                >
                    {pinned ? <RiPushpinFill aria-hidden size={16} /> : <RiPushpinLine aria-hidden size={16} />}
                </button>
                <button
                    aria-label={L('复制译文', 'Copy translation')}
                    disabled={selection.mode !== 'result' || status !== 'done'}
                    onClick={async () => {
                        try {
                            await writeText(blocks.map((b) => b.translation).join('\n\n'));
                            setCopied(true);
                        } catch (e) {
                            setError(String(e));
                        }
                    }}
                >
                    {copied ? L('已复制', 'Copied') : L('复制', 'Copy')}
                </button>
                <button
                    aria-label={L('关闭划词翻译', 'Close selection translation')}
                    onClick={dismiss}
                >
                    ×
                </button>
            </header>
            <div className='selection-options'>
                <label className='selection-service'>翻译服务
                    <select aria-label='当前翻译服务' title={serviceName} value={activeService}
                        disabled={selection.mode !== 'result' || !serviceOptions.length}
                        onChange={(event) => {
                            setServiceKey(event.target.value);
                            setSavedServiceKey(event.target.value);
                        }}>
                        {!serviceOptions.length && <option value=''>{selection.mode === 'capturing' ? '正在取词' : '正在加载服务'}</option>}
                        {serviceOptions.map((service) => <option key={service.key} value={service.key}>{serviceLabel(service)}</option>)}
                    </select>
                </label>
            </div>
            <main
                ref={contentRef}
                className='selection-content'
                aria-busy={selection.mode === 'capturing' || status === 'loading'}
            >
                {(selection.mode === 'capturing' || status === 'loading') && (
                    <p
                        className='selection-status'
                        role='status'
                    >
                        {selection.mode === 'capturing'
                            ? L('正在读取选中文字…', 'Reading selected text…')
                            : L('正在翻译…', 'Translating…')}
                    </p>
                )}
                <article
                    className='selection-translations'
                    aria-label={L('译文内容', 'Translated content')}
                >
                    {blocks
                        .filter((b) => b.translation)
                        .map((block) => {
                            const Tag = block.kind === 'heading' ? 'h3' : 'p';
                            return (
                                <Tag
                                    key={block.id}
                                    className={`selection-paragraph ${block.kind}`}
                                    style={selectionTextStyle(block.style)}
                                >
                                    {block.translation}
                                </Tag>
                            );
                        })}
                </article>
                {speechNotice && <p role='status' className='text-xs opacity-70'>{speechNotice}</p>}
                {speechError && <p className='selection-error' role='alert'>{speechError}</p>}
                {error && (
                    <div className='selection-error'>
                        <p role='alert'>{error}</p>
                        {status === 'error' && (
                            <button
                                disabled={opening}
                                onClick={() => (selection.captureError ? open() : setRetry((n) => n + 1))}
                            >
                                {L(opening ? '正在取词…' : '重试', opening ? 'Reading…' : 'Retry')}
                            </button>
                        )}
                    </div>
                )}
            </main>
        </section>
    );
}
