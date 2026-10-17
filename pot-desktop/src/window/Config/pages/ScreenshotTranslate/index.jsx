import React, { useState } from 'react';
import { Button, Card, CardBody } from '@nextui-org/react';
import { invoke } from '@tauri-apps/api/tauri';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export default function ScreenshotTranslate() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [error, setError] = useState('');
    return (
        <Card
            shadow='none'
            className='bg-content1 rounded-[10px]'
        >
            <CardBody className='gap-5 p-6'>
                <h2 className='text-xl font-semibold'>{t('screenshot.title')}</h2>
                <p className='text-default-500'>{t('screenshot.description')}</p>
                <div className='flex gap-3 flex-wrap'>
                    <Button
                        color='primary'
                        onPress={() => invoke('start_screenshot_translate').catch((e) => setError(String(e)))}
                    >
                        {t('screenshot.start')}
                    </Button>
                    <Button
                        variant='flat'
                        onPress={() => navigate('/hotkey')}
                    >
                        {t('screenshot.configure_hotkey')}
                    </Button>
                    <Button
                        variant='light'
                        onPress={() => navigate('/service')}
                    >
                        {t('screenshot.configure_services')}
                    </Button>
                </div>
                <p>{t('screenshot.rules')}</p>
                <p className='text-sm text-default-500'>{t('screenshot.service_hint')}</p>
                {error && (
                    <p
                        role='alert'
                        className='text-danger'
                    >
                        {error}
                    </p>
                )}
            </CardBody>
        </Card>
    );
}
