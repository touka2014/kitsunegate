import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const version = '26.11.9';
const releases = {
  'linux-x64': [
    'linux-64',
    'b651f7e1d9966ee2c1b1ee1bf8b52c72771824d3065dce96bbc8bcc19ed95f82',
  ],
  'linux-arm64': [
    'linux-arm64-v8a',
    '64ed6858982a7f5eb85d88b811089063bd4f17561f4c8f44e0f1dc8e6f6430be',
  ],
  'win32-x64': [
    'windows-64',
    '1262522266337b824f07beb8e1375786b437683b3890105469088f8e17e0a69d',
  ],
};
const release = releases[process.platform + '-' + process.arch];
if (!release)
  throw new Error(
    'Install Xray-core manually and set XRAY_BIN to the executable.',
  );
const [platform, checksum] = release;
const name = process.platform === 'win32' ? 'xray.exe' : 'xray';
const dest = path.resolve(process.argv[2] ?? 'runtime/bin');
fs.mkdirSync(dest, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsunegate-xray-'));
const staging = path.join(dest, '.' + name + '-' + crypto.randomUUID());
try {
  const url = `https://github.com/XTLS/Xray-core/releases/download/v${version}/Xray-${platform}.zip`;
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok)
    throw new Error('Xray download failed (HTTP ' + response.status + ').');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== checksum)
    throw new Error('Xray archive SHA-256 mismatch.');
  const archive = path.join(temp, 'core.zip');
  fs.writeFileSync(archive, bytes);
  if (process.platform === 'win32')
    execFileSync('tar.exe', ['-xf', archive, '-C', temp, name], {
      windowsHide: true,
    });
  else execFileSync('unzip', ['-qo', archive, name, '-d', temp]);
  fs.copyFileSync(path.join(temp, name), staging);
  fs.chmodSync(staging, 0o755);
  fs.renameSync(staging, path.join(dest, name));
  console.log('Installed verified Xray-core ' + version + ' in ' + dest);
} finally {
  fs.rmSync(staging, { force: true });
  fs.rmSync(temp, { recursive: true, force: true });
}
