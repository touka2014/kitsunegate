import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const adminUser =
  process.env.KITSUNEGATE_ADMIN_USER ||
  process.env.RELAYDECK_ADMIN_USER ||
  'kitsunegate';
const adminPassword =
  process.env.KITSUNEGATE_ADMIN_PASSWORD ||
  process.env.RELAYDECK_ADMIN_PASSWORD;
if (!adminPassword)
  throw new Error(
    'KITSUNEGATE_ADMIN_PASSWORD is required; refusing to start an unprotected dashboard.',
  );
const passwordHash = execFileSync('openssl', ['passwd', '-6', adminPassword], {
  encoding: 'utf8',
}).trim();
fs.writeFileSync(
  '/run/kitsunegate/nginx.htpasswd',
  `${adminUser}:${passwordHash}\n`,
  { mode: 0o600 },
);

const children = [
  spawn(process.execPath, ['server/index.mjs'], {
    stdio: 'inherit',
    env: process.env,
  }),
  spawn(process.execPath, ['dist/standalone/server.js'], {
    stdio: 'inherit',
    env: { ...process.env, HOST: '127.0.0.1', PORT: '3000' },
  }),
  spawn('nginx', ['-g', 'daemon off;'], { stdio: 'inherit', env: process.env }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 2000).unref();
}

for (const child of children) {
  child.on('error', (error) => {
    console.error(error);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(
        `Container service exited: code=${code ?? 'null'} signal=${signal ?? 'none'}`,
      );
      stop(code || 1);
    }
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
