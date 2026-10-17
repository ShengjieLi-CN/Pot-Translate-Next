import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { writeText } from '@tauri-apps/api/clipboard';
import { useTranslation } from 'react-i18next';
import { store } from '../../utils/store';
import { selectionBlocks, selectionTextStyle } from '../../utils/selection_translation.mjs';
import { loadSelectionTranslators, translateSelection } from '../../services/selection_translation';
import './style.css';

export default function SelectionTranslate() {
    const { i18n } = useTranslation();
    const L = (cn, en) => (i18n.language.startsWith('zh') ? cn : en);
    const [selection, setSelection] = useState(null);
    const [blocks, setBlocks] = useState([]);
    const [status, setStatus] = useState('idle');
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);
    const [copied, setCopied] = useState(false);
    const [opening, setOpening] = useState(false);
    const current = useRef(0);
    const selectedId = useRef(null);

    useEffect(() => {
        let disposed = false,
            eventSeen = false;
        const accept = (value) => {
            if (!disposed) {
                current.current++;
                selectedId.current = value?.id ?? null;
                setSelection(value);
                setBlocks([]);
                setError('');
                setCopied(false);
                setOpening(false);
                setStatus('idle');
            }
        };
        const unlisten = listen('selection_changed', ({ payload }) => {
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
        if (selection?.mode !== 'result') return;
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
            const key = await store.get('selection_translate_service');
            const service = services.find((s) => s.key === key) || services[0];
            if (!service)
                throw new Error(
                    L('请先在服务设置中启用文本翻译服务。', 'Enable a text translation service in Settings first.')
                );
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
    }, [selection, retry]);

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
            <main
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
