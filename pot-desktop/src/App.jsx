// Tauri 窗口 API，用于获取当前窗口并执行关闭、开发者工具等窗口操作。
import { appWindow } from '@tauri-apps/api/window';
// React Router 路由组件；应用中的窗口通过该组件承载对应页面。
import { BrowserRouter } from 'react-router-dom';
// 国际化 Hook，用于读取或切换界面语言。
import { useTranslation } from 'react-i18next';
// Tauri 日志插件，用于记录主题检测等运行时警告。
import { warn } from 'tauri-plugin-log-api';
import React, { useEffect } from 'react';
// 主题状态管理 Hook，用于在浅色和深色主题之间切换。
import { useTheme } from 'next-themes';

// Tauri 命令调用 API，用于执行 Rust 端的自定义命令。
import { invoke } from '@tauri-apps/api/tauri';
// 各业务窗口组件：截图、划词翻译、主翻译、文字识别和更新窗口等。
import Screenshot from './window/Screenshot';
import ImageTranslate from './window/Screenshot/ImageTranslate';
import SelectionTranslate from './window/SelectionTranslate';
import Translate from './window/Translate';
import Recognize from './window/Recognize';
import Updater from './window/Updater';
// 配置持久化存储与窗口外观组件。
import { store } from './utils/store';
import Config from './window/Config';
import WindowMaterial from './components/WindowMaterial';
// 配置读取 Hook，用于获取持久化设置。
import { useConfig } from './hooks';
import './style.css';
import './i18n';

// 判断当前窗口是否为划词翻译窗口，以决定是否允许按 Escape 关闭窗口。
const isSelectionWindow = appWindow.label === 'selection_translate';

// 根据窗口名称映射其对应的 React 页面组件。
const windowMap = {
    translate: <Translate />,
    selection_translate: <SelectionTranslate />,
    screenshot: <Screenshot />,
    image_translate: <ImageTranslate />,
    recognize: <Recognize />,
    config: <Config />,
    updater: <Updater />,
};

export default function App() {
    // 开发者模式：启用后允许部分浏览器快捷键并提供开发者工具入口。
    const [devMode] = useConfig('dev_mode', false);
    // 应用主题：支持浅色、深色或跟随系统。
    const [appTheme] = useConfig('app_theme', 'system');
    // 应用语言配置；界面当前固定使用简体中文。
    const [appLanguage] = useConfig('app_language', 'zh_cn');
    // 首选字体和后备字体配置。
    const [appFont] = useConfig('app_font', 'default');
    const [appFallbackFont] = useConfig('app_fallback_font', 'default');
    // 根元素字体大小，单位为像素。
    const [appFontSize] = useConfig('app_font_size', 16);
    const { setTheme } = useTheme();
    const { i18n } = useTranslation();

    // 初始化持久化配置存储。
    useEffect(() => {
        store.load();
    }, []);

    // 根据开发者模式注册全局键盘事件：
    // 允许复制、粘贴、剪切、全选和撤销/重做；开发模式下拦截其他 Ctrl 快捷键，
    // 同时屏蔽功能键，并允许非划词窗口在按 Escape 时关闭。
    useEffect(() => {
        if (devMode !== null && devMode) {
            document.addEventListener('keydown', async (e) => {
                let allowKeys = ['c', 'v', 'x', 'a', 'z', 'y'];
                if (e.ctrlKey && !allowKeys.includes(e.key.toLowerCase())) {
                    e.preventDefault();
                }
                if (e.key === 'F12') {
                    await invoke('open_devtools');
                }
                if (e.key.startsWith('F') && e.key.length > 1) {
                    e.preventDefault();
                }
                if (e.key === 'Escape' && !isSelectionWindow) {
                    await appWindow.close();
                }
            });
        } else {
            document.addEventListener('keydown', async (e) => {
                let allowKeys = ['c', 'v', 'x', 'a', 'z', 'y'];
                if (e.ctrlKey && !allowKeys.includes(e.key.toLowerCase())) {
                    e.preventDefault();
                }
                if (e.key.startsWith('F') && e.key.length > 1) {
                    e.preventDefault();
                }
                if (e.key === 'Escape' && !isSelectionWindow) {
                    await appWindow.close();
                }
            });
        }
    }, [devMode]);

    // 同步应用主题：
    // - 固定主题直接应用；
    // - 系统主题读取系统配色，并监听系统配色变化。
    useEffect(() => {
        if (appTheme !== null) {
            if (appTheme !== 'system') {
                setTheme(appTheme);
            } else {
                try {
                    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                        setTheme('dark');
                    } else {
                        setTheme('light');
                    }
                    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                        if (e.matches) {
                            setTheme('dark');
                        } else {
                            setTheme('light');
                        }
                    });
                } catch {
                    warn("Can't detect system theme.");
                }
            }
        }
    }, [appTheme]);

    // 将界面国际化语言固定切换为简体中文。
    useEffect(() => {
        if (appLanguage !== null) {
            i18n.changeLanguage('zh_cn');
        }
    }, [appLanguage]);

    // 将首选字体和后备字体应用到整个文档，并同步根元素字体大小。
    useEffect(() => {
        if (appFont !== null && appFallbackFont !== null) {
            const fontFamily = (font) => (font === 'default' ? 'sans-serif' : JSON.stringify(font));
            document.documentElement.style.fontFamily = `${fontFamily(appFont)},${fontFamily(appFallbackFont)},sans-serif`;
        }
        if (appFontSize !== null) {
            document.documentElement.style.fontSize = `${appFontSize}px`;
        }
    }, [appFont, appFallbackFont, appFontSize]);

    return (
        <>
            {/* 渲染窗口的通用背景、圆角或其他材料效果。 */}
            <WindowMaterial />
            {/* 划词窗口始终加载划词翻译组件；其他窗口根据窗口名称选择页面。 */}
            <BrowserRouter>{isSelectionWindow ? <SelectionTranslate /> : windowMap[appWindow.label]}</BrowserRouter>
        </>
    );
}
