import { useTranslation } from 'react-i18next';
import { CardBody } from '@nextui-org/react';
import { Switch } from '@nextui-org/react';
import { Card } from '@nextui-org/react';
import React from 'react';
import { Select, SelectItem } from '@nextui-org/react';

import RapidOcrPanel from '../../../../components/RapidOcrPanel';
import { DEFAULT_RAPID_CONFIG } from '../../../../utils/ocr_provider.mjs';
import { useConfig } from '../../../../hooks';

export default function Recognize() {
    const [rapidConfig, setRapidConfig] = useConfig('rapid_ocr', DEFAULT_RAPID_CONFIG);
    const [deleteNewline, setDeleteNewline] = useConfig('recognize_delete_newline', false);
    const [autoCopy, setAutoCopy] = useConfig('recognize_auto_copy', false);
    const [hideWindow, setHideWindow] = useConfig('recognize_hide_window', false);
    const [closeOnBlur, setCloseOnBlur] = useConfig('recognize_close_on_blur', false);
    const { t } = useTranslation();
    return (
        <Card className='mb-[10px]'>
            <CardBody>
                <h2 className='text-lg font-semibold mb-3'>RapidOCR</h2>
                <p className='text-sm text-default-500 mb-3'>
                    使用 RapidOCR 3.10.0 / PP-OCRv6 轻量模型，支持中英文截图识别。模型随引擎安装，无需配置密钥。
                </p>
                <RapidOcrPanel />
                {rapidConfig !== null && (
                    <Select
                        label='CPU 线程数'
                        aria-label='RapidOCR CPU 线程数'
                        className='my-4'
                        disallowEmptySelection
                        selectedKeys={[String(rapidConfig.threads ?? 2)]}
                        onChange={(e) => e.target.value && setRapidConfig({ threads: Number(e.target.value) })}
                    >
                        {[1, 2, 4, 8].map((threads) => (
                            <SelectItem
                                key={String(threads)}
                            >{`${threads} 线程${threads === 2 ? '（默认）' : ''}`}</SelectItem>
                        ))}
                    </Select>
                )}
                <div className='config-item'>
                    <h3 className='my-auto mx-0'>{t('config.recognize.delete_newline')}</h3>
                    {deleteNewline !== null && (
                        <Switch
                            isSelected={deleteNewline}
                            onValueChange={(v) => {
                                setDeleteNewline(v);
                            }}
                        />
                    )}
                </div>
                <div className='config-item'>
                    <h3 className='my-auto mx-0'>{t('config.recognize.auto_copy')}</h3>
                    {autoCopy !== null && (
                        <Switch
                            isSelected={autoCopy}
                            onValueChange={(v) => {
                                setAutoCopy(v);
                            }}
                        />
                    )}
                </div>
                <div className='config-item'>
                    <h3 className='my-auto mx-0'>{t('config.recognize.close_on_blur')}</h3>
                    {closeOnBlur !== null && (
                        <Switch
                            isSelected={closeOnBlur}
                            onValueChange={(v) => {
                                setCloseOnBlur(v);
                            }}
                        />
                    )}
                </div>
                <div className='config-item'>
                    <h3 className='my-auto mx-0'>{t('config.recognize.hide_window')}</h3>
                    {hideWindow !== null && (
                        <Switch
                            isSelected={hideWindow}
                            onValueChange={(v) => {
                                setHideWindow(v);
                            }}
                        />
                    )}
                </div>
            </CardBody>
        </Card>
    );
}
