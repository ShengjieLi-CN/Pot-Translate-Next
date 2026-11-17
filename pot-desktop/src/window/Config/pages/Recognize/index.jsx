import { useTranslation } from 'react-i18next';
import { CardBody } from '@nextui-org/react';
import { Switch } from '@nextui-org/react';
import { Card } from '@nextui-org/react';
import React from 'react';
import { Input, Select, SelectItem, Link } from '@nextui-org/react';
import { open } from '@tauri-apps/api/shell';
import { DEFAULT_PADDLE_CONFIG, PADDLE_MODELS } from '../../../../utils/paddle_ocr.mjs';

import { useConfig } from '../../../../hooks';

export default function Recognize() {
    const [paddleConfig, setPaddleConfig] = useConfig('paddle_ocr', DEFAULT_PADDLE_CONFIG);
    const [deleteNewline, setDeleteNewline] = useConfig('recognize_delete_newline', false);
    const [autoCopy, setAutoCopy] = useConfig('recognize_auto_copy', false);
    const [hideWindow, setHideWindow] = useConfig('recognize_hide_window', false);
    const [closeOnBlur, setCloseOnBlur] = useConfig('recognize_close_on_blur', false);
    const { t } = useTranslation();
    return (
        <Card className='mb-[10px]'>
            <CardBody>
                <h2 className='text-lg font-semibold mb-3'>Paddle OCR</h2>
                <p className='text-sm text-default-500 mb-4'>
                    所有图片识别与截图翻译统一使用 Paddle OCR 云端服务。图片将发送至官方服务识别，无需安装本地模型。
                </p>
                {paddleConfig !== null && (
                    <div className='flex flex-col gap-4 mb-5'>
                        <Select
                            label='OCR 模型'
                            aria-label='OCR 模型'
                            disallowEmptySelection
                            selectedKeys={[paddleConfig.model || DEFAULT_PADDLE_CONFIG.model]}
                            onChange={(e) =>
                                e.target.value && setPaddleConfig({ ...paddleConfig, model: e.target.value })
                            }
                        >
                            {PADDLE_MODELS.map((model) => (
                                <SelectItem key={model}>
                                    {model === 'PP-OCRv5' ? 'PP-OCRv5（截图推荐）' : model}
                                </SelectItem>
                            ))}
                        </Select>
                        <Input
                            label='API Key'
                            aria-label='Paddle OCR API Key'
                            type='password'
                            autoComplete='off'
                            placeholder='填写百度 AI Studio 访问令牌'
                            value={paddleConfig.apiKey || ''}
                            onValueChange={(apiKey) => setPaddleConfig({ ...paddleConfig, apiKey })}
                        />
                        <p className='text-sm text-default-500'>
                            截图推荐 PP-OCRv5；PP-OCRv5-latin
                            适用于拉丁语系。云端排队时间随模型和负载变化。设置自动保存。
                        </p>
                        <Link
                            as='button'
                            className='text-sm self-start'
                            onPress={() => open('https://aistudio.baidu.com/account/accessToken')}
                        >
                            获取 AI Studio 访问令牌
                        </Link>
                    </div>
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
