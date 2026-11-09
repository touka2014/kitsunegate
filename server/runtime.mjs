import fs from 'node:fs';
import net from 'node:net';
import { probeTarget } from './probes.mjs';
import { alive, discard, listen, prepare } from './generation.mjs';
import path from 'node:path';
import tls from 'node:tls';

import {
  db,
  addRuntimeLog,
  addTrafficSample,
  cleanupMonitoringData,
  getLatestTrafficTotals,
  getSettings,
  getNode,
  getRawStateForEngine,
  recordNodeHealth,
} from './database.mjs';

import {
  advanceMonotonicCounter,
  parseHAProxyActiveSessionBytes,
} from './monitoring.mjs';

const runtimeDirectory = path.resolve(
  process.env.KITSUNEGATE_RUNTIME_DIR ??
    process.env.RELAYDECK_RUNTIME_DIR ??
    'runtime',
);
const generatedDirectory = path.join(runtimeDirectory, 'generated');
const executableName =
  process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
const bundledExecutable = path.join(runtimeDirectory, 'bin', executableName);

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
  try {
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
      throw new Error(
        `SOCKS5 target connection failed with code ${response[1]}`,
      );
    socket.setTimeout(0);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function probeThroughNode(node, probeUrl, timeoutSeconds) {
  const started = performance.now();
  let socket;
  let stream;
  try {
    const { url: target, expected } = probeTarget(probeUrl);
    probeUrl = target.href;
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
      let line = '';
      stream.on('data', function readLine(chunk) {
        line += chunk.toString('latin1', 0, Math.min(chunk.length, 8193));
        const end = line.indexOf('\r\n');
        if (end < 0 && line.length <= 8192) return;
        stream.off('data', readLine);
        clearTimeout(timeout);
        const match =
          end >= 0 &&
          end <= 8192 &&
          /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s|$)/.exec(line.slice(0, end));
        if (!match) reject(new Error('Invalid HTTP status line'));
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
    const ok =
      expected === null
        ? statusCode >= 200 && statusCode < 300
        : statusCode === expected;
    return {
      ok,
      statusCode,
      latencyMs: performance.now() - started,
      url: probeUrl,
      error: ok ? null : `HTTP ${statusCode}; expected ${expected ?? '2xx'}`,
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
    this.queue = Promise.resolve();
    this.retired = new Set();
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
    try {
      await this.reload('Application startup');
    } catch (error) {
      this.status = 'error';
      this.lastError = error.message;
      this.writeLog('engine', 'error', error.message);
    }
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
    this.stopping = true;
    await this.queue;
    for (const entry of this.servers.values()) entry.server.close();
    this.servers.clear();
    const generations = [this.generation, ...this.retired];
    this.generation = null;
    this.retired.clear();
    await Promise.all(generations.map(discard));
    this.status = 'stopped';
  }

  groups() {
    const groups = getRawStateForEngine();
    for (const group of groups)
      for (const node of group.nodes) {
        node.adapter_port =
          this.generation?.ports.get(node.id) ?? node.adapter_port;
      }
    return groups;
  }

  async retire(gen) {
    gen.retired = true;
    this.retired.add(gen);
    const finish = () => {
      if (this.retired.delete(gen))
        void discard(gen).catch((error) =>
          this.writeLog('engine', 'warning', error.message),
        );
    };
    gen.finish = finish;
    if (alive(gen.haproxy)) {
      gen.haproxy.once('exit', finish);
      // Stop accepting on the old frontends while retaining the statistics socket
      // until the last established stream has closed and its bytes are recorded.
      try {
        for (const id of gen.frontends) {
          const reply = await this.haproxyCommand(
            'shutdown frontend pool_' + haproxyName(id),
            2000,
            gen,
          );
          if (/error|unknown|can't|not found/i.test(reply))
            throw new Error(reply.trim());
        }
        gen.draining = true;
      } catch (error) {
        this.writeLog(
          'haproxy',
          'warning',
          'Could not collect draining counters: ' + error.message,
        );
        gen.haproxy.kill('SIGUSR1');
      }
    } else if (!gen.clients) finish();
  }

  reload(reason, mutate, requiresReload = () => true) {
    const task = this.queue.then(() =>
      this.apply(reason, mutate, requiresReload),
    );
    this.queue = task.catch(() => {});
    return task;
  }

  async apply(reason, mutate, requiresReload) {
    if (this.stopping) throw new Error('Engine is shutting down.');
    // Stage the SQL mutation synchronously, snapshot its candidate, then release
    // the database before starting any asynchronous subprocess or listener work.
    let groups, settings, candidateResult;
    const previousSettings = getSettings();
    db.exec('SAVEPOINT candidate');
    try {
      candidateResult = mutate?.();
      groups = getRawStateForEngine();
      settings = getSettings();
    } finally {
      db.exec('ROLLBACK TO candidate; RELEASE candidate');
    }
    const commit = () => {
      db.exec('BEGIN');
      try {
        const result = mutate?.();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    };
    if (!requiresReload(previousSettings, settings)) return commit();
    const previous = this.generation;
    const haproxyBinary =
      (process.env.KITSUNEGATE_BALANCER ?? process.env.RELAYDECK_BALANCER) ===
      'builtin'
        ? null
        : haproxyExecutablePath();
    const gen = await prepare(groups, {
      directory: generatedDirectory,
      socketPath: haproxySocketPath,
      binary: executablePath(),
      haproxyBinary,
      previous,
      editedNodeId: candidateResult?.sourceType ? candidateResult.id : null,
      logLevel: settings.logLevel,
      log: (source, line) => this.writeLog(source, logLevel(line), line),
      onExit: (generation, source, code) => {
        if (this.generation === generation && !this.stopping) {
          this.status = 'error';
          this.lastError = source + ' exited with code ' + code;
          this.writeLog(source, 'error', this.lastError);
        }
      },
    });
    const listeners = new Map();
    const added = [];
    let result;
    try {
      if (!haproxyBinary)
        for (const group of groups.filter((g) => g.enabled)) {
          const key = group.listen_host + ':' + group.listen_port;
          let entry = this.servers.get(key);
          if (!entry) {
            entry = this.createGroupServer(group);
            added.push(entry);
            await listen(entry.server, group.listen_port, group.listen_host);
          }
          listeners.set(key, { entry, group });
        }
      if (!alive(gen.core) || (haproxyBinary && !alive(gen.haproxy)))
        throw new Error(
          'Configuration rejected: candidate core exited before activation.',
        );
      result = commit();
    } catch (error) {
      for (const entry of added) entry.server.close();
      await discard(gen);
      throw error;
    }
    for (const [key, entry] of this.servers)
      if (!listeners.has(key)) entry.server.close();
    this.servers.clear();
    for (const [key, { entry, group }] of listeners) {
      entry.group = group;
      this.servers.set(key, entry);
    }
    this.generation = gen;
    this.coreProcess = gen.core;
    this.haproxyProcess = gen.haproxy;
    this.useHAProxy = !!haproxyBinary;
    this.version = gen.version;
    this.haproxyVersion = gen.haproxyVersion;
    this.metrics = new Map(
      groups
        .filter((g) => g.enabled)
        .map((g) => {
          const m =
            this.metrics.get(g.id) ??
            freshMetrics(getLatestTrafficTotals(g.id));
          return [g.id, m];
        }),
    );
    this.status = 'running';
    this.lastError = null;
    this.startedAt = new Date().toISOString();
    if (previous) await this.retire(previous);
    this.writeLog('engine', 'info', reason + ' applied.');
    this.groupTests.clear();
    void this.testAll().catch((error) =>
      this.writeLog('engine', 'warning', error.message),
    );
    return mutate ? result : this.getStatus();
  }

  createGroupServer(initialGroup) {
    const entry = { group: initialGroup };

    const server = net.createServer((client) => {
      const group = entry.group,
        generation = this.generation,
        metrics = this.metrics.get(group.id);
      if (!generation || !metrics) {
        client.destroy();
        return;
      }
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
      generation.clients++;
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
        generation.clients--;
        if (generation.retired && !generation.clients) generation.finish();
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
      this.writeLog('balancer', 'error', error.message),
    );
    entry.server = server;
    return entry;
  }

  haproxyCommand(command, timeoutMs = 2000, generation = this.generation) {
    if (!this.useHAProxy || !this.haproxyProcess) return Promise.resolve('');
    return new Promise((resolve, reject) => {
      let output = '';
      const socket = net.createConnection({ path: generation.socket });
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
    const group = this.groups().find((item) => item.id === groupId);
    if (!group?.enabled) return;
    const enabled = group.nodes.filter(
      (node) =>
        node.enabled &&
        (group.mode !== 'fixed' || node.id === group.selected_node_id),
    );
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
    if (!this.useHAProxy || this.status !== 'running') return false;
    const current = this.generation;
    const connections = new Map();
    try {
      for (const gen of [current, ...this.retired]) {
        if (!gen.haproxy || (gen.retired && !gen.draining)) continue;
        const output = await this.haproxyCommand('show stat', 3000, gen);
        const sessions = parseHAProxyActiveSessionBytes(
          await this.haproxyCommand('show sess all', 3000, gen),
        );
        if (!output.trim())
          throw new Error('Empty HAProxy statistics response');
        const [header, ...lines] = output.trim().split(/\r?\n/);
        const col = Object.fromEntries(
          header
            .replace(/^#\s*/, '')
            .split(',')
            .map((key, i) => [key, i]),
        );
        let open = 0;
        for (const line of lines) {
          const fields = line.split(',');
          if (fields[col.svname] !== 'FRONTEND') continue;
          const proxy = fields[col.pxname],
            id = proxy.slice('pool_'.length);
          if (!proxy.startsWith('pool_')) continue;
          const active = Number(fields[col.scur]);
          open += active;
          connections.set(id, (connections.get(id) ?? 0) + active);
          const metrics = this.metrics.get(id);
          if (!metrics) continue;
          const inFlight = sessions.get(proxy);
          const prev = gen.counters.get(id) ?? {
            input: 0,
            output: 0,
            connections: 0,
          };
          const input = advanceMonotonicCounter(
            prev.input,
            Number(fields[col.bin]) + (inFlight?.bytesIn ?? 0),
          );
          const out = advanceMonotonicCounter(
            prev.output,
            Number(fields[col.bout]) + (inFlight?.bytesOut ?? 0),
          );
          const total = Number(fields[col.stot]);
          metrics.bytesIn += input.delta;
          metrics.bytesOut += out.delta;
          metrics.totalConnections += Math.max(0, total - prev.connections);
          gen.counters.set(id, {
            input: input.current,
            output: out.current,
            connections: total,
          });
        }
        if (gen.draining && !open) gen.finish();
      }
      if (current !== this.generation) return false;
      for (const [id, m] of this.metrics)
        m.activeConnections = connections.get(id) ?? 0;
      this.lastMetricsErrorAt = 0;
      return true;
    } catch (error) {
      if (
        !this.lastMetricsErrorAt ||
        Date.now() - this.lastMetricsErrorAt >= 30000
      ) {
        this.writeLog(
          'haproxy',
          'warning',
          'Failed to read statistics: ' + error.message,
        );
        this.lastMetricsErrorAt = Date.now();
      }
      return false;
    }
  }

  selectNode(group, metrics) {
    group = this.groups().find((item) => item.id === group.id) ?? group;
    const enabled = group.nodes.filter((node) => node.enabled);
    const candidates = enabled.filter(
      (node) => node.health_status !== 'unhealthy',
    );
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

  async testNode(id, syncHAProxy = true, draft) {
    const generation = this.generation;
    const rawGroups = this.groups();
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
    for (const probeUrl of (draft ?? group).probe_urls) {
      probe = await probeThroughNode(
        node,
        probeUrl,
        (draft ?? group).probe_timeout,
      );
      attempts.push(probe);
      if (probe.ok) break;
    }
    if (generation !== this.generation || draft)
      return { ...getNode(id), probe: { ...probe, attempts } };
    const recorded = recordNodeHealth(id, { ...probe, attempts });
    if (syncHAProxy) await this.syncHAProxyGroup(group.id);
    return recorded;
  }

  async testGroup(id, draft) {
    if (draft) return this.performGroupTest(id, draft);
    if (this.groupTests.has(id)) return this.groupTests.get(id);
    const pending = this.performGroupTest(id).finally(
      () => this.groupTests.get(id) === pending && this.groupTests.delete(id),
    );
    this.groupTests.set(id, pending);
    return pending;
  }

  async performGroupTest(id, draft) {
    const group = this.groups().find((item) => item.id === id);
    if (!group) throw new Error('Proxy group not found.');
    const started = Date.now();
    const results = await Promise.all(
      group.nodes
        .filter((node) => node.enabled)
        .map((node) => this.testNode(node.id, false, draft)),
    );
    if (!draft) await this.syncHAProxyGroup(id);
    return {
      groupId: id,
      groupName: group.name,
      durationMs: Date.now() - started,
      probeUrl: (draft ?? group).probe_urls.join(' · '),
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
      if (
        this.status !== 'running' ||
        (this.useHAProxy && (await this.refreshHAProxyMetrics()) === false)
      ) {
        this.sampleGap = true;
        return;
      }
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
        if (!this.sampleGap) addTrafficSample(groupId, metrics);
      }
      this.sampleGap = false;
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
      configPath: this.generation?.coreFile ?? null,
    };
  }
}

export const runtime = new RelayRuntime();
