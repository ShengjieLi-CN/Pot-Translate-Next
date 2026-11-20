import React, { useEffect, useState, useRef } from 'react';
import { Button, Progress } from '@nextui-org/react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

export default function RapidOcrPanel({ onReady }) {
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
        invoke('rapidocr_status')
            .then((value) => {
                if (!mounted) return;
                setStatus(value);
                setBusy(Boolean(value?.installing));
                notify(value);
            })
            .catch((error) => {
                if (mounted) setError(String(error));
            });
        const unlisten = listen('rapidocr-progress', ({ payload }) => {
            if (!mounted) return;
            setProgress(payload);
            // Handles an installation started in another application window.
            invoke('rapidocr_status')
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
                invoke('rapidocr_status')
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
        setProgress({ detail: '准备下载 RapidOCR 运行环境和模型', percent: 0 });
        try {
            await invoke('rapidocr_install');
            const next = await invoke('rapidocr_status');
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
            aria-label='RapidOCR 本地引擎'
        >
            <p className='text-sm'>
                {status?.ready
                    ? 'RapidOCR 已就绪 · 本地 CPU 识别'
                    : '首次需下载独立运行环境和 OCR 模型；安装完成后可断网识别。'}
            </p>
            <p className='text-xs text-default-500'>
                无需 API Key 或自行安装 Python。请预留 1 GB 空间，图片只在本机识别。翻译文字仍由所选翻译服务处理。
            </p>
            <Button
                size='sm'
                variant='flat'
                isLoading={busy}
                isDisabled={busy}
                onPress={install}
            >
                {busy ? '安装中…' : status?.ready ? '重新安装 / 修复 RapidOCR' : '下载并安装 RapidOCR'}
            </Button>
            {busy && (
                <Progress
                    aria-label='RapidOCR 下载进度'
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
