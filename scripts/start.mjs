import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const command = isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
const commandArgs = isWindows
  ? ['/d', '/s', '/c', 'npm run start:web']
  : ['run', 'start:web'];
const api = spawn(process.execPath, ['server/index.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
const web = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  api.kill();
  web.kill();
  setTimeout(() => process.exit(code), 250);
}

api.on('exit', (code) => {
  if (!stopping && code) stop(code);
});
web.on('exit', (code) => {
  if (!stopping && code) stop(code);
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
