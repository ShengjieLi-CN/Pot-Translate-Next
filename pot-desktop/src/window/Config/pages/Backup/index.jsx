import React, { useEffect, useState } from 'react';
import {
    Button,
    Card,
    CardBody,
    Dropdown,
    DropdownTrigger,
    DropdownMenu,
    DropdownItem,
    Input,
    useDisclosure,
} from '@nextui-org/react';
import toast, { Toaster } from 'react-hot-toast';
import { useConfig, useToastStyle } from '../../../../hooks';
import { osType } from '../../../../utils/env';
import { store } from '../../../../utils/store';
import * as webdav from './utils/webdav';
import * as local from './utils/local';
import WebDavModal from './WebDavModal';
import QuarkSync from './QuarkSync';

const labels = { quark: '夸克网盘', webdav: 'WebDAV', local: '本地备份' };
export default function Backup() {
    const [backupType, setBackupType] = useConfig('backup_type', 'quark');
    const [url, setUrl] = useConfig('webdav_url', '');
    const [username, setUsername] = useConfig('webdav_username', '');
    const [password, setPassword] = useConfig('webdav_password', '');
    const [busy, setBusy] = useState(false);
    const list = useDisclosure();
    const style = useToastStyle();
    const selected = labels[backupType] ? backupType : 'quark';
    useEffect(() => {
        if (backupType !== null && !labels[backupType]) setBackupType('quark');
    }, [backupType]);
    const run = async (action, message) => {
        setBusy(true);
        try {
            await action();
            toast.success(message, { style });
        } catch (e) {
            toast.error(String(e), { style });
        } finally {
            setBusy(false);
        }
    };
    return (
        <Card className='mb-[10px]'>
            <Toaster />
            <CardBody className='gap-4'>
                <div className='config-item'>
                    <h3 className='my-auto'>备份方式</h3>
                    <Dropdown>
                        <DropdownTrigger>
                            <Button
                                variant='bordered'
                                isDisabled={busy}
                            >
                                {labels[selected]}
                            </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                            aria-label='备份方式'
                            onAction={(key) => setBackupType(String(key))}
                        >
                            {Object.entries(labels).map(([key, label]) => (
                                <DropdownItem key={key}>{label}</DropdownItem>
                            ))}
                        </DropdownMenu>
                    </Dropdown>
                </div>
                {selected === 'quark' ? (
                    <QuarkSync />
                ) : (
                    <>
                        {selected === 'webdav' && (
                            <div className='space-y-3'>
                                <Input
                                    label='WebDAV 地址'
                                    variant='bordered'
                                    value={url || ''}
                                    onValueChange={setUrl}
                                    isDisabled={busy}
                                />
                                <Input
                                    label='用户名'
                                    variant='bordered'
                                    value={username || ''}
                                    onValueChange={setUsername}
                                    isDisabled={busy}
                                />
                                <Input
                                    label='密码'
                                    type='password'
                                    variant='bordered'
                                    value={password || ''}
                                    onValueChange={setPassword}
                                    isDisabled={busy}
                                />
                            </div>
                        )}
                        <div className='flex justify-around'>
                            <Button
                                color='success'
                                variant='flat'
                                isLoading={busy}
                                onPress={() =>
                                    run(async () => {
                                        await store.save();
                                        const name = `${osType}-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
                                        if (selected === 'webdav') await webdav.backup(url, username, password, name);
                                        else await local.backup(name);
                                    }, '备份成功')
                                }
                            >
                                备份
                            </Button>
                            <Button
                                color='secondary'
                                variant='flat'
                                isDisabled={busy}
                                onPress={() => {
                                    if (selected === 'webdav') list.onOpen();
                                    else run(local.get, '恢复成功，请重启应用使配置生效');
                                }}
                            >
                                恢复备份
                            </Button>
                        </div>
                    </>
                )}
            </CardBody>
            <WebDavModal
                isOpen={list.isOpen}
                onOpenChange={list.onOpenChange}
                url={url}
                username={username}
                password={password}
            />
        </Card>
    );
}
