import test from 'node:test';
import assert from 'node:assert/strict';
import { newerVersion, releaseDownload, repositoryUrl } from '../src/utils/project.mjs';

test('updates compare stable versions and select Chinese MSI assets from the project repository', () => {
    assert.equal(newerVersion('v3.10.0', '3.2.1'), true);
    assert.equal(newerVersion('3.2.1', '3.2.1'), false);
    assert.equal(newerVersion('3.2.2-beta', '3.2.1'), false);
    const url = `${repositoryUrl}/releases/download/3.2.2/Pot_3.2.2_x64_zh-CN.msi`;
    assert.equal(releaseDownload({ assets: [
        { name: 'Pot_x64_en-US.msi', browser_download_url: 'https://example.com/en' },
        { name: 'Pot_x64_zh-CN.msi', browser_download_url: 'https://example.com/zh' },
        { name: 'Pot_3.2.2_x64_zh-CN.msi', browser_download_url: url },
    ] }), url);
});
