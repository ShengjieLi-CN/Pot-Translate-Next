import React from 'react';
import { Button, Input } from '@nextui-org/react';
import { useConfig } from '../../../hooks';
import OfflineEnginePanel from '../../../components/OfflineEnginePanel';

export function Config({ instanceKey, updateServiceList, onClose }) {
    const [config, setConfig] = useConfig(
        instanceKey,
        { instanceName: 'LibreTranslate 离线翻译', enable: true },
        { sync: false }
    );
    return (
        <div className='space-y-4'>
            <Input
                label='服务名称'
                value={config?.instanceName || ''}
                onValueChange={(instanceName) => setConfig({ ...config, instanceName })}
            />
            <OfflineEnginePanel />
            <p className='text-xs text-default-500'>
                内置 LibreTranslate 1.9.6，默认安装中译英和英译中两个模型。在输入翻译的语言栏选择中文 → 英语或英语 →
                中文；截图、划词和同传也可选择此引擎。
            </p>
            <Button
                fullWidth
                color='primary'
                isDisabled={!config}
                onPress={() => {
                    setConfig(config, true);
                    updateServiceList(instanceKey);
                    onClose();
                }}
            >
                保存
            </Button>
        </div>
    );
}
