import React from 'react';
import { Button, Select, SelectItem } from '@nextui-org/react';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { activeSentenceAtom, bilingualDirectionAtom, bilingualModeAtom } from '../../alignment';

export default function BilingualControls() {
    const [enabled, setEnabled] = useAtom(bilingualModeAtom);
    const [direction, setDirection] = useAtom(bilingualDirectionAtom);
    const setActive = useSetAtom(activeSentenceAtom);
    const { t } = useTranslation();

    return (
        <div className='mb-2 rounded-[10px] bg-content1 p-2'>
            <div className='flex flex-wrap items-center gap-2'>
                <div
                    role='group'
                    aria-label={t('bilingual.mode')}
                    className='flex gap-1'
                >
                    {[true, false].map((value) => (
                        <Button
                            key={String(value)}
                            size='sm'
                            color={enabled === value ? 'primary' : 'default'}
                            variant={enabled === value ? 'flat' : 'light'}
                            aria-pressed={enabled === value}
                            onPress={() => {
                                setActive(null);
                                setEnabled(value);
                            }}
                        >
                            {t(value ? 'bilingual.title' : 'bilingual.standard')}
                        </Button>
                    ))}
                </div>
                {enabled && (
                    <Select
                        size='sm'
                        aria-label={t('bilingual.direction')}
                        className='min-w-[160px] flex-1'
                        selectedKeys={[direction]}
                        disallowEmptySelection
                        onChange={(event) => {
                            if (!event.target.value) return;
                            setActive(null);
                            setDirection(event.target.value);
                        }}
                    >
                        <SelectItem key='auto'>{t('bilingual.auto')}</SelectItem>
                        <SelectItem key='en'>{t('bilingual.en_zh')}</SelectItem>
                        <SelectItem key='zh_cn'>{t('bilingual.zh_en')}</SelectItem>
                    </Select>
                )}
            </div>
            {enabled && <p className='mt-2 text-xs text-default-500'>{t('bilingual.hint')}</p>}
        </div>
    );
}
