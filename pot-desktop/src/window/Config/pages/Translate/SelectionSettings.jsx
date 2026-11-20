import React, { useEffect, useState } from 'react';
import { Button, Card, CardBody, Switch } from '@nextui-org/react';
import { invoke } from '@tauri-apps/api/tauri';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function SelectionSettings() {
    const { i18n, t } = useTranslation();
    const L = (cn, en) => (i18n.language.startsWith('zh') ? cn : en);
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => {
        let disposed = false;
        const refresh = () =>
            invoke('selection_status')
                .then((value) => {
                    if (!disposed) setStatus(value);
                })
                .catch((e) => {
                    if (!disposed) setError(String(e));
                });
        refresh();
        const timer = setInterval(refresh, 2000);
        return () => {
            disposed = true;
            clearInterval(timer);
        };
    }, []);
    const toggle = async (enabled) => {
        setBusy(true);
        setError('');
        try {
            await invoke('selection_set_enabled', { enabled });
            setStatus((old) => ({ ...old, enabled }));
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <Card
            shadow='none'
            className='bg-content1 rounded-[10px] mb-[10px]'
        >
            <CardBody className='gap-3 p-4'>
                <h2 className='text-xl font-semibold'>{L('划词翻译', 'Selection translation')}</h2>
                <p className='text-default-500'>
                    {L(
                        '选中文字后点击附近的“译”按钮；在原有翻译窗口中显示原文、语言选项和各服务译文。',
                        'Select text in a PDF, browser or document, then click the nearby Translate badge. Only the translation is shown, preserving paragraphs and available font styles while merging PDF line breaks.'
                    )}
                </p>
                <Switch
                    isSelected={status?.enabled ?? false}
                    isDisabled={!status?.supported || busy}
                    onValueChange={toggle}
                >
                    {L('启用划词翻译按钮', 'Enable selection translation badge')}
                </Switch>
                {status?.supported && !status.enabled && (
                    <div className='rounded-lg bg-content2 p-3 flex flex-wrap items-center gap-3'>
                        <p
                            role='status'
                            className='text-sm flex-1'
                        >
                            {L(
                                '划词翻译已关闭，选中文字时不会出现“译”按钮。',
                                'Selection translation is off. Selecting text will not show the Translate badge.'
                            )}
                        </p>
                        <Button
                            size='sm'
                            color='primary'
                            variant='flat'
                            isLoading={busy}
                            onPress={() => toggle(true)}
                        >
                            {L('启用划词翻译', 'Enable selection translation')}
                        </Button>
                    </div>
                )}
                {status?.supported && status.enabled && status.listening && (
                    <p
                        role='status'
                        className='text-sm text-success'
                    >
                        {L(
                            '划词监听已就绪：选中文字后点击附近的“译”，在原有翻译窗口查看原文和译文。',
                            'Ready: select text and click the nearby Translate badge. The popup shows only the translation.'
                        )}
                    </p>
                )}
                {status?.enabled && status?.supported && status?.listening === false && (
                    <p
                        role='alert'
                        className='text-danger'
                    >
                        {L(
                            '划词监听尚未就绪，请重启应用。',
                            'The selection listener is not ready. Restart the application.'
                        )}
                        {status.lastError ? ` ${status.lastError}` : ''}
                    </p>
                )}
                <div className='flex flex-wrap gap-3'>
                    <Button
                        variant='flat'
                        onPress={() => navigate('/hotkey')}
                    >
                        {L('设置划词翻译快捷键', 'Set selection translation shortcut')}
                    </Button>
                    <Button
                        variant='light'
                        onPress={() => navigate('/service')}
                    >
                        {L('配置翻译服务', 'Configure translation services')}
                    </Button>
                </div>
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
