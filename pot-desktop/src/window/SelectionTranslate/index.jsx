import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import './style.css';

export default function SelectionTranslate() {
    const [selection, setSelection] = useState(null);
    const [opening, setOpening] = useState(false);
    const [error, setError] = useState('');
    const selectedId = useRef(null);

    useEffect(() => {
        let disposed = false;
        let eventSeen = false;
        const accept = (payload) => {
            if (disposed) return;
            selectedId.current = payload?.id ?? null;
            setSelection(payload);
            setOpening(payload?.mode === 'capturing');
            setError(payload?.captureError || '');
        };
        const unlisten = appWindow.listen('selection_changed', ({ payload }) => {
            eventSeen = true;
            accept(payload);
        });
        unlisten.then(() => invoke('selection_payload')).then((payload) => {
            if (!eventSeen) accept(payload);
        }).catch((reason) => {
            if (!disposed) setError(String(reason));
        });
        const onKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                invoke('selection_dismiss').catch((reason) => setError(String(reason)));
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            disposed = true;
            unlisten.then((fn) => fn());
            window.removeEventListener('keydown', onKeyDown);
        };
    }, []);

    const open = async () => {
        if (opening || !selection) return;
        const id = selection.id;
        setOpening(true);
        setError('');
        try {
            await invoke('selection_open', { id });
        } catch (reason) {
            if (selectedId.current === id) setError(String(reason));
        } finally {
            if (selectedId.current === id) setOpening(false);
        }
    };

    if (!selection) return null;
    return (
        <button
            className='selection-badge'
            aria-label='翻译选中文字'
            onClick={open}
            disabled={opening}
            title={error || (opening ? '正在读取选中文字…' : '在翻译窗口打开选中文字')}
        >
            {opening ? '…' : error ? '!' : '译'}
        </button>
    );
}
