import { arch as archFn, version } from '@tauri-apps/api/os';
import { getVersion } from '@tauri-apps/api/app';

export const osType = 'Windows_NT';
export let arch = '';
export let osVersion = '';
export let appVersion = '';

export async function initEnv() {
    arch = await archFn();
    osVersion = await version();
    appVersion = await getVersion();
}
