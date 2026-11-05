import { Button, Card, CardBody, Spinner, Progress } from '@nextui-org/react';
import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';
import ReactMarkdown from 'react-markdown';
import { appVersion } from '../../utils/env';
import { newerVersion, releaseDownload } from '../../utils/project.mjs';

export default function Updater() {
    const [release, setRelease] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [phase, setPhase] = useState('idle');
    const [progress, setProgress] = useState({ downloaded: 0, total: 0 });
    const busy = phase === 'downloading' || phase === 'installing';
    const check = async () => {
        setLoading(true); setError(''); setPhase('idle');
        try { setRelease(await invoke('latest_release')); }
        catch (e) { setRelease(null); setError(String(e)); }
        finally { setLoading(false); }
    };
    useEffect(() => { appWindow.show(); check(); }, []);
    useEffect(() => {
        const unlisten = appWindow.onCloseRequested((event) => { if (busy) event.preventDefault(); });
        return () => { unlisten.then((fn) => fn()); };
    }, [busy]);
    const download = async () => {
        setError(''); setProgress({ downloaded: 0, total: 0 }); setPhase('downloading');
        let unlisten;
        try {
            unlisten = await listen('update-download-progress', ({ payload }) => setProgress(payload));
            await invoke('download_update');
            setPhase('ready');
        } catch (e) { setError(String(e)); setPhase('idle'); }
        finally { unlisten?.(); }
    };
    const install = async () => {
        setError(''); setPhase('installing');
        try { await invoke('install_update'); }
        catch (e) { setError(String(e)); setPhase('ready'); }
    };
    const available = release && !release.draft && !release.prerelease && newerVersion(release.tag_name, appVersion);
    const asset = release && releaseDownload(release);
    const percent = progress.total ? Math.min(100, progress.downloaded / progress.total * 100) : 0;
    return (
        <div className='bg-background h-screen p-5 flex flex-col gap-4'>
            <h2 data-tauri-drag-region='true'>检查更新 · Pot Translate Next</h2>
            <Card className='flex-1 min-h-0'>
                <CardBody className='gap-3 overflow-auto'>
                    {loading ? <Spinner label='正在检查项目更新…' /> : release && <>
                        <p>{available ? `发现新版本 ${release.tag_name}` : `当前已是最新版本（${appVersion}）`}</p>
                        <ReactMarkdown className='markdown-body select-text'>{release.body || '暂无更新说明。'}</ReactMarkdown>
                        {available && asset && <p className='text-sm text-default-500'>更新将在应用内下载并校验。点击安装后将请求管理员授权，退出应用并运行安装程序，原有配置会保留。</p>}
                        {available && !asset && <p>此版本尚未提供 x64 简体中文 MSI，请稍后重新检查。</p>}
                    </>}
                    {phase === 'downloading' && <div role='status'>
                        <Progress aria-label='更新下载进度' value={percent} />
                        <p>{progress.total ? `已下载 ${(progress.downloaded / 1048576).toFixed(1)} / ${(progress.total / 1048576).toFixed(1)} MB（${Math.floor(percent)}%）` : '正在连接下载服务…'}</p>
                    </div>}
                    {phase === 'ready' && <p role='status'>安装包已下载并通过 SHA256 校验，可以安装。</p>}
                    {phase === 'installing' && <p role='status'>正在请求安装授权，请在 Windows 提示中确认…</p>}
                    {error && <p role='alert'>{error}</p>}
                </CardBody>
            </Card>
            <div className='flex justify-end gap-3'>
                <Button variant='flat' isDisabled={loading || busy} onPress={check}>重新检查</Button>
                {phase === 'downloading' ? <Button onPress={() => invoke('cancel_update_download').catch((e) => setError(String(e)))}>取消下载</Button>
                    : phase === 'ready' || phase === 'installing' ? <Button color='primary' isLoading={phase === 'installing'} onPress={install}>安装更新并退出应用</Button>
                    : available && asset && <Button color='primary' isDisabled={loading} onPress={download}>下载更新</Button>}
                <Button variant='flat' isDisabled={busy} onPress={() => appWindow.close()}>关闭</Button>
            </div>
        </div>
    );
}
