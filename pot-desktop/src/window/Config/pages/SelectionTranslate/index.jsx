import React, { useEffect, useState } from 'react';
import { Button, Card, CardBody, Switch } from '@nextui-org/react';
import { invoke } from '@tauri-apps/api/tauri';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useConfig } from '../../../../hooks';
import { languageList } from '../../../../utils/language';
import { loadSelectionTranslators } from '../../../../services/selection_translation';

export default function SelectionSettings() {
    const { i18n, t } = useTranslation();
    const L = (cn, en) => (i18n.language.startsWith('zh') ? cn : en);
    const navigate = useNavigate();
    const [status, setStatus] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [keys] = useConfig('translate_service_list', ['deepl', 'bing', 'lingva', 'yandex', 'google']);
    const [service, setService] = useConfig('selection_translate_service', '');
    const [target, setTarget] = useConfig('selection_target_language', 'zh_cn');
    const [services, setServices] = useState([]);
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
    useEffect(() => {
        if (!keys) return;
        let disposed = false;
        loadSelectionTranslators(keys)
            .then((value) => {
                if (!disposed) setServices(value);
            })
            .catch((e) => {
                if (!disposed) setError(String(e));
            });
        return () => {
            disposed = true;
        };
    }, [keys]);
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
            className='bg-content1 rounded-[10px]'
        >
            <CardBody className='gap-5 p-6'>
                <h2 className='text-xl font-semibold'>{L('划词翻译', 'Selection translation')}</h2>
                <p className='text-default-500'>
                    {L(
                        '在 PDF、浏览器或文档中选中文字，点击附近的“译”按钮。浮窗仅显示译文，保留段落与可读取的字体样式，合并 PDF 断行，不逐句另起一行。',
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
                            '划词监听已就绪：选中文字后点击附近的“译”，浮窗仅显示译文。',
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
                {status && !status.supported && (
                    <p>
                        {L(
                            '自动划词目前支持 Windows；其他平台可使用划词翻译快捷键。',
                            'The automatic badge currently supports Windows. Other platforms can use the selection translation shortcut.'
                        )}
                    </p>
                )}
                <label className='flex flex-col gap-2'>
                    <span>{L('翻译服务', 'Translation service')}</span>
                    <select
                        className='p-2 rounded-lg bg-content2'
                        aria-label={L('划词翻译服务', 'Selection translation service')}
                        value={service || ''}
                        onChange={(e) => setService(e.target.value)}
                    >
                        <option value=''>{L('使用首个已启用的文本翻译服务', 'First enabled text translator')}</option>
                        {services.map((s) => (
                            <option
                                key={s.key}
                                value={s.key}
                            >
                                {s.title ||
                                    s.config.instanceName ||
                                    t(`services.${s.name}.title`, { defaultValue: s.name })}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='flex flex-col gap-2'>
                    <span>{L('目标语言', 'Target language')}</span>
                    <select
                        className='p-2 rounded-lg bg-content2'
                        aria-label={L('划词目标语言', 'Selection target language')}
                        value={target || 'zh_cn'}
                        onChange={(e) => setTarget(e.target.value)}
                    >
                        {languageList.map((language) => (
                            <option
                                key={language}
                                value={language}
                            >
                                {t(`languages.${language}`)}
                            </option>
                        ))}
                    </select>
                </label>
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
                <p className='text-sm text-default-500'>
                    {L(
                        '划词后先出现“译”按钮，点击后才读取并发送选中文字；无法直接读取时会尝试兼容复制取词。若读取失败，浮窗会提示重新划词或使用截图翻译。仅有图片、无法选中文字的 PDF 请使用截图翻译。',
                        'Selecting offers a Translate badge. Text is read and sent only after clicking it. When direct selection access is unavailable, a compatibility copy is attempted. Reading failures show a message. Use screenshot translation for scanned PDFs.'
                    )}
                </p>
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
