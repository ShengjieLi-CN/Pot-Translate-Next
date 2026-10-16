import React, { useEffect, useState } from 'react';
import { Button, Card, CardBody, Spinner } from '@nextui-org/react';
import { Provider, createStore } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BaseDirectory, exists, readDir, readTextFile } from '@tauri-apps/api/fs';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/tauri';

import SourceArea from '../../../Translate/components/SourceArea';
import LanguageArea from '../../../Translate/components/LanguageArea';
import TargetArea from '../../../Translate/components/TargetArea';
import * as builtinServices from '../../../../services/translate';
import { useConfig } from '../../../../hooks';
import { store } from '../../../../utils/store';
import { getServiceName, whetherPluginService } from '../../../../utils/service_instance';

// Keep the main-page draft across settings navigation. Popup translation has
// its own store and native-window lifecycle.
const inputStore = createStore();

function InputTranslateContent() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [translateServices] = useConfig('translate_service_list', [
        'deepl',
        'bing',
        'lingva',
        'yandex',
        'google',
        'ecdict',
    ]);
    const [ttsServices] = useConfig('tts_service_list', ['lingva_tts']);
    const [collectionServices] = useConfig('collection_service_list', []);
    const [resources, setResources] = useState(null);
    const [error, setError] = useState('');
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        if (!translateServices || !ttsServices || !collectionServices) return;
        let disposed = false;
        setError('');
        const load = async () => {
            const pluginList = { translate: {}, tts: {}, recognize: {}, collection: {} };
            for (const type of ['translate', 'tts', 'collection']) {
                if (!(await exists(`plugins/${type}`, { dir: BaseDirectory.AppConfig }))) continue;
                for (const plugin of await readDir(`plugins/${type}`, { dir: BaseDirectory.AppConfig })) {
                    const info = JSON.parse(
                        await readTextFile(`plugins/${type}/${plugin.name}/info.json`, { dir: BaseDirectory.AppConfig })
                    );
                    if (info.icon)
                        info.icon = convertFileSrc(
                            await join(await appConfigDir(), 'plugins', type, plugin.name, info.icon)
                        );
                    pluginList[type][plugin.name] = info;
                }
            }
            const keys = [...new Set([...translateServices, ...ttsServices, ...collectionServices])];
            const entries = await Promise.all(keys.map(async (key) => [key, (await store.get(key)) ?? {}]));
            if (!disposed) setResources({ pluginList, serviceInstanceConfigMap: Object.fromEntries(entries) });
        };
        load().catch((error) => {
            if (!disposed) setError(String(error));
        });
        return () => {
            disposed = true;
        };
    }, [translateServices, ttsServices, collectionServices, retry]);

    if (error)
        return (
            <Card
                shadow='none'
                className='bg-content1 rounded-[10px]'
            >
                <CardBody className='gap-3'>
                    <p role='alert'>
                        {t('config.input.load_error')}: {error}
                    </p>
                    <Button
                        className='self-start'
                        variant='flat'
                        onPress={() => setRetry((value) => value + 1)}
                    >
                        {t('translate.retry')}
                    </Button>
                </CardBody>
            </Card>
        );

    if (!resources)
        return (
            <Spinner
                className='m-6'
                label={t('config.input.loading')}
            />
        );

    const enabledServices = (translateServices ?? []).filter((key) => {
        if (!(key in resources.serviceInstanceConfigMap)) return false;
        if (resources.serviceInstanceConfigMap[key]?.enable === false) return false;
        const name = getServiceName(key);
        return whetherPluginService(key)
            ? Boolean(resources.pluginList.translate[name])
            : Boolean(builtinServices[name]);
    });

    return (
        <div className='input-translate-page'>
            <SourceArea
                embedded
                canTranslate={enabledServices.length > 0}
                {...resources}
            >
                <LanguageArea />
            </SourceArea>
            <p className='text-xs text-default-500 px-1'>{t('config.input.hint')}</p>
            {enabledServices.length > 0 ? (
                <TargetArea
                    embedded
                    key={enabledServices[0]}
                    index={0}
                    name={enabledServices[0]}
                    translateServiceInstanceList={enabledServices}
                    {...resources}
                />
            ) : (
                <Card
                    shadow='none'
                    className='bg-content1 rounded-[10px] min-h-[200px]'
                >
                    <CardBody className='gap-3'>
                        <p className='text-default-500'>{t('config.input.no_service')}</p>
                        <Button
                            className='self-start'
                            variant='flat'
                            onPress={() => navigate('/service')}
                        >
                            {t('config.input.configure_service')}
                        </Button>
                    </CardBody>
                </Card>
            )}
        </div>
    );
}

export default function InputTranslate() {
    return (
        <Provider store={inputStore}>
            <InputTranslateContent />
        </Provider>
    );
}
