import { appWindow } from '@tauri-apps/api/window';
import React, { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Button } from '@nextui-org/react';
import { BsPinFill } from 'react-icons/bs';

import WindowControl from '../../components/WindowControl';
import { useConfig } from '../../hooks';
import ControlArea from './ControlArea';
import ImageArea from './ImageArea';
import TextArea from './TextArea';

let blurTimeout = null;

const listenBlur = () => {
    return listen('tauri://blur', () => {
        if (appWindow.label === 'recognize') {
            if (blurTimeout) {
                clearTimeout(blurTimeout);
            }
            // 50ms后关闭窗口，因为在 windows 下拖动窗口时会先切换成 blur 再立即切换成 focus
            // 如果直接关闭将导致窗口无法拖动
            blurTimeout = setTimeout(async () => {
                await appWindow.close();
            }, 50);
        }
    });
};

let unlisten = listenBlur();
// 取消 blur 监听
const unlistenBlur = () => {
    unlisten.then((f) => {
        f();
    });
};

// 监听 focus 事件取消 blurTimeout 时间之内的关闭窗口
void listen('tauri://focus', () => {
    if (blurTimeout) {
        clearTimeout(blurTimeout);
    }
});

export default function Recognize() {
    const [closeOnBlur] = useConfig('recognize_close_on_blur', false);
    const [pined, setPined] = useState(false);
    // 是否自动关闭窗口
    useEffect(() => {
        if (closeOnBlur !== null && !closeOnBlur) {
            unlistenBlur();
        }
    }, [closeOnBlur]);

    return (
        <div className='bg-background h-screen'>
            <div
                data-tauri-drag-region='true'
                className='fixed top-[5px] left-[5px] right-[5px] h-[30px]'
            />
            <div className='h-[35px] flex justify-between'>
                <Button
                    isIconOnly
                    size='sm'
                    variant='flat'
                    disableAnimation
                    className='my-auto mx-[5px] bg-transparent'
                    onPress={() => {
                        if (pined) {
                            if (closeOnBlur) {
                                unlisten = listenBlur();
                            }
                            appWindow.setAlwaysOnTop(false);
                        } else {
                            unlistenBlur();
                            appWindow.setAlwaysOnTop(true);
                        }
                        setPined(!pined);
                    }}
                >
                    <BsPinFill className={`text-[20px] ${pined ? 'text-primary' : 'text-default-400'}`} />
                </Button>
                <WindowControl />
            </div>
            <div className='h-[calc(100vh-85px)] grid grid-cols-2'>
                <ImageArea />
                <TextArea />
            </div>
            <div className='h-[50px]'>
                <ControlArea />
            </div>
        </div>
    );
}
