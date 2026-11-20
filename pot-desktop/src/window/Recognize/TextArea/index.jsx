import { Card, CardBody, CardFooter, Button, Skeleton, ButtonGroup, Tooltip } from '@nextui-org/react';
import { sendNotification } from '@tauri-apps/api/notification';
import { writeText } from '@tauri-apps/api/clipboard';
import { atom, useAtom, useAtomValue } from 'jotai';
import React, { useEffect, useState } from 'react';
import { CgSpaceBetween } from 'react-icons/cg';
import { MdContentCopy } from 'react-icons/md';
import { MdSmartButton } from 'react-icons/md';
import { useTranslation } from 'react-i18next';

import { recognizeFlagAtom } from '../ControlArea';
import { useConfig } from '../../../hooks';
import { recognize } from '../../../services/recognize';
import { useOcrConfig } from '../../../hooks/useOcrConfig';
import { base64Atom } from '../ImageArea';

export const textAtom = atom();

export default function TextArea() {
    const ocrSelection = useOcrConfig();
    const [autoCopy] = useConfig('recognize_auto_copy', false);
    const [deleteNewline] = useConfig('recognize_delete_newline', false);
    const [hideWindow] = useConfig('recognize_hide_window', false);
    const recognizeFlag = useAtomValue(recognizeFlagAtom);
    const base64 = useAtomValue(base64Atom);
    const [loading, setLoading] = useState(false);
    const [text, setText] = useAtom(textAtom);
    const [error, setError] = useState('');
    const { t } = useTranslation();

    useEffect(() => {
        let current = true;
        setText('');
        setError('');
        setLoading(false);
        if (base64 && ocrSelection !== null && autoCopy !== null && deleteNewline !== null && hideWindow !== null) {
            setLoading(true);
            recognize(base64, 'auto', { selection: ocrSelection, joinLines: deleteNewline, isCurrent: () => current })
                .then(async (text) => {
                    if (!current) return;
                    setText(text);
                    if (autoCopy && text) {
                        await writeText(text);
                        if (current && hideWindow) sendNotification({ title: t('common.write_clipboard'), body: text });
                    }
                })
                .catch((error) => {
                    if (current) setError(String(error));
                })
                .finally(() => {
                    if (current) setLoading(false);
                });
        }
        return () => {
            current = false;
        };
    }, [base64, ocrSelection, recognizeFlag, autoCopy, deleteNewline, hideWindow]);

    return (
        <Card
            shadow='none'
            className='bg-content1 h-full ml-[6px] mr-[12px]'
            radius='10'
        >
            <CardBody className='bg-content1 p-0 h-full'>
                {loading ? (
                    <div className='space-y-3 m-[12px]'>
                        <Skeleton className='w-3/5 rounded-lg'>
                            <div className='h-3 w-3/5 rounded-lg bg-default-200'></div>
                        </Skeleton>
                        <Skeleton className='w-4/5 rounded-lg'>
                            <div className='h-3 w-4/5 rounded-lg bg-default-200'></div>
                        </Skeleton>
                        <Skeleton className='w-2/5 rounded-lg'>
                            <div className='h-3 w-2/5 rounded-lg bg-default-300'></div>
                        </Skeleton>
                    </div>
                ) : (
                    <>
                        {text && (
                            <textarea
                                value={text}
                                className='bg-content1 h-full m-[12px] mb-0 resize-none focus:outline-none'
                                onChange={(e) => {
                                    setText(e.target.value);
                                }}
                            />
                        )}
                        {error && (
                            <textarea
                                value={error}
                                readOnly
                                className='bg-content1 h-full m-[12px] mb-0 resize-none focus:outline-none text-red-500'
                                onChange={(e) => {
                                    setText(e.target.value);
                                }}
                            />
                        )}
                    </>
                )}
            </CardBody>
            <CardFooter className='bg-content1 flex justify-start px-[12px]'>
                <ButtonGroup>
                    <Tooltip content={t('recognize.copy_text')}>
                        <Button
                            isIconOnly
                            size='sm'
                            variant='light'
                            onPress={() => {
                                writeText(text);
                            }}
                        >
                            <MdContentCopy className='text-[16px]' />
                        </Button>
                    </Tooltip>
                    <Tooltip content={t('recognize.delete_newline')}>
                        <Button
                            isIconOnly
                            variant='light'
                            size='sm'
                            onPress={() => {
                                setText(text.replace(/\-\s+/g, '').replace(/\s+/g, ' '));
                            }}
                        >
                            <MdSmartButton className='text-[16px]' />
                        </Button>
                    </Tooltip>
                    <Tooltip content={t('recognize.delete_space')}>
                        <Button
                            isIconOnly
                            variant='light'
                            size='sm'
                            onPress={() => {
                                setText(text.replaceAll(' ', ''));
                            }}
                        >
                            <CgSpaceBetween className='text-[16px]' />
                        </Button>
                    </Tooltip>
                </ButtonGroup>
            </CardFooter>
        </Card>
    );
}
