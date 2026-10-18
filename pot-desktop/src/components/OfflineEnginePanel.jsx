import React, { useEffect, useState, useRef } from 'react';
import { Button, Progress } from '@nextui-org/react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

export default function OfflineEnginePanel({ onReady }) {
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState({ detail: '', percent: 0 });
    const [error, setError] = useState('');
    const notified = useRef(false);
    const notify = (value) => {
        if (value?.ready && !notified.current) {
            notified.current = true;
            onReady?.();
        }
    };
    useEffect(() => {
        let mounted = true;
        invoke('libretranslate_status')
            .then((value) => {
                if (!mounted) return;
                setStatus(value);
                setBusy(Boolean(value?.installing));
                notify(value);
            })
            .catch((error) => {
                if (mounted) setError(String(error));
            });
        const unlisten = listen('libretranslate-progress', ({ payload }) => {
            if (!mounted) return;
            setProgress(payload);
            // Handles an installation started in another application window.
            invoke('libretranslate_status')
                .then((value) => {
                    if (!mounted) return;
                    setStatus(value);
                    setBusy(Boolean(value?.installing));
                    notify(value);
                })
                .catch(() => {});
        });
        return () => {
            mounted = false;
            unlisten.then((fn) => fn());
        };
    }, []);
    useEffect(() => {
        if (!busy) return;
        let mounted = true;
        const timer = setInterval(
            () =>
                invoke('libretranslate_status')
                    .then((value) => {
                        if (!mounted) return;
                        setStatus(value);
                        setBusy(Boolean(value?.installing));
                        notify(value);
                    })
                    .catch(() => {}),
            1500
        );
        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, [busy]);
    const install = async () => {
        setBusy(true);
        notified.current = false;
        setError('');
        setProgress({ detail: '准备下载独立运行环境和中英模型', percent: 0 });
        try {
            await invoke('libretranslate_install');
            const next = await invoke('libretranslate_status');
            setStatus(next);
            notify(next);
        } catch (error) {
            setError(String(error));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div
            className='space-y-2'
            aria-label='LibreTranslate 离线引擎'
        >
            <p className='text-sm'>
                {status?.ready
                    ? '离线引擎已就绪 · 中译英 / 英译中'
                    : '首次需下载独立运行环境和中英双向模型；下载完成后可断网使用。'}
            </p>
            <p className='text-xs text-default-500'>
                本地 CPU 推理，无需 API Key、Python 或 Docker。下载约数百 MB，请预留 1 GB 空间。翻译文本只在本机处理。
            </p>
            <Button
                size='sm'
                variant='flat'
                isLoading={busy}
                isDisabled={busy}
                onPress={install}
            >
                {busy ? '安装中…' : status?.ready ? '重新安装 / 修复离线引擎' : '下载并安装离线引擎'}
            </Button>
            {busy && (
                <Progress
                    aria-label='离线引擎下载进度'
                    size='sm'
                    label={progress.detail}
                    value={progress.percent || 0}
                />
            )}
            {error && (
                <p
                    role='alert'
                    className='text-sm text-danger'
                >
                    {error}
                </p>
            )}
        </div>
    );
}
