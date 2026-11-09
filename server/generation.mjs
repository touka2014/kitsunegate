import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { renderHAProxyConfig, renderSingBoxConfig } from './engine.mjs';

const exec = promisify(execFile);
export function alive(child) {
  return Boolean(
    child?.pid &&
    child.exitCode === null &&
    child.signalCode === null &&
    !child.killed,
  );
}

export async function listen(server, port, host) {
  const ready = once(server, 'listening');
  server.listen({ port, host, exclusive: true });
  await ready;
}

async function terminate(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const exited = once(child, 'exit').catch(() => {});
  child.kill();
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

export async function discard(gen) {
  if (!gen) return;
  await terminate(gen.haproxy);
  await terminate(gen.core);
  fs.rmSync(gen.dir, { recursive: true, force: true });
  if (gen.socket) fs.rmSync(gen.socket, { force: true });
}

async function processReady(child, options) {
  for (let i = 0; i < 200; i++) {
    if (!alive(child))
      throw new Error('Candidate process exited before accepting connections.');
    try {
      const socket = net.createConnection(options);
      try {
        await once(socket, 'connect');
      } finally {
        socket.destroy();
      }
      return;
    } catch {
      await delay(25);
    }
  }
  throw new Error('Candidate process readiness timed out.');
}

export async function prepare(groups, options) {
  const {
    directory,
    socketPath,
    binary,
    haproxyBinary,
    previous,
    logLevel,
    log,
    onExit,
  } = options;
  if (!binary)
    throw new Error('sing-box is missing. Install the proxy core first.');
  const dir = fs.mkdtempSync(path.join(directory, 'gen-'));
  const gen = {
    dir,
    ports: new Map(),
    clients: 0,
    frontends: groups.filter((g) => g.enabled).map((g) => g.id),
    counters: new Map(),
    core: null,
    haproxy: null,
    retired: false,
  };
  const reserved = [];
  let lastDiagnostic = '';
  async function launch(source, bin, args) {
    const child = spawn(bin, args, { cwd: dir, windowsHide: true });
    gen[source === 'haproxy' ? 'haproxy' : 'core'] = child;
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
          lastDiagnostic = line;
          log(source, line);
        }
      });
    child.on('exit', (code) => onExit(gen, source, code));
    await once(child, 'spawn');
    return child;
  }
  try {
    const used = new Set(
      groups.filter((g) => g.enabled).map((g) => g.listen_port),
    );
    if (
      groups.some((g) =>
        g.nodes.some((n) => n.enabled && used.has(n.adapter_port)),
      )
    )
      throw new Error('Listener port conflicts with a node adapter.');
    const active = groups.filter((g) => g.enabled);
    for (const group of active)
      for (const node of group.nodes.filter((n) => n.enabled)) {
        if (previous) {
          // Reserve all temporary ports together so two adapters cannot receive the same port.
          let port;
          do {
            const server = net.createServer();
            await listen(server, 0, '127.0.0.1');
            reserved.push(server);
            port = server.address().port;
          } while (used.has(port));
          node.adapter_port = port;
        }
        gen.ports.set(node.id, node.adapter_port);
      }
    gen.singConfig = renderSingBoxConfig(groups, { logLevel });
    gen.coreFile = path.join(dir, 'sing-box.json');
    fs.writeFileSync(gen.coreFile, gen.singConfig, { mode: 0o600 });
    const check = async (bin, args) =>
      exec(bin, args, { windowsHide: true, cwd: dir, timeout: 15000 });
    gen.version = (await check(binary, ['version'])).stdout.split(/\r?\n/)[0];
    await check(binary, ['check', '-c', gen.coreFile]);
    if (options.editedNodeId && !gen.ports.has(options.editedNodeId)) {
      const edited = groups
        .flatMap((group) => group.nodes)
        .find((node) => node.id === options.editedNodeId);
      if (edited) {
        const checkFile = path.join(dir, 'check-node.json');
        try {
          fs.writeFileSync(
            checkFile,
            renderSingBoxConfig([
              { enabled: true, nodes: [{ ...edited, enabled: true }] },
            ]),
            { mode: 0o600 },
          );
          await check(binary, ['check', '-c', checkFile]);
        } finally {
          fs.rmSync(checkFile, { force: true });
        }
      }
    }
    if (haproxyBinary) {
      fs.mkdirSync(path.dirname(socketPath), { recursive: true });
      gen.socket = socketPath + '.' + path.basename(dir);
      gen.haConfig = renderHAProxyConfig(groups, { statsSocket: gen.socket });
      gen.haFile = path.join(dir, 'haproxy.cfg');
      fs.writeFileSync(gen.haFile, gen.haConfig, { mode: 0o600 });
      gen.haproxyVersion = (await check(haproxyBinary, ['-v'])).stdout.split(
        /\r?\n/,
      )[0];
      await check(haproxyBinary, ['-c', '-f', gen.haFile]);
    }
    await Promise.all(
      reserved
        .splice(0)
        .map((server) => new Promise((resolve) => server.close(resolve))),
    );
    await launch('sing-box', binary, ['run', '-c', gen.coreFile]);
    for (const port of gen.ports.values())
      await processReady(gen.core, { port, host: '127.0.0.1' });
    if (haproxyBinary) {
      const args = ['-db', '-f', gen.haFile];
      if (alive(previous?.haproxy)) args.push('-x', previous.socket);
      await launch('haproxy', haproxyBinary, args);
      await processReady(gen.haproxy, { path: gen.socket });
    }
    // A core without adapters has no socket to connect to.
    if (!gen.ports.size) await delay(150);
    if (!alive(gen.core) || (haproxyBinary && !alive(gen.haproxy)))
      throw new Error('Candidate core stopped during startup.');
    return gen;
  } catch (error) {
    for (const server of reserved) server.close();
    await discard(gen);
    throw new Error(
      `Configuration rejected: ${error.stderr?.trim() || error.message}${lastDiagnostic ? '\n' + lastDiagnostic : ''}`,
    );
  }
}
