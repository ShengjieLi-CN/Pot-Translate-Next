import { Button } from '@nextui-org/react';
import { atom, useSetAtom, useAtomValue } from 'jotai';
import { fetch, Body } from '@tauri-apps/api/http';
import { useTranslation } from 'react-i18next';
import { HiTranslate } from 'react-icons/hi';
import { GiCycle } from 'react-icons/gi';
import React from 'react';
import { nanoid } from 'nanoid';
import { useConfig } from '../../../hooks';
import { OCR_LABELS, DEFAULT_OCR_PROVIDER } from '../../../utils/ocr_provider.mjs';
import { textAtom } from '../TextArea';

export const recognizeFlagAtom = atom();

export default function ControlArea() {
    const [provider] = useConfig('ocr_provider', DEFAULT_OCR_PROVIDER);
    const [serverPort] = useConfig('server_port', 60828);
    const setRecognizeFlag = useSetAtom(recognizeFlagAtom);
    const text = useAtomValue(textAtom);
    const { t } = useTranslation();
    return (
        <div className='flex justify-between px-[12px] h-full'>
            <span className='my-auto text-sm'>{OCR_LABELS[provider] || '文字识别'}</span>
            <Button
                variant='flat'
                color='secondary'
                size='sm'
                className='my-auto'
                startContent={<GiCycle className='text-[16px]' />}
                onPress={() => {
                    setRecognizeFlag(nanoid());
                }}
            >
                {t('recognize.recognize')}
            </Button>
            <Button
                variant='flat'
                color='primary'
                size='sm'
                className='my-auto'
                startContent={<HiTranslate className='text-[16px]' />}
                onPress={async () => {
                    if (text) {
                        void fetch(`http://127.0.0.1:${serverPort}/translate`, {
                            method: 'POST',
                            body: Body.text(text),
                            responseType: 2,
                        });
                    }
                }}
            >
                {t('recognize.translate')}
            </Button>
        </div>
    );
}
