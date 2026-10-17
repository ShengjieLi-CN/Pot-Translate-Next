import React, { useEffect, useRef, useState } from 'react';
import { currentMonitor, appWindow } from '@tauri-apps/api/window';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { appCacheDir, join } from '@tauri-apps/api/path';
import { useTranslation } from 'react-i18next';
import TranslationSurface from './TranslationSurface';
import { screenshotSelection } from '../../utils/screenshot_translation.mjs';

export default function Screenshot() {
    const { t } = useTranslation();
    const [imgurl, setImgurl] = useState('');
    const [translate, setTranslate] = useState(false);
    const [selection, setSelection] = useState(null);
    const [capture, setCapture] = useState(null);
    const [error, setError] = useState('');
    const start = useRef(null);
    const image = useRef(null);
    const working = useRef(false);
    const mounted = useRef(true);

    const loadScreenshot = async () => {
        setError('');
        setCapture(null);
        setSelection(null);
        start.current = null;
        working.current = true;
        try {
            await appWindow.hide();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const monitor = await currentMonitor();
            if (!monitor) throw new Error(t('screenshot.capture_failed'));
            await invoke('screenshot', { x: monitor.position.x, y: monitor.position.y });
            const path = await join(await appCacheDir(), 'pot_screenshot.png');
            if (mounted.current) setImgurl(`${convertFileSrc(path)}?capture=${Date.now()}`);
        } catch (e) {
            if (mounted.current) {
                setError(String(e));
                await appWindow.show();
            }
        } finally {
            working.current = false;
        }
    };

    useEffect(() => {
        mounted.current = true;
        invoke('screenshot_translate_mode')
            .then((value) => {
                if (mounted.current) setTranslate(value);
            })
            .catch((e) => setError(String(e)));
        loadScreenshot();
        return () => {
            mounted.current = false;
        };
    }, []);

    const region = (end) =>
        screenshotSelection(
            start.current,
            end,
            { width: window.innerWidth, height: window.innerHeight },
            { width: image.current.naturalWidth, height: image.current.naturalHeight }
        );

    const finish = async (event) => {
        if (!start.current || working.current || event.button !== 0) return;
        const area = region({ x: event.clientX, y: event.clientY });
        start.current = null;
        if (area.rect.width < 4 || area.rect.height < 4) {
            setSelection(null);
            return;
        }
        setSelection(area.rect);
        setError('');
        working.current = true;
        try {
            await invoke('cut_image', area.crop);
            if (translate) {
                const base64 = await invoke('get_base64');
                if (!base64) throw new Error(t('screenshot.capture_failed'));
                setCapture({ id: Date.now(), base64, width: area.crop.width, height: area.crop.height });
            } else {
                await appWindow.hide();
                await appWindow.emit('success');
                await appWindow.close();
            }
        } catch (e) {
            setError(String(e));
        } finally {
            working.current = false;
        }
    };

    return (
        <div
            className='fixed inset-0 select-none'
            onContextMenu={(e) => {
                e.preventDefault();
                appWindow.close();
            }}
        >
            {imgurl && (
                <img
                    ref={image}
                    src={imgurl}
                    alt=''
                    draggable={false}
                    className='fixed inset-0 w-full h-full'
                    onLoad={async () => {
                        await appWindow.show();
                        await appWindow.setFocus();
                        await appWindow.setResizable(false);
                    }}
                    onError={() => {
                        setError(t('screenshot.capture_failed'));
                        appWindow.show();
                    }}
                />
            )}
            <div className='fixed inset-0 bg-black/55' />
            {!capture && (
                <div
                    className='fixed inset-0 cursor-crosshair'
                    style={{ touchAction: 'none' }}
                    onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        if (working.current || !image.current?.naturalWidth) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        start.current = { x: e.clientX, y: e.clientY };
                        setSelection({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
                    }}
                    onPointerMove={(e) => {
                        if (start.current) setSelection(region({ x: e.clientX, y: e.clientY }).rect);
                    }}
                    onPointerUp={finish}
                    onPointerCancel={() => {
                        start.current = null;
                        setSelection(null);
                    }}
                />
            )}
            {selection && !capture && (
                <div
                    className='fixed pointer-events-none border-2 border-rose-400'
                    style={{
                        left: selection.x,
                        top: selection.y,
                        width: selection.width,
                        height: selection.height,
                        backgroundImage: `url("${imgurl}")`,
                        backgroundSize: `${window.innerWidth}px ${window.innerHeight}px`,
                        backgroundPosition: `-${selection.x}px -${selection.y}px`,
                    }}
                />
            )}
            {capture && (
                <div
                    className='screenshot-overlay-shell'
                    style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}
                >
                    <TranslationSurface
                        capture={capture}
                        floating
                        onRecapture={loadScreenshot}
                        onClose={() => appWindow.close()}
                    />
                </div>
            )}
            {(!selection || error) && (
                <div
                    className='screenshot-hint'
                    role={error ? 'alert' : 'status'}
                >
                    {error || t('screenshot.select_hint')}
                    {error && (
                        <button
                            className='ml-3 underline pointer-events-auto'
                            onClick={loadScreenshot}
                        >
                            {t('screenshot.retry')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
