export const repository = 'ShengjieLi-CN/Pot-Translate-Next';
export const repositoryUrl = `https://github.com/${repository}`;
export const releasesUrl = `${repositoryUrl}/releases/latest`;

export function newerVersion(latest, current) {
    const parse = (v) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
    const a = parse(latest),
        b = parse(current);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
}

export function releaseDownload(release) {
    return release.assets?.find(
        (asset) =>
            /_x64_zh-CN\.msi$/i.test(asset.name) &&
            asset.browser_download_url?.startsWith(`${repositoryUrl}/releases/download/`)
    )?.browser_download_url;
}
