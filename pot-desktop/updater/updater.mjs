import fetch from 'node-fetch';
import { writeFile } from 'node:fs/promises';
import { repository, releaseDownload } from '../src/utils/project.mjs';

// MSI updates use GitHub Releases directly. This exports metadata for local inspection.
const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Pot-Translate-Next',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
});
if (!response.ok) throw new Error(`GitHub release request failed (${response.status})`);
const release = await response.json();
const download = releaseDownload(release);
if (!download) throw new Error('Release has no x64 zh-CN MSI');
await writeFile('release-info.json', JSON.stringify({ version: release.tag_name, notes: release.body,
    published_at: release.published_at, download }, null, 2) + '\n');
