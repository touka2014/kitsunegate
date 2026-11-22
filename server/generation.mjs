import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { renderHAProxyConfig, renderXrayConfig } from './engine.mjs';

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

class InvalidXrayConfig extends Error {}
async function checkXray(binary, filename) {
  try {
    await exec(binary, ['run', '-test', '-config', filename], {
      cwd: path.dirname(filename),
      windowsHide: true,
      timeout: 15000,
    });
  } catch (error) {
    // Core diagnostics can echo the invalid key or password, including on stdout.
    if (error.code === 23) {
      const diagnostic = String(error.stdout) + String(error.stderr);
      const field = [
        'allowInsecure',
        'fingerprint',
        'shortId',
        'spiderX',
        'xPaddingBytes',
        'password',
        'encryption',
        'transport',
        'UUID',
      ].find((key) => diagnostic.toLowerCase().includes(key.toLowerCase()));
      throw new InvalidXrayConfig(
        'Configuration rejected by Xray. Check ' +
          (field ?? 'protocol, transport and security settings') +
          '.',
      );
    }
    throw error;
  }
}

export async function inspectUpgrade(groups, binary, directory) {
  if (!binary)
    throw new Error('Xray is missing. Install the proxy core first.');
  const dir = fs.mkdtempSync(path.join(directory, 'upgrade-'));
  const file = path.join(dir, 'check.json');
  const rejected = [];
  try {
    fs.writeFileSync(file, renderXrayConfig([]), { mode: 0o600 });
    await checkXray(binary, file);
    for (const node of groups
      .flatMap((g) => g.nodes)
      .filter((n) => n.enabled)) {
      let config;
      try {
        config = renderXrayConfig([{ enabled: true, nodes: [node] }]);
      } catch (error) {
        rejected.push({ node, reason: error.message });
        continue;
      }
      fs.writeFileSync(file, config, { mode: 0o600 });
      try {
        await checkXray(binary, file);
      } catch (error) {
        if (!(error instanceof InvalidXrayConfig)) throw error;
        rejected.push({ node, reason: error.message });
      }
    }
    return rejected;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    throw new Error('Xray is missing. Install the proxy core first.');
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
    const active = groups.filter((g) => g.enabled);
    for (const group of active)
      for (const node of group.nodes.filter((n) => n.enabled)) {
        let preferred =
          !previous && !used.has(node.adapter_port) ? node.adapter_port : 0;
        while (true) {
          const server = net.createServer();
          try {
            await listen(server, preferred, '127.0.0.1');
          } catch (error) {
            if (!preferred || error.code !== 'EADDRINUSE') throw error;
            preferred = 0;
            continue;
          }
          reserved.push(server);
          const port = server.address().port;
          if (!used.has(port)) {
            node.adapter_port = port;
            break;
          }
          preferred = 0;
        }
        gen.ports.set(node.id, node.adapter_port);
      }
    gen.coreConfig = renderXrayConfig(groups, { logLevel });
    gen.coreFile = path.join(dir, 'xray.json');
    fs.writeFileSync(gen.coreFile, gen.coreConfig, { mode: 0o600 });
    const check = async (bin, args) =>
      exec(bin, args, { windowsHide: true, cwd: dir, timeout: 15000 });
    gen.version = (await check(binary, ['version'])).stdout.split(/\r?\n/)[0];
    await checkXray(binary, gen.coreFile);
    if (options.editedNodeId && !gen.ports.has(options.editedNodeId)) {
      const edited = groups
        .flatMap((group) => group.nodes)
        .find((node) => node.id === options.editedNodeId);
      if (edited) {
        const checkFile = path.join(dir, 'check-node.json');
        try {
          fs.writeFileSync(
            checkFile,
            renderXrayConfig([
              { enabled: true, nodes: [{ ...edited, enabled: true }] },
            ]),
            { mode: 0o600 },
          );
          await checkXray(binary, checkFile);
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
    await launch('xray', binary, ['run', '-config', gen.coreFile]);
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
