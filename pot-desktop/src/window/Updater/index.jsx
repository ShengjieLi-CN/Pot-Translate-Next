import { Button, Card, CardBody, Spinner } from '@nextui-org/react';
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api';
import { open } from '@tauri-apps/api/shell';
import { appWindow } from '@tauri-apps/api/window';
import ReactMarkdown from 'react-markdown';
import { appVersion } from '../../utils/env';
import { newerVersion, releaseDownload, releasesUrl } from '../../utils/project.mjs';

export default function Updater() {
    const [release, setRelease] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const check = async () => {
        setLoading(true);
        setError('');
        try {
            setRelease(await invoke('latest_release'));
        } catch (e) {
            setRelease(null);
            setError(String(e));
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        appWindow.show();
        check();
    }, []);
    const available = release && newerVersion(release.tag_name, appVersion);
    const download = release && releaseDownload(release);
    return (
        <div className='bg-background h-screen p-5 flex flex-col gap-4'>
            <h2 data-tauri-drag-region='true'>检查更新 · Pot Translate Next</h2>
            <Card className='flex-1 min-h-0'>
                <CardBody className='gap-3'>
                    {loading ? (
                        <Spinner label='正在检查项目更新…' />
                    ) : error ? (
                        <p role='alert'>{error}</p>
                    ) : (
                        <>
                            <p>{available ? `发现新版本 ${release.tag_name}` : `当前已是最新版本（${appVersion}）`}</p>
                            <ReactMarkdown className='markdown-body select-text'>
                                {release?.body || '暂无更新说明。'}
                            </ReactMarkdown>
                            {available && (
                                <p className='text-sm text-default-500'>
                                    下载简体中文 MSI 后运行安装程序即可更新，原有配置会保留。
                                </p>
                            )}
                            {available && !download && <p>此版本尚未提供 x64 简体中文 MSI，请查看发布页面。</p>}
                        </>
                    )}
                </CardBody>
            </Card>
            <div className='flex justify-end gap-3'>
                <Button
                    variant='flat'
                    isDisabled={loading}
                    onPress={check}
                >
                    重新检查
                </Button>
                <Button
                    color='primary'
                    isDisabled={loading}
                    onPress={() => open(available && download ? download : releasesUrl)}
                >
                    {available && download ? '下载简体中文安装包' : '查看发布页面'}
                </Button>
                <Button
                    variant='flat'
                    onPress={() => appWindow.close()}
                >
                    关闭
                </Button>
            </div>
        </div>
    );
}
