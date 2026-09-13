import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const version = '1.14.0';
const runtimeDirectory = path.resolve('runtime');
const binDirectory = path.join(runtimeDirectory, 'bin');
const temporaryDirectory = path.join(runtimeDirectory, '.install');

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error(
    '自动安装器当前只负责 Windows x64。其他平台请安装 sing-box，并设置 SING_BOX_BIN。',
  );
  process.exit(1);
}

const archiveName = `sing-box-${version}-windows-amd64.zip`;
const archivePath = path.join(temporaryDirectory, archiveName);
const downloadUrl = `https://github.com/SagerNet/sing-box/releases/download/v${version}/${archiveName}`;
const expectedSha256 =
  '3ffb56267da14e287be48bd10cf7e6505260125bad940b75101fbb4d5d58e5d6';

fs.mkdirSync(temporaryDirectory, { recursive: true });
fs.mkdirSync(binDirectory, { recursive: true });

console.log(
  `Downloading sing-box ${version} from the official GitHub release...`,
);
const response = await fetch(downloadUrl, { redirect: 'follow' });
if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));

const digest = crypto
  .createHash('sha256')
  .update(fs.readFileSync(archivePath))
  .digest('hex');
if (digest !== expectedSha256)
  throw new Error(`sing-box 压缩包校验失败：${digest}`);

execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '& { param($archive, $destination) Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }',
    archivePath,
    temporaryDirectory,
  ],
  { stdio: 'inherit', windowsHide: true },
);

const executable = fs
  .readdirSync(temporaryDirectory, { recursive: true })
  .map((entry) => path.join(temporaryDirectory, String(entry)))
  .find((entry) => path.basename(entry).toLowerCase() === 'sing-box.exe');
if (!executable) throw new Error('压缩包中没有找到 sing-box.exe。');

fs.copyFileSync(executable, path.join(binDirectory, 'sing-box.exe'));
fs.writeFileSync(path.join(binDirectory, '.version'), `${version}\n`, 'utf8');
console.log(`Installed: ${path.join(binDirectory, 'sing-box.exe')}`);
