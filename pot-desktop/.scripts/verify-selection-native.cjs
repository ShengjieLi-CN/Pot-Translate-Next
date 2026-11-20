// Run with Windows Node against the installed application. No CDP or Playwright required.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(__dirname, 'verify-selection-native.ps1'),
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status === 0 ? 0 : 1;
