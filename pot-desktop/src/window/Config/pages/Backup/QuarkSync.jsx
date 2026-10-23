import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, ModalContent, ModalHeader, ModalBody, Spinner } from '@nextui-org/react';
import { invoke } from '@tauri-apps/api';
import { open } from '@tauri-apps/api/shell';
import { ask } from '@tauri-apps/api/dialog';
import { relaunch } from '@tauri-apps/api/process';
import toast from 'react-hot-toast';
import { useToastStyle } from '../../../../hooks';
import { store } from '../../../../utils/store';

const call = (operate, options) => invoke('quark_drive', { operate, options });
export default function QuarkSync() {
    const [status, setStatus] = useState(null);
    const [url, setUrl] = useState('');
    const [directory, setDirectory] = useState('/夸克/Pot Translate Next');
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const [isListOpen, setIsListOpen] = useState(false);
    const [files, setFiles] = useState([]);
    const [lastBackup, setLastBackup] = useState(null);
    const style = useToastStyle();
    useEffect(() => {
        let active = true;
        call('status')
            .then((value) => {
                if (active) {
                    setStatus(value);
                    setUrl(value.url);
                    setDirectory(value.directory);
                }
            })
            .catch((e) => toast.error(String(e), { style }));
        return () => {
            active = false;
        };
    }, []);
    const run = async (action) => {
        setBusy(true);
        try {
            await action();
        } catch (e) {
            toast.error(String(e), { style });
        } finally {
            setBusy(false);
        }
    };
    const save = async () => {
        const value = await call('configure', { url: url.trim(), directory: directory.trim(), token: token.trim() });
        setStatus(value);
        setUrl(value.url);
        setDirectory(value.directory);
        setToken('');
        return value;
    };
    const disabled = busy || !status;
    const restore = async (name) => {
        if (
            !(await ask('恢复会覆盖当前配置和历史记录，完成后将重启应用。是否继续？', {
                title: '从夸克网盘恢复',
                type: 'warning',
            }))
        )
            return;
        await call('restore', { name });
        setIsListOpen(false);
        toast.success('恢复成功，正在重启应用', { style });
        await relaunch();
    };
    return (
        <div className='space-y-4'>
            <h3>夸克网盘同步 · OpenList</h3>
            <p className='text-sm text-default-500'>
                先在自己的 OpenList 服务中挂载夸克网盘，并建立专用备份目录，再填写以下设置。
            </p>
            <Input
                label='OpenList 服务地址'
                placeholder='https://drive.example.com'
                value={url}
                variant='bordered'
                isDisabled={disabled}
                onValueChange={setUrl}
            />
            <Input
                label='OpenList 服务令牌'
                type='password'
                placeholder={status?.has_token ? '已保存，留空保留原令牌' : '请输入服务令牌'}
                value={token}
                variant='bordered'
                isDisabled={disabled}
                onValueChange={setToken}
            />
            <Input
                label='夸克备份目录'
                value={directory}
                variant='bordered'
                isDisabled={disabled}
                onValueChange={setDirectory}
                description='填写 OpenList 中已存在的完整路径，例如 /夸克/Pot Translate Next。'
            />
            <div className='flex gap-3 flex-wrap'>
                <Button
                    variant='flat'
                    isDisabled={disabled}
                    onPress={() =>
                        run(async () => {
                            await save();
                            toast.success('设置已保存', { style });
                        })
                    }
                >
                    保存设置
                </Button>
                <Button
                    variant='light'
                    isDisabled={disabled}
                    onPress={() =>
                        run(async () => {
                            await save();
                            await call('test');
                            toast.success('OpenList 连接成功', { style });
                        })
                    }
                >
                    测试连接
                </Button>
                <Button
                    color='success'
                    variant='flat'
                    isDisabled={disabled}
                    isLoading={busy}
                    onPress={() =>
                        run(async () => {
                            await save();
                            await store.save();
                            setLastBackup(await call('backup'));
                            toast.success('同步成功', { style });
                        })
                    }
                >
                    立即同步
                </Button>
                <Button
                    color='secondary'
                    variant='flat'
                    isDisabled={disabled}
                    onPress={() =>
                        run(async () => {
                            await save();
                            setFiles([]);
                            setIsListOpen(true);
                            setFiles(await call('list'));
                        })
                    }
                >
                    恢复备份
                </Button>
            </div>
            {lastBackup && (
                <p className='text-sm text-default-500 select-text break-all'>最近同步：{lastBackup.name}</p>
            )}
            <Modal
                isOpen={isListOpen}
                isDismissable={!busy}
                hideCloseButton={busy}
                onOpenChange={(value) => {
                    if (!busy) setIsListOpen(value);
                }}
                scrollBehavior='inside'
            >
                <ModalContent>
                    <ModalHeader>夸克云端备份</ModalHeader>
                    <ModalBody className='pb-5 space-y-3'>
                        {busy ? (
                            <Spinner label='正在处理…' />
                        ) : files.length === 0 ? (
                            <p>暂无备份</p>
                        ) : (
                            files.map((file) => (
                                <div
                                    key={file.name}
                                    className='flex gap-2'
                                >
                                    <Button
                                        className='flex-1 min-w-0'
                                        variant='flat'
                                        isDisabled={busy}
                                        onPress={() => run(() => restore(file.name))}
                                    >
                                        {file.name}
                                    </Button>
                                    <Button
                                        color='danger'
                                        variant='flat'
                                        isDisabled={busy}
                                        onPress={() =>
                                            run(async () => {
                                                if (
                                                    !(await ask(`删除备份 ${file.name}？`, {
                                                        title: '删除备份',
                                                        type: 'warning',
                                                    }))
                                                )
                                                    return;
                                                await call('remove', { name: file.name });
                                                setFiles(await call('list'));
                                                toast.success('备份已删除', { style });
                                            })
                                        }
                                    >
                                        删除
                                    </Button>
                                </div>
                            ))
                        )}
                        <div className='flex gap-2'>
                            <Button
                                variant='light'
                                isDisabled={busy}
                                onPress={() => run(async () => setFiles(await call('list')))}
                            >
                                刷新列表
                            </Button>
                            <Button
                                variant='light'
                                isDisabled={busy}
                                onPress={() => open(status.url)}
                            >
                                打开 OpenList
                            </Button>
                        </div>
                    </ModalBody>
                </ModalContent>
            </Modal>
        </div>
    );
}
