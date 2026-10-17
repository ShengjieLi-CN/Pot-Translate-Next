import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import WindowControl from '../../components/WindowControl';
import TranslationSurface from './TranslationSurface';

export default function ImageTranslate() {
    const { t } = useTranslation();
    const [capture, setCapture] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let disposed = false,
            revision = 0;
        const load = async () => {
            const id = ++revision;
            try {
                setError('');
                setCapture(null);
                const base64 = await invoke('get_base64');
                if (!base64) throw new Error(t('screenshot.capture_failed'));
                const image = new Image();
                image.src = `data:image/png;base64,${base64}`;
                await image.decode();
                if (!disposed && id === revision)
                    setCapture({ id: Date.now(), base64, width: image.naturalWidth, height: image.naturalHeight });
            } catch (e) {
                if (!disposed && id === revision) setError(String(e));
            }
        };
        const unlisten = listen('new_image', load);
        load();
        appWindow.show();
        return () => {
            disposed = true;
            unlisten.then((fn) => fn());
        };
    }, [t]);
    return (
        <>
            <div className='h-[36px] flex justify-between bg-background'>
                <div
                    className='flex-1 px-3 py-1'
                    data-tauri-drag-region
                >
                    {t('screenshot.title')}
                </div>
                <WindowControl />
            </div>
            <div className='screenshot-image-window'>
                {error && (
                    <p
                        role='alert'
                        className='text-red-300'
                    >
                        {error}
                    </p>
                )}
                {capture && (
                    <TranslationSurface
                        key={capture.id}
                        capture={capture}
                        onRecapture={() => invoke('start_screenshot_translate')}
                        onClose={() => appWindow.close()}
                    />
                )}
            </div>
        </>
    );
}
