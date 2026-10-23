import { useEffect, useState } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/tauri';
import { useTheme } from 'next-themes';
import { useConfig } from '../hooks';

const windows = ['config', 'translate', 'recognize', 'updater', 'image_translate'];

export default function WindowMaterial() {
    const [material] = useConfig('window_material', 'none');
    const { resolvedTheme } = useTheme();
    const [error, setError] = useState('');
    useEffect(() => {
        if (material === null || !windows.includes(appWindow.label)) return;
        let disposed = false;
        const selected = ['none', 'mica', 'acrylic', 'liquid'].includes(material) ? material : 'none';
        // Keep an opaque surface until native backdrop setup succeeds.
        document.documentElement.dataset.windowMaterial = 'none';
        setError('');
        invoke('set_window_material', { material: selected, dark: resolvedTheme === 'dark' })
            .then(() => {
                if (!disposed) document.documentElement.dataset.windowMaterial = selected;
            })
            .catch((reason) => {
                if (!disposed) setError(String(reason));
            });
        return () => {
            disposed = true;
        };
    }, [material, resolvedTheme]);
    return error ? (
        <div
            className='window-material-error'
            role='status'
        >
            {error}
        </div>
    ) : null;
}
