import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import {
  addRuntimeLog,
  addTrafficSample,
  cleanupMonitoringData,
  getLatestTrafficTotals,
  getSettings,
  getNode,
  getRawStateForEngine,
  recordNodeHealth,
} from './database.mjs';
import { renderHAProxyConfig, renderSingBoxConfig } from './engine.mjs';
import {
  advanceMonotonicCounter,
  parseHAProxyActiveSessionBytes,
} from './monitoring.mjs';

const execFileAsync = promisify(execFile);
const runtimeDirectory = path.resolve(
  process.env.KITSUNEGATE_RUNTIME_DIR ??
    process.env.RELAYDECK_RUNTIME_DIR ??
    'runtime',
);
const generatedDirectory = path.join(runtimeDirectory, 'generated');
const executableName =
  process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
const bundledExecutable = path.join(runtimeDirectory, 'bin', executableName);
const configPath = path.join(generatedDirectory, 'sing-box.json');
const haproxyConfigPath = path.join(generatedDirectory, 'haproxy.cfg');
const haproxySocketPath =
  process.env.HAPROXY_SOCKET ??
  (process.platform === 'win32'
    ? path.join(generatedDirectory, 'haproxy.sock')
    : '/run/kitsunegate/haproxy.sock');

fs.mkdirSync(generatedDirectory, { recursive: true });

function executablePath() {
  if (process.env.SING_BOX_BIN) return path.resolve(process.env.SING_BOX_BIN);
  if (fs.existsSync(bundledExecutable)) return bundledExecutable;
  return null;
}

function haproxyExecutablePath() {
  if (process.env.HAPROXY_BIN) return path.resolve(process.env.HAPROXY_BIN);
  for (const candidate of ['/usr/sbin/haproxy', '/usr/local/sbin/haproxy']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function haproxyName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function freshMetrics(initial = {}) {
  return {
    bytesIn: Number(initial.bytesIn ?? 0),
    bytesOut: Number(initial.bytesOut ?? 0),
    activeConnections: 0,
    totalConnections: Number(initial.totalConnections ?? 0),
    speedIn: 0,
    speedOut: 0,
    previousBytesIn: Number(initial.bytesIn ?? 0),
    previousBytesOut: Number(initial.bytesOut ?? 0),
    previousAt: Date.now(),
    nodeConnections: new Map(),
    roundRobin: 0,
    haproxyRawBytesIn: 0,
    haproxyRawBytesOut: 0,
    haproxyRawConnections: 0,
    haproxyInitialized: false,
  };
}

function logLevel(line) {
  if (/fatal|error/i.test(line)) return 'error';
  if (/warn/i.test(line)) return 'warning';
  if (/debug|trace/i.test(line)) return 'debug';
  return 'info';
}

function waitForData(socket, minimum, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(
      () => finish(new Error('SOCKS handshake timed out')),
      timeoutMs,
    );
    function cleanup() {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', finish);
      socket.off('close', onClose);
    }
    function finish(error, value) {
      cleanup();
      if (error) reject(error);
      else resolve(value);
    }
    function onClose() {
      finish(new Error('SOCKS connection closed early'));
    }
    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= minimum) finish(null, buffer);
    }
    socket.on('data', onData);
    socket.once('error', finish);
    socket.once('close', onClose);
  });
}

function waitForSocksReply(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(
      () => finish(new Error('SOCKS connection response timed out')),
      timeoutMs,
    );
    function cleanup() {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', finish);
      socket.off('close', onClose);
    }
    function finish(error, value) {
      cleanup();
      if (error) reject(error);
      else resolve(value);
    }
    function onClose() {
      finish(new Error('SOCKS connection closed early'));
    }
    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 5) return;
      const required =
        buffer[3] === 0x01
          ? 10
          : buffer[3] === 0x04
            ? 22
            : buffer[3] === 0x03
              ? 7 + buffer[4]
              : 5;
      if (buffer.length >= required) {
        if (buffer.length > required) socket.unshift(buffer.subarray(required));
        finish(null, buffer.subarray(0, required));
      }
    }
    socket.on('data', onData);
    socket.once('error', finish);
    socket.once('close', onClose);
  });
}

async function openSocksTunnel(adapterPort, host, port, timeoutMs) {
  const socket = net.createConnection({ host: '127.0.0.1', port: adapterPort });
  socket.setTimeout(timeoutMs, () =>
    socket.destroy(new Error('Connecting to the proxy adapter timed out')),
  );
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.write(Buffer.from([0x05, 0x01, 0x00]));
  const greeting = await waitForData(socket, 2, timeoutMs);
  if (greeting[0] !== 0x05 || greeting[1] !== 0x00)
    throw new Error('SOCKS5 authentication negotiation failed');

  const hostBuffer = Buffer.from(host);
  if (hostBuffer.length > 255) throw new Error('Probe hostname is too long');
  socket.write(
    Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuffer.length]),
      hostBuffer,
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    ]),
  );
  const response = await waitForSocksReply(socket, timeoutMs);
  if (response[1] !== 0x00)
    throw new Error(`SOCKS5 target connection failed with code ${response[1]}`);
  socket.setTimeout(0);
  return socket;
}

async function probeThroughNode(node, probeUrl, timeoutSeconds) {
  const started = performance.now();
  let socket;
  let stream;
  try {
    const target = new URL(probeUrl);
    const targetPort = Number(
      target.port || (target.protocol === 'https:' ? 443 : 80),
    );
    socket = await openSocksTunnel(
      node.adapter_port,
      target.hostname,
      targetPort,
      timeoutSeconds * 1000,
    );
    stream =
      target.protocol === 'https:'
        ? tls.connect({
            socket,
            servername: target.hostname,
            rejectUnauthorized: true,
          })
        : socket;
    if (target.protocol === 'https:') {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('TLS handshake timed out')),
          timeoutSeconds * 1000,
        );
        stream.once('secureConnect', () => {
          clearTimeout(timeout);
          resolve();
        });
        stream.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    }
    const response = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('HTTP probe timed out')),
        timeoutSeconds * 1000,
      );
      stream.once('data', (chunk) => {
        clearTimeout(timeout);
        const firstLine = chunk.toString('utf8').split('\r\n')[0];
        const match = firstLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
        if (!match)
          reject(new Error('Probe URL returned no valid HTTP response'));
        else resolve(Number(match[1]));
      });
      stream.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    stream.write(
      `GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\nUser-Agent: KitsuneGate/0.1\r\nConnection: close\r\n\r\n`,
    );
    const statusCode = await response;
    return {
      ok: statusCode >= 200 && statusCode < 500,
      statusCode,
      latencyMs: performance.now() - started,
      url: probeUrl,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: null,
      url: probeUrl,
      error: error instanceof Error ? error.message : 'Unknown probe error',
    };
  } finally {
    stream?.destroy();
    socket?.destroy();
  }
}

class RelayRuntime {
  constructor() {
    this.coreProcess = null;
    this.haproxyProcess = null;
    this.servers = new Map();
    this.metrics = new Map();
    this.status = 'stopped';
    this.version = null;
    this.lastError = null;
    this.startedAt = null;
    this.reloading = false;
    this.healthTimer = null;
    this.sampleTimer = null;
    this.cleanupTimer = null;
    this.sampling = false;
    this.lastProbeAt = new Map();
    this.selectedByGroup = new Map();
    this.groupTests = new Map();
    this.haproxyVersion = null;
    this.useHAProxy = false;
    this.lastMetricsErrorAt = 0;
  }

  writeLog(source, level, message) {
    const clean = String(message)
      .split(String.fromCharCode(27))
      .map((part, index) => (index ? part.replace(/^\[[0-9;]*m/, '') : part))
      .join('')
      .trim();
    if (!clean) return;
    addRuntimeLog(source, level, clean);
  }

  async start() {
    await this.reload('Application startup');
    this.healthTimer = setInterval(
      () =>
        void this.runScheduledHealthChecks().catch((error) => {
          this.writeLog(
            'engine',
            'error',
            `Scheduled health check failed: ${error.message}`,
          );
        }),
      5000,
    );
    this.applySettings();
    this.cleanupTimer = setInterval(() => {
      try {
        cleanupMonitoringData();
      } catch (error) {
        this.writeLog(
          'engine',
          'error',
          `Monitoring cleanup failed: ${error.message}`,
        );
      }
    }, 60_000);
    void this.sampleTraffic().catch((error) =>
      this.writeLog(
        'engine',
        'error',
        `Traffic sampling failed: ${error.message}`,
      ),
    );
  }

  applySettings() {
    clearInterval(this.sampleTimer);
    const { metricsSampleIntervalSeconds } = getSettings();
    this.sampleTimer = setInterval(
      () =>
        void this.sampleTraffic().catch((error) => {
          this.writeLog(
            'engine',
            'error',
            `Traffic sampling failed: ${error.message}`,
          );
        }),
      metricsSampleIntervalSeconds * 1000,
    );
    return getSettings();
  }

  async stop() {
    clearInterval(this.healthTimer);
    clearInterval(this.sampleTimer);
    clearInterval(this.cleanupTimer);
    for (const entry of this.servers.values()) entry.server.close();
    this.servers.clear();
    if (this.coreProcess) {
      this.coreProcess.kill('SIGTERM');
      this.coreProcess = null;
    }
    if (this.haproxyProcess) {
      this.haproxyProcess.kill('SIGTERM');
      this.haproxyProcess = null;
    }
    this.status = 'stopped';
  }

  async reload(reason = 'Configuration update') {
    if (this.reloading) return this.getStatus();
    this.reloading = true;
    try {
      this.status = 'reloading';
      for (const entry of this.servers.values()) entry.server.close();
      this.servers.clear();
      if (this.coreProcess) {
        this.coreProcess.kill('SIGTERM');
        this.coreProcess = null;
      }
      if (this.haproxyProcess) {
        this.haproxyProcess.kill('SIGTERM');
        this.haproxyProcess = null;
      }

      const binary = executablePath();
      if (!binary) {
        this.status = 'missing';
        this.lastError = `${executableName} was not found; run npm run core:install`;
        this.writeLog('engine', 'error', this.lastError);
        return this.getStatus();
      }

      const groups = getRawStateForEngine();
      const haproxyBinary =
        (process.env.KITSUNEGATE_BALANCER ?? process.env.RELAYDECK_BALANCER) ===
        'builtin'
          ? null
          : haproxyExecutablePath();
      this.useHAProxy = Boolean(haproxyBinary);
      const currentGroupIds = new Set(groups.map((group) => group.id));
      for (const groupId of this.metrics.keys()) {
        if (!currentGroupIds.has(groupId)) this.metrics.delete(groupId);
      }
      for (const groupId of this.lastProbeAt.keys()) {
        if (!currentGroupIds.has(groupId)) this.lastProbeAt.delete(groupId);
      }
      for (const groupId of this.selectedByGroup.keys()) {
        if (!currentGroupIds.has(groupId)) this.selectedByGroup.delete(groupId);
      }
      for (const group of groups.filter((item) => item.enabled)) {
        if (!this.metrics.has(group.id))
          this.metrics.set(
            group.id,
            freshMetrics(getLatestTrafficTotals(group.id)),
          );
        const metrics = this.metrics.get(group.id);
        metrics.haproxyInitialized = false;
        metrics.haproxyRawBytesIn = 0;
        metrics.haproxyRawBytesOut = 0;
        metrics.haproxyRawConnections = 0;
        metrics.previousBytesIn = metrics.bytesIn;
        metrics.previousBytesOut = metrics.bytesOut;
        metrics.previousAt = Date.now();
        metrics.speedIn = 0;
        metrics.speedOut = 0;
      }
      fs.writeFileSync(
        configPath,
        renderSingBoxConfig(groups, { logLevel: getSettings().logLevel }),
        'utf8',
      );
      if (this.useHAProxy) {
        fs.mkdirSync(path.dirname(haproxySocketPath), { recursive: true });
        fs.rmSync(haproxySocketPath, { force: true });
        fs.writeFileSync(
          haproxyConfigPath,
          renderHAProxyConfig(groups, { statsSocket: haproxySocketPath }),
          'utf8',
        );
      }
      try {
        const versionResult = await execFileAsync(binary, ['version'], {
          windowsHide: true,
        });
        this.version =
          versionResult.stdout.split(/\r?\n/)[0]?.trim() || 'unknown';
        await execFileAsync(binary, ['check', '-c', configPath], {
          windowsHide: true,
        });
        if (this.useHAProxy) {
          const haproxyVersionResult = await execFileAsync(
            haproxyBinary,
            ['-v'],
            { windowsHide: true },
          );
          this.haproxyVersion =
            haproxyVersionResult.stdout.split(/\r?\n/)[0]?.trim() || 'unknown';
          await execFileAsync(haproxyBinary, ['-c', '-f', haproxyConfigPath], {
            windowsHide: true,
          });
        }
      } catch (error) {
        this.status = 'error';
        this.lastError = error.stderr || error.message;
        this.writeLog(
          'sing-box',
          'error',
          `Configuration validation failed: ${this.lastError}`,
        );
        return this.getStatus();
      }

      const processInstance = spawn(binary, ['run', '-c', configPath], {
        cwd: generatedDirectory,
        windowsHide: true,
      });
      this.coreProcess = processInstance;
      processInstance.stdout.on('data', (chunk) =>
        chunk
          .toString()
          .split(/\r?\n/)
          .forEach((line) => this.writeLog('sing-box', logLevel(line), line)),
      );
      processInstance.stderr.on('data', (chunk) =>
        chunk
          .toString()
          .split(/\r?\n/)
          .forEach((line) => this.writeLog('sing-box', logLevel(line), line)),
      );
      processInstance.on('exit', (code) => {
        if (this.coreProcess === processInstance && this.status === 'running') {
          this.status = 'error';
          this.lastError = `sing-box exited unexpectedly with code ${code}`;
          this.writeLog('sing-box', 'error', this.lastError);
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      if (this.coreProcess.exitCode !== null)
        throw new Error(
          `sing-box failed to start with code ${this.coreProcess.exitCode}`,
        );
      if (this.useHAProxy) {
        const haproxyProcess = spawn(
          haproxyBinary,
          ['-W', '-db', '-f', haproxyConfigPath],
          { cwd: generatedDirectory },
        );
        this.haproxyProcess = haproxyProcess;
        haproxyProcess.stdout.on('data', (chunk) =>
          chunk
            .toString()
            .split(/\r?\n/)
            .forEach((line) => this.writeLog('haproxy', logLevel(line), line)),
        );
        haproxyProcess.stderr.on('data', (chunk) =>
          chunk
            .toString()
            .split(/\r?\n/)
            .forEach((line) => this.writeLog('haproxy', logLevel(line), line)),
        );
        haproxyProcess.on('exit', (code) => {
          if (
            this.haproxyProcess === haproxyProcess &&
            this.status === 'running'
          ) {
            this.status = 'error';
            this.lastError = `HAProxy exited unexpectedly with code ${code}`;
            this.writeLog('haproxy', 'error', this.lastError);
          }
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (this.haproxyProcess.exitCode !== null)
          throw new Error(
            `HAProxy failed to start with code ${this.haproxyProcess.exitCode}`,
          );
      } else {
        for (const group of groups.filter((item) => item.enabled))
          this.createGroupServer(group);
      }
      this.status = 'running';
      this.lastError = null;
      this.startedAt = new Date().toISOString();
      this.writeLog(
        'engine',
        'info',
        `${reason}: sing-box and ${this.useHAProxy ? 'HAProxy' : 'the built-in load balancer'} started (${os.platform()} ${os.arch()})`,
      );
      if (!this.useHAProxy)
        this.writeLog(
          'haproxy',
          'warning',
          'HAProxy was not found or built-in mode is selected; the KitsuneGate TCP balancer is routing listener ports.',
        );
      void this.testAll().catch((error) =>
        this.writeLog(
          'engine',
          'error',
          `Health check startup failed: ${error.message}`,
        ),
      );
      return this.getStatus();
    } catch (error) {
      this.status = 'error';
      this.lastError =
        error instanceof Error ? error.message : 'Engine startup failed';
      this.writeLog('engine', 'error', this.lastError);
      return this.getStatus();
    } finally {
      this.reloading = false;
    }
  }

  createGroupServer(group) {
    const metrics = this.metrics.get(group.id) ?? freshMetrics();
    this.metrics.set(group.id, metrics);
    const server = net.createServer((client) => {
      const node = this.selectNode(group, metrics);
      if (!node) {
        this.writeLog(
          'balancer',
          'error',
          `${group.name} has no available nodes; rejected connection from ${client.remoteAddress ?? 'unknown'}.`,
        );
        client.destroy();
        return;
      }
      const upstream = net.createConnection({
        host: '127.0.0.1',
        port: node.adapter_port,
      });
      metrics.activeConnections += 1;
      metrics.totalConnections += 1;
      metrics.nodeConnections.set(
        node.id,
        (metrics.nodeConnections.get(node.id) ?? 0) + 1,
      );
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        metrics.activeConnections = Math.max(0, metrics.activeConnections - 1);
        metrics.nodeConnections.set(
          node.id,
          Math.max(0, (metrics.nodeConnections.get(node.id) ?? 1) - 1),
        );
      };
      client.on('data', (chunk) => {
        metrics.bytesIn += chunk.length;
      });
      upstream.on('data', (chunk) => {
        metrics.bytesOut += chunk.length;
      });
      upstream.on('error', (error) => {
        this.writeLog(
          'balancer',
          'error',
          `${group.name} → ${node.name} connection failed: ${error.message}`,
        );
        client.destroy();
        finish();
      });
      client.on('error', finish);
      client.on('close', finish);
      upstream.on('close', finish);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    server.on('error', (error) =>
      this.writeLog(
        'balancer',
        'error',
        `${group.name} failed to listen on ${group.listen_host}:${group.listen_port}: ${error.message}`,
      ),
    );
    server.listen(group.listen_port, group.listen_host, () =>
      this.writeLog(
        'balancer',
        'info',
        `${group.name} is listening on ${group.listen_host}:${group.listen_port} in ${group.mode} mode.`,
      ),
    );
    this.servers.set(group.id, { server, group });
  }

  haproxyCommand(command, timeoutMs = 2000) {
    if (!this.useHAProxy || !this.haproxyProcess) return Promise.resolve('');
    return new Promise((resolve, reject) => {
      let output = '';
      const socket = net.createConnection({ path: haproxySocketPath });
      const timeout = setTimeout(
        () => socket.destroy(new Error('HAProxy Runtime API timed out')),
        timeoutMs,
      );
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.end(`${command}\n`));
      socket.on('data', (chunk) => {
        output += chunk;
      });
      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.on('close', () => {
        clearTimeout(timeout);
        resolve(output);
      });
    });
  }

  async syncHAProxyGroup(groupId) {
    if (!this.useHAProxy || this.status !== 'running') return;
    const group = getRawStateForEngine().find((item) => item.id === groupId);
    if (!group?.enabled) return;
    const enabled = group.nodes.filter((node) => node.enabled);
    const available = enabled.filter(
      (node) => node.health_status !== 'unhealthy',
    );
    let allowed = new Set(available.map((node) => node.id));
    if (group.mode === 'fixed') {
      allowed = new Set(
        available.some((node) => node.id === group.selected_node_id)
          ? [group.selected_node_id]
          : [],
      );
    } else if (group.mode === 'latency_best' && available.length) {
      const best = [...available].sort(
        (a, b) =>
          (a.latency_ms ?? Number.MAX_SAFE_INTEGER) -
          (b.latency_ms ?? Number.MAX_SAFE_INTEGER),
      )[0];
      const current = available.find(
        (node) =>
          node.id ===
          (this.selectedByGroup.get(group.id) ?? group.selected_node_id),
      );
      const selected =
        current &&
        (current.latency_ms ?? Number.MAX_SAFE_INTEGER) <=
          (best.latency_ms ?? Number.MAX_SAFE_INTEGER) + group.latency_tolerance
          ? current
          : best;
      this.selectedByGroup.set(group.id, selected.id);
      allowed = new Set([selected.id]);
    }
    await Promise.all(
      enabled.map(async (node) => {
        const command = allowed.has(node.id) ? 'enable' : 'disable';
        try {
          await this.haproxyCommand(
            `${command} server pool_${haproxyName(group.id)}/${haproxyName(node.id)}`,
          );
        } catch (error) {
          this.writeLog(
            'haproxy',
            'warning',
            `Failed to synchronize node ${node.name}: ${error.message}`,
          );
        }
      }),
    );
  }

  async refreshHAProxyMetrics() {
    if (!this.useHAProxy || this.status !== 'running') return;
    let output;
    let sessionOutput = '';
    try {
      output = await this.haproxyCommand('show stat', 3000);
      sessionOutput = await this.haproxyCommand('show sess all', 3000);
      this.lastMetricsErrorAt = 0;
    } catch (error) {
      const timestamp = Date.now();
      if (
        !this.lastMetricsErrorAt ||
        timestamp - this.lastMetricsErrorAt >= 30_000
      ) {
        this.writeLog(
          'haproxy',
          'warning',
          `Failed to read statistics: ${error.message} (duplicate errors are suppressed for 30 seconds)`,
        );
        this.lastMetricsErrorAt = timestamp;
      }
      return;
    }
    const lines = output.trim().split(/\r?\n/);
    const header = lines.shift()?.replace(/^#\s*/, '').split(',') ?? [];
    const position = Object.fromEntries(
      header.map((name, index) => [name, index]),
    );
    const groupsByProxy = new Map(
      getRawStateForEngine().map((group) => [
        `pool_${haproxyName(group.id)}`,
        group,
      ]),
    );
    const activeSessionBytes = parseHAProxyActiveSessionBytes(sessionOutput);
    for (const line of lines) {
      if (!line) continue;
      const values = line.split(',');
      if (values[position.svname] !== 'FRONTEND') continue;
      const group = groupsByProxy.get(values[position.pxname]);
      if (!group) continue;
      const metrics = this.metrics.get(group.id) ?? freshMetrics();
      const activeBytes = activeSessionBytes.get(values[position.pxname]) ?? {
        bytesIn: 0,
        bytesOut: 0,
      };
      // HAProxy normally commits bin/bout when a TCP stream closes. Add the
      // in-flight stream totals so long downloads and persistent tunnels are
      // visible during the transfer instead of appearing as a spike at close.
      const rawBytesIn =
        Number(values[position.bin] || 0) + activeBytes.bytesIn;
      const rawBytesOut =
        Number(values[position.bout] || 0) + activeBytes.bytesOut;
      const rawConnections = Number(values[position.stot] || 0);
      if (!metrics.haproxyInitialized) {
        metrics.haproxyRawBytesIn = rawBytesIn;
        metrics.haproxyRawBytesOut = rawBytesOut;
        metrics.haproxyRawConnections = rawConnections;
        metrics.haproxyInitialized = true;
        metrics.activeConnections = Number(values[position.scur] || 0);
        this.metrics.set(group.id, metrics);
        continue;
      }
      // The two runtime commands are adjacent rather than an atomic snapshot.
      // If a stream closes between them, the combined observation can briefly
      // fall before the settled stat catches up. A monotonic baseline prevents
      // those same bytes from being counted again on the following sample.
      const inputCounter = advanceMonotonicCounter(
        metrics.haproxyRawBytesIn,
        rawBytesIn,
      );
      const outputCounter = advanceMonotonicCounter(
        metrics.haproxyRawBytesOut,
        rawBytesOut,
      );
      metrics.bytesIn += inputCounter.delta;
      metrics.bytesOut += outputCounter.delta;
      metrics.totalConnections += Math.max(
        0,
        rawConnections - metrics.haproxyRawConnections,
      );
      metrics.haproxyRawBytesIn = inputCounter.current;
      metrics.haproxyRawBytesOut = outputCounter.current;
      metrics.haproxyRawConnections = rawConnections;
      metrics.activeConnections = Number(values[position.scur] || 0);
      this.metrics.set(group.id, metrics);
    }
  }

  selectNode(group, metrics) {
    group =
      getRawStateForEngine().find((item) => item.id === group.id) ?? group;
    const enabled = group.nodes.filter((node) => node.enabled);
    const healthy = enabled.filter(
      (node) => node.health_status !== 'unhealthy',
    );
    const candidates = healthy.length ? healthy : enabled;
    if (!candidates.length) return null;
    if (group.mode === 'fixed')
      return (
        candidates.find((node) => node.id === group.selected_node_id) ?? null
      );
    if (group.mode === 'fallback')
      return [...candidates].sort((a, b) => a.priority - b.priority)[0];
    if (group.mode === 'latency_best') {
      const best = [...candidates].sort(
        (a, b) =>
          (a.latency_ms ?? Number.MAX_SAFE_INTEGER) -
          (b.latency_ms ?? Number.MAX_SAFE_INTEGER),
      )[0];
      const current = candidates.find(
        (node) =>
          node.id ===
          (this.selectedByGroup.get(group.id) ?? group.selected_node_id),
      );
      if (
        current &&
        (current.latency_ms ?? Number.MAX_SAFE_INTEGER) <=
          (best.latency_ms ?? Number.MAX_SAFE_INTEGER) + group.latency_tolerance
      )
        return current;
      this.selectedByGroup.set(group.id, best.id);
      return best;
    }
    if (group.algorithm === 'random') {
      const total = candidates.reduce((sum, node) => sum + node.weight, 0);
      let pick = Math.random() * total;
      return (
        candidates.find((node) => (pick -= node.weight) <= 0) ?? candidates[0]
      );
    }
    if (group.algorithm === 'roundrobin') {
      const weighted = candidates.flatMap((node) =>
        Array(Math.max(1, Math.min(32, node.weight))).fill(node),
      );
      return weighted[metrics.roundRobin++ % weighted.length];
    }
    return [...candidates].sort(
      (a, b) =>
        ((metrics.nodeConnections.get(a.id) ?? 0) + 1) / a.weight -
        ((metrics.nodeConnections.get(b.id) ?? 0) + 1) / b.weight,
    )[0];
  }

  async testNode(id, syncHAProxy = true) {
    const rawGroups = getRawStateForEngine();
    const group = rawGroups.find((item) =>
      item.nodes.some((node) => node.id === id),
    );
    const node = group?.nodes.find((item) => item.id === id);
    if (!group || !node) throw new Error('Node not found.');
    if (!node.enabled)
      return {
        ...getNode(id),
        probe: {
          ok: false,
          statusCode: null,
          latencyMs: null,
          url: group.probe_urls[0],
          error: 'Node is disabled',
        },
      };
    let probe;
    const attempts = [];
    for (const probeUrl of group.probe_urls) {
      probe = await probeThroughNode(node, probeUrl, group.probe_timeout);
      attempts.push(probe);
      if (probe.ok) break;
    }
    const recorded = recordNodeHealth(id, { ...probe, attempts });
    if (syncHAProxy) await this.syncHAProxyGroup(group.id);
    return recorded;
  }

  async testGroup(id) {
    if (this.groupTests.has(id)) return this.groupTests.get(id);
    const pending = this.performGroupTest(id).finally(() =>
      this.groupTests.delete(id),
    );
    this.groupTests.set(id, pending);
    return pending;
  }

  async performGroupTest(id) {
    const group = getRawStateForEngine().find((item) => item.id === id);
    if (!group) throw new Error('Proxy group not found.');
    const started = Date.now();
    const results = await Promise.all(
      group.nodes
        .filter((node) => node.enabled)
        .map((node) => this.testNode(node.id, false)),
    );
    await this.syncHAProxyGroup(id);
    return {
      groupId: id,
      groupName: group.name,
      durationMs: Date.now() - started,
      probeUrl: group.probe_urls.join(' · '),
      results,
    };
  }

  async testAll() {
    const groups = getRawStateForEngine().filter((group) => group.enabled);
    return Promise.all(groups.map((group) => this.testGroup(group.id)));
  }

  async runScheduledHealthChecks() {
    if (this.status !== 'running') return;
    const now = Date.now();
    for (const group of getRawStateForEngine().filter((item) => item.enabled)) {
      const last = this.lastProbeAt.get(group.id) ?? 0;
      if (now - last >= group.probe_interval * 1000) {
        this.lastProbeAt.set(group.id, now);
        void this.testGroup(group.id).catch((error) => {
          this.writeLog(
            'engine',
            'error',
            `Scheduled check for proxy group “${group.name}” failed: ${error.message}`,
          );
        });
      }
    }
  }

  async sampleTraffic() {
    if (this.sampling) return;
    this.sampling = true;
    try {
      await this.refreshHAProxyMetrics();
      const timestamp = Date.now();
      for (const [groupId, metrics] of this.metrics) {
        const intervalMs = Math.max(100, timestamp - metrics.previousAt);
        const seconds = intervalMs / 1000;
        metrics.speedIn =
          Math.max(0, metrics.bytesIn - metrics.previousBytesIn) / seconds;
        metrics.speedOut =
          Math.max(0, metrics.bytesOut - metrics.previousBytesOut) / seconds;
        metrics.previousBytesIn = metrics.bytesIn;
        metrics.previousBytesOut = metrics.bytesOut;
        metrics.previousAt = timestamp;
        metrics.intervalMs = intervalMs;
        addTrafficSample(groupId, metrics);
      }
    } finally {
      this.sampling = false;
    }
  }

  getMetrics() {
    return Object.fromEntries(
      [...this.metrics].map(([groupId, value]) => [
        groupId,
        {
          bytesIn: value.bytesIn,
          bytesOut: value.bytesOut,
          speedIn: value.speedIn,
          speedOut: value.speedOut,
          activeConnections: value.activeConnections,
          totalConnections: value.totalConnections,
        },
      ]),
    );
  }

  getStatus() {
    return {
      status: this.status,
      mode: this.status === 'running' ? 'real' : 'unavailable',
      singbox: this.status === 'running',
      haproxy: this.status === 'running' && this.useHAProxy,
      balancer:
        this.status === 'running'
          ? this.useHAProxy
            ? 'haproxy'
            : 'builtin'
          : null,
      version: this.version,
      haproxyVersion: this.haproxyVersion,
      startedAt: this.startedAt,
      lastError: this.lastError,
      configPath,
    };
  }
}

export const runtime = new RelayRuntime();
