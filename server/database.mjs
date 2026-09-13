import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { decryptSecret, encryptSecret, maskProxyUri } from './crypto.mjs';
import { normalizeJsonConfig, normalizeManualConfig } from './node-config.mjs';
import {
  levelAllows,
  normalizeSettings,
  rangeDefinition,
} from './monitoring.mjs';

const dataDirectory = path.resolve(
  process.env.KITSUNEGATE_DATA_DIR ?? process.env.RELAYDECK_DATA_DIR ?? 'data',
);
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = path.join(dataDirectory, 'kitsunegate.db');
const legacyDatabasePath = path.join(dataDirectory, 'relaydeck.db');
if (!fs.existsSync(databasePath) && fs.existsSync(legacyDatabasePath)) {
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${legacyDatabasePath}${suffix}`;
    if (fs.existsSync(source))
      fs.renameSync(source, `${databasePath}${suffix}`);
  }
}
const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS proxy_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    region_code TEXT NOT NULL,
    listen_host TEXT NOT NULL DEFAULT '0.0.0.0',
    listen_port INTEGER NOT NULL UNIQUE CHECK (listen_port BETWEEN 1 AND 65535),
    mode TEXT NOT NULL CHECK (mode IN ('load_balance', 'fallback', 'latency_best', 'fixed')),
    algorithm TEXT NOT NULL CHECK (algorithm IN ('leastconn', 'roundrobin', 'random')),
    selected_node_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    probe_urls TEXT NOT NULL,
    probe_interval INTEGER NOT NULL DEFAULT 15,
    probe_timeout INTEGER NOT NULL DEFAULT 6,
    fall_threshold INTEGER NOT NULL DEFAULT 2,
    rise_threshold INTEGER NOT NULL DEFAULT 2,
    latency_tolerance INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS proxy_nodes (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES proxy_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL,
    server TEXT NOT NULL,
    server_port INTEGER NOT NULL,
    encrypted_uri TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'link',
    encrypted_config TEXT,
    adapter_port INTEGER NOT NULL UNIQUE,
    weight INTEGER NOT NULL DEFAULT 5 CHECK (weight BETWEEN 1 AND 256),
    priority INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    latency_ms INTEGER,
    last_error TEXT,
    last_checked_at TEXT,
    consecutive_success INTEGER NOT NULL DEFAULT 0,
    consecutive_failure INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT REFERENCES proxy_groups(id) ON DELETE CASCADE,
    node_id TEXT REFERENCES proxy_nodes(id) ON DELETE SET NULL,
    severity TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS runtime_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS traffic_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL REFERENCES proxy_groups(id) ON DELETE CASCADE,
    bytes_in INTEGER NOT NULL DEFAULT 0,
    bytes_out INTEGER NOT NULL DEFAULT 0,
    active_connections INTEGER NOT NULL DEFAULT 0,
    total_connections INTEGER NOT NULL DEFAULT 0,
    bytes_in_per_second REAL NOT NULL DEFAULT 0,
    bytes_out_per_second REAL NOT NULL DEFAULT 0,
    interval_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_proxy_nodes_group_priority
    ON proxy_nodes(group_id, priority);
  CREATE INDEX IF NOT EXISTS idx_events_created_at
    ON events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_group_created
    ON events(group_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runtime_logs_created
    ON runtime_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_runtime_logs_source_level_created
    ON runtime_logs(source, level, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_traffic_samples_group_created
    ON traffic_samples(group_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_traffic_samples_created
    ON traffic_samples(created_at DESC);
  PRAGMA optimize;
`);

const nodeColumns = db.prepare('PRAGMA table_info(proxy_nodes)').all();
if (!nodeColumns.some((column) => column.name === 'source_type')) {
  db.exec(
    "ALTER TABLE proxy_nodes ADD COLUMN source_type TEXT NOT NULL DEFAULT 'link'",
  );
}
if (!nodeColumns.some((column) => column.name === 'encrypted_config')) {
  db.exec('ALTER TABLE proxy_nodes ADD COLUMN encrypted_config TEXT');
}

const trafficColumns = db.prepare('PRAGMA table_info(traffic_samples)').all();
if (!trafficColumns.some((column) => column.name === 'bytes_in_per_second')) {
  db.exec(
    'ALTER TABLE traffic_samples ADD COLUMN bytes_in_per_second REAL NOT NULL DEFAULT 0',
  );
}
if (!trafficColumns.some((column) => column.name === 'bytes_out_per_second')) {
  db.exec(
    'ALTER TABLE traffic_samples ADD COLUMN bytes_out_per_second REAL NOT NULL DEFAULT 0',
  );
}
if (!trafficColumns.some((column) => column.name === 'interval_ms')) {
  db.exec(
    'ALTER TABLE traffic_samples ADD COLUMN interval_ms INTEGER NOT NULL DEFAULT 0',
  );
}
// Legacy rows only contain cumulative counters and cannot be converted into a
// trustworthy rate. Keeping them would draw a misleading flat line.
db.exec('DELETE FROM traffic_samples WHERE interval_ms = 0');

// Revision 2 fixes a race between HAProxy's settled counters and in-flight
// session counters. Earlier samples can contain double-counted close spikes,
// so discard only the derived telemetry once while preserving all user data.
const metricsCounterRevision = db
  .prepare(
    "SELECT value FROM app_settings WHERE key = 'metricsCounterRevision'",
  )
  .get();
if (metricsCounterRevision?.value !== '2') {
  db.exec('DELETE FROM traffic_samples');
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('metricsCounterRevision', '2', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(new Date().toISOString());
}

const now = () => new Date().toISOString();
const createId = (prefix) =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

function parseProxyUri(uri) {
  const trimmed = String(uri ?? '').trim();
  const match = trimmed.match(/^([a-zA-Z0-9+.-]+):\/\//);
  if (!match)
    throw new Error(
      'Node link must begin with vless://, ss://, trojan://, hysteria2://, or socks://.',
    );
  const protocol = match[1].toLowerCase();
  const supported = new Set([
    'vless',
    'vmess',
    'ss',
    'trojan',
    'hysteria2',
    'hy2',
    'socks',
    'socks5',
  ]);
  if (!supported.has(protocol))
    throw new Error(`Protocol ${protocol} is not supported.`);

  let server = '';
  let serverPort = 443;
  if (protocol === 'vmess') {
    try {
      const raw = Buffer.from(
        trimmed.slice('vmess://'.length).split('#')[0],
        'base64',
      ).toString('utf8');
      const config = JSON.parse(raw);
      server = config.add;
      serverPort = Number(config.port);
    } catch {
      throw new Error('The VMess link is invalid.');
    }
  } else if (protocol === 'ss') {
    const withoutHash = trimmed.split('#')[0];
    const at = withoutHash.lastIndexOf('@');
    if (at > -1) {
      const hostPart = withoutHash.slice(at + 1);
      const parsed = new URL(`tcp://${hostPart}`);
      server = parsed.hostname;
      serverPort = Number(parsed.port || 8388);
    } else {
      try {
        const decoded = Buffer.from(withoutHash.slice(5), 'base64').toString(
          'utf8',
        );
        const hostPort = decoded.split('@').pop();
        const parsed = new URL(`tcp://${hostPort}`);
        server = parsed.hostname;
        serverPort = Number(parsed.port || 8388);
      } catch {
        throw new Error('The Shadowsocks link is invalid.');
      }
    }
  } else {
    const parsed = new URL(trimmed);
    server = parsed.hostname;
    serverPort = Number(parsed.port || 443);
  }

  if (
    !server ||
    !Number.isInteger(serverPort) ||
    serverPort < 1 ||
    serverPort > 65535
  ) {
    throw new Error('The node server address or port is invalid.');
  }
  const label = decodeURIComponent(trimmed.split('#')[1] ?? '').trim();
  return {
    protocol:
      protocol === 'hy2'
        ? 'hysteria2'
        : protocol === 'socks5'
          ? 'socks'
          : protocol,
    server,
    serverPort,
    label,
  };
}

function nextAdapterPort() {
  const row = db
    .prepare('SELECT MAX(adapter_port) AS max_port FROM proxy_nodes')
    .get();
  return Math.max(12000, Number(row?.max_port ?? 12000)) + 1;
}

function addEvent({
  groupId = null,
  nodeId = null,
  severity = 'info',
  type,
  message,
}) {
  db.prepare(`
    INSERT INTO events (group_id, node_id, severity, event_type, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(groupId, nodeId, severity, type, message, now());
}

function insertGroup(group) {
  const id = group.id ?? createId('grp');
  const timestamp = now();
  db.prepare(`
    INSERT INTO proxy_groups (
      id, name, region_code, listen_host, listen_port, mode, algorithm,
      selected_node_id, enabled, probe_urls, probe_interval, probe_timeout,
      fall_threshold, rise_threshold, latency_tolerance, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    group.name,
    group.regionCode,
    group.listenHost ?? '0.0.0.0',
    Number(group.listenPort),
    group.mode ?? 'load_balance',
    group.algorithm ?? 'leastconn',
    group.selectedNodeId ?? null,
    group.enabled === false ? 0 : 1,
    JSON.stringify(
      group.probeUrls?.length
        ? group.probeUrls
        : ['https://www.gstatic.com/generate_204'],
    ),
    Number(group.probeInterval ?? 15),
    Number(group.probeTimeout ?? 6),
    Number(group.fallThreshold ?? 2),
    Number(group.riseThreshold ?? 2),
    Number(group.latencyTolerance ?? 100),
    timestamp,
    timestamp,
  );
  addEvent({
    groupId: id,
    type: 'group.created',
    message: `Created proxy group “${group.name}” on listener port ${group.listenPort}.`,
  });
  return id;
}

function prepareNodeInput(input, fallbackSource = 'link') {
  const sourceType = ['link', 'manual', 'json'].includes(input.sourceType)
    ? input.sourceType
    : input.manual
      ? 'manual'
      : input.json
        ? 'json'
        : 'link';
  let parsed;
  let encryptedUri = '';
  let encryptedConfig = null;
  if (sourceType === 'manual') {
    const config = normalizeManualConfig(input.manual);
    parsed = {
      protocol: config.protocol,
      server: config.server,
      serverPort: config.serverPort,
      label: '',
    };
    encryptedConfig = encryptSecret(JSON.stringify({ kind: 'manual', config }));
  } else if (sourceType === 'json') {
    const normalized = normalizeJsonConfig(input.json);
    parsed = {
      protocol: normalized.protocol,
      server: normalized.server,
      serverPort: normalized.serverPort,
      label: normalized.tag,
    };
    encryptedConfig = encryptSecret(JSON.stringify(normalized.payload));
  } else {
    parsed = parseProxyUri(input.uri);
    encryptedUri = encryptSecret(input.uri);
  }
  return {
    sourceType: sourceType || fallbackSource,
    parsed,
    encryptedUri,
    encryptedConfig,
  };
}

function insertNode(groupId, input) {
  const { sourceType, parsed, encryptedUri, encryptedConfig } =
    prepareNodeInput(input);
  const id = input.id ?? createId('node');
  const timestamp = now();
  const priorityRow = db
    .prepare(
      'SELECT COALESCE(MAX(priority), 0) + 1 AS priority FROM proxy_nodes WHERE group_id = ?',
    )
    .get(groupId);
  db.prepare(`
    INSERT INTO proxy_nodes (
      id, group_id, name, protocol, server, server_port, encrypted_uri,
      source_type, encrypted_config,
      adapter_port, weight, priority, enabled, health_status, latency_ms,
      last_error, last_checked_at, consecutive_success, consecutive_failure,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    groupId,
    input.name || parsed.label || `${parsed.protocol.toUpperCase()} node`,
    parsed.protocol,
    parsed.server,
    parsed.serverPort,
    encryptedUri,
    sourceType,
    encryptedConfig,
    Number(input.adapterPort ?? nextAdapterPort()),
    Number(input.weight ?? 5),
    Number(input.priority ?? priorityRow.priority),
    input.enabled === false ? 0 : 1,
    input.healthStatus ?? 'unknown',
    input.latencyMs ?? null,
    input.lastError ?? null,
    input.lastCheckedAt ?? null,
    0,
    0,
    timestamp,
    timestamp,
  );
  addEvent({
    groupId,
    nodeId: id,
    type: 'node.created',
    message: `Added node “${input.name || parsed.label || parsed.server}”.`,
  });
  return id;
}

function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM proxy_groups').get();
  if (count.count > 0) return;

  const groups = [
    {
      id: 'grp_us',
      name: 'United States Proxy',
      regionCode: 'US',
      listenPort: 1188,
      mode: 'load_balance',
      algorithm: 'leastconn',
      nodes: [
        [
          'node_us1',
          'US · IPLC 01',
          'vless://00000000-0000-0000-0000-000000000001@us1.example.com:443?security=tls#US-IPLC-01',
          10,
          82,
          'healthy',
        ],
        [
          'node_us2',
          'US · CN2 02',
          'ss://YWVzLTI1Ni1nY206cGFzcw@us2.example.com:8388#US-CN2-02',
          8,
          117,
          'healthy',
        ],
        [
          'node_us3',
          'US · BGP 03',
          'vless://00000000-0000-0000-0000-000000000003@us3.example.com:443?security=tls#US-BGP-03',
          5,
          196,
          'healthy',
        ],
        [
          'node_us4',
          'US · Edge 04',
          'ss://YWVzLTI1Ni1nY206cGFzcw@us4.example.com:8388#US-Edge-04',
          3,
          null,
          'unhealthy',
        ],
      ],
    },
    {
      id: 'grp_jp',
      name: 'Japan Proxy',
      regionCode: 'JP',
      listenPort: 2288,
      mode: 'fallback',
      algorithm: 'roundrobin',
      nodes: [
        [
          'node_jp1',
          'JP · Tokyo 01',
          'vless://00000000-0000-0000-0000-000000000011@jp1.example.com:443?security=tls#JP-Tokyo-01',
          10,
          64,
          'healthy',
        ],
        [
          'node_jp2',
          'JP · Tokyo 02',
          'ss://YWVzLTI1Ni1nY206cGFzcw@jp2.example.com:8388#JP-Tokyo-02',
          8,
          91,
          'healthy',
        ],
        [
          'node_jp3',
          'JP · Osaka 03',
          'vless://00000000-0000-0000-0000-000000000013@jp3.example.com:443?security=tls#JP-Osaka-03',
          5,
          108,
          'healthy',
        ],
        [
          'node_jp4',
          'JP · Osaka 04',
          'ss://YWVzLTI1Ni1nY206cGFzcw@jp4.example.com:8388#JP-Osaka-04',
          3,
          126,
          'healthy',
        ],
      ],
    },
    {
      id: 'grp_sg',
      name: 'Singapore Proxy',
      regionCode: 'SG',
      listenPort: 3388,
      mode: 'latency_best',
      algorithm: 'leastconn',
      selectedNodeId: 'node_sg1',
      nodes: [
        [
          'node_sg1',
          'SG · Core 01',
          'vless://00000000-0000-0000-0000-000000000021@sg1.example.com:443?security=tls#SG-Core-01',
          10,
          48,
          'healthy',
        ],
        [
          'node_sg2',
          'SG · Core 02',
          'ss://YWVzLTI1Ni1nY206cGFzcw@sg2.example.com:8388#SG-Core-02',
          8,
          71,
          'healthy',
        ],
        [
          'node_sg3',
          'SG · Edge 03',
          'vless://00000000-0000-0000-0000-000000000023@sg3.example.com:443?security=tls#SG-Edge-03',
          5,
          89,
          'healthy',
        ],
        [
          'node_sg4',
          'SG · Edge 04',
          'ss://YWVzLTI1Ni1nY206cGFzcw@sg4.example.com:8388#SG-Edge-04',
          3,
          null,
          'unhealthy',
        ],
      ],
    },
  ];

  for (const group of groups) {
    insertGroup(group);
    if (
      (process.env.KITSUNEGATE_SEED_DEMO_NODES ??
        process.env.RELAYDECK_SEED_DEMO_NODES) === '1'
    ) {
      for (const [
        id,
        name,
        uri,
        weight,
        latencyMs,
        healthStatus,
      ] of group.nodes) {
        insertNode(group.id, {
          id,
          name,
          uri,
          weight,
          latencyMs,
          healthStatus,
          lastCheckedAt: now(),
        });
      }
    }
  }
}

seedDatabase();

// Keep built-in sample names language-neutral without overwriting groups that
// users have renamed. These IDs and legacy names only belong to the seed data.
db.exec(`
  UPDATE proxy_groups
  SET name = CASE id
    WHEN 'grp_us' THEN 'United States Proxy'
    WHEN 'grp_jp' THEN 'Japan Proxy'
    WHEN 'grp_sg' THEN 'Singapore Proxy'
  END,
  updated_at = CURRENT_TIMESTAMP
  WHERE (id = 'grp_us' AND name = '美国代理')
     OR (id = 'grp_jp' AND name = '日本代理')
     OR (id = 'grp_sg' AND name = '新加坡代理')
`);

db.exec(`
  UPDATE proxy_nodes
  SET enabled = 0,
      health_status = 'unknown',
      latency_ms = NULL,
      last_error = 'Built-in demo node has no real credentials and was disabled automatically',
      updated_at = CURRENT_TIMESTAMP
  WHERE id IN (
    'node_us1', 'node_us2', 'node_us3', 'node_us4',
    'node_jp1', 'node_jp2', 'node_jp3', 'node_jp4',
    'node_sg1', 'node_sg2', 'node_sg3', 'node_sg4'
  ) AND server LIKE '%.example.com'
`);

function serializeGroup(row) {
  const nodes = db
    .prepare(
      'SELECT * FROM proxy_nodes WHERE group_id = ? ORDER BY priority, created_at',
    )
    .all(row.id);
  const enabledNodes = nodes.filter((node) => node.enabled);
  const healthy = enabledNodes.filter(
    (node) => node.health_status === 'healthy',
  ).length;
  return {
    id: row.id,
    name: row.name,
    regionCode: row.region_code,
    listenHost: row.listen_host,
    listenPort: row.listen_port,
    mode: row.mode,
    algorithm: row.algorithm,
    selectedNodeId: row.selected_node_id,
    enabled: Boolean(row.enabled),
    probeUrls: JSON.parse(row.probe_urls),
    probeInterval: row.probe_interval,
    probeTimeout: row.probe_timeout,
    fallThreshold: row.fall_threshold,
    riseThreshold: row.rise_threshold,
    latencyTolerance: row.latency_tolerance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stats: {
      healthy,
      total: enabledNodes.length,
      configured: nodes.length,
      connections: 0,
      throughputMbps: 0,
    },
    nodes: nodes.map((node) => {
      const uri = decryptSecret(node.encrypted_uri);
      const sourceType = node.source_type ?? 'link';
      return {
        id: node.id,
        groupId: node.group_id,
        name: node.name,
        protocol: node.protocol,
        server: node.server,
        serverPort: node.server_port,
        sourceType,
        uriHint:
          sourceType === 'link'
            ? maskProxyUri(uri)
            : `${sourceType === 'json' ? 'JSON' : 'Manual configuration'} · ${node.protocol.toUpperCase()}`,
        adapterPort: node.adapter_port,
        weight: node.weight,
        priority: node.priority,
        enabled: Boolean(node.enabled),
        healthStatus: node.health_status,
        latencyMs: node.latency_ms,
        lastError: node.last_error,
        lastCheckedAt: node.last_checked_at,
      };
    }),
  };
}

export function getState() {
  const groups = db
    .prepare('SELECT * FROM proxy_groups ORDER BY created_at')
    .all()
    .map(serializeGroup);
  const recentEvents = db
    .prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT 30')
    .all()
    .map((event) => ({
      id: event.id,
      groupId: event.group_id,
      nodeId: event.node_id,
      severity: event.severity,
      type: event.event_type,
      message: event.message,
      createdAt: event.created_at,
    }));
  return {
    engine: {
      mode:
        process.env.KITSUNEGATE_ENGINE_MODE ??
        process.env.RELAYDECK_ENGINE_MODE ??
        'real',
      haproxy: false,
      singbox: false,
      lastAppliedAt: null,
    },
    groups,
    recentEvents,
  };
}

function validateGroup(input, existingId = null) {
  const name = String(input.name ?? '').trim();
  const regionCode = String(input.regionCode ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 4);
  const listenHost = String(input.listenHost ?? '0.0.0.0').trim();
  const listenPort = Number(input.listenPort);
  if (!name) throw new Error('Enter a proxy group name.');
  if (!regionCode) throw new Error('Enter a region code.');
  if (!listenHost) throw new Error('Enter a listen address.');
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535)
    throw new Error('Listen port must be between 1 and 65535.');
  const conflict = db
    .prepare(
      'SELECT id FROM proxy_groups WHERE listen_host = ? AND listen_port = ? AND id != ?',
    )
    .get(listenHost, listenPort, existingId ?? '');
  if (conflict)
    throw new Error(
      `${listenHost}:${listenPort} is already used by another proxy group.`,
    );
  const probeUrls = Array.isArray(input.probeUrls)
    ? input.probeUrls
        .map(String)
        .map((url) => url.trim())
        .filter(Boolean)
    : ['https://www.gstatic.com/generate_204'];
  if (!probeUrls.length) throw new Error('Keep at least one probe URL.');
  for (const url of probeUrls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid probe URL: ${url}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol))
      throw new Error('Probe URLs must use HTTP or HTTPS.');
  }
  function bounded(name, value, fallback, minimum, maximum) {
    const number = Number(value ?? fallback);
    if (!Number.isInteger(number) || number < minimum || number > maximum)
      throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
    return number;
  }
  return {
    ...input,
    name,
    regionCode,
    listenHost,
    listenPort,
    mode: ['load_balance', 'fallback', 'latency_best', 'fixed'].includes(
      input.mode,
    )
      ? input.mode
      : 'load_balance',
    algorithm: ['leastconn', 'roundrobin', 'random'].includes(input.algorithm)
      ? input.algorithm
      : 'leastconn',
    probeUrls,
    probeInterval: bounded('Probe interval', input.probeInterval, 15, 5, 3600),
    probeTimeout: bounded('Probe timeout', input.probeTimeout, 6, 1, 60),
    fallThreshold: bounded('Failure threshold', input.fallThreshold, 2, 1, 20),
    riseThreshold: bounded('Recovery threshold', input.riseThreshold, 2, 1, 20),
    latencyTolerance: bounded(
      'Latency switching tolerance',
      input.latencyTolerance,
      100,
      0,
      5000,
    ),
  };
}

export function createGroup(input) {
  const group = validateGroup(input);
  const id = insertGroup(group);
  return serializeGroup(
    db.prepare('SELECT * FROM proxy_groups WHERE id = ?').get(id),
  );
}

export function updateGroup(id, input) {
  const current = db.prepare('SELECT * FROM proxy_groups WHERE id = ?').get(id);
  if (!current) throw new Error('Proxy group not found.');
  const merged = {
    name: input.name ?? current.name,
    regionCode: input.regionCode ?? current.region_code,
    listenHost: input.listenHost ?? current.listen_host,
    listenPort: input.listenPort ?? current.listen_port,
    mode: input.mode ?? current.mode,
    algorithm: input.algorithm ?? current.algorithm,
    probeUrls: input.probeUrls ?? JSON.parse(current.probe_urls),
    probeInterval: input.probeInterval ?? current.probe_interval,
    probeTimeout: input.probeTimeout ?? current.probe_timeout,
    fallThreshold: input.fallThreshold ?? current.fall_threshold,
    riseThreshold: input.riseThreshold ?? current.rise_threshold,
    latencyTolerance: input.latencyTolerance ?? current.latency_tolerance,
  };
  const group = validateGroup(merged, id);
  if (
    input.selectedNodeId &&
    !db
      .prepare('SELECT 1 FROM proxy_nodes WHERE id = ? AND group_id = ?')
      .get(input.selectedNodeId, id)
  )
    throw new Error('The selected node does not belong to this proxy group.');
  db.prepare(`
    UPDATE proxy_groups SET
      name = ?, region_code = ?, listen_host = ?, listen_port = ?, mode = ?,
      algorithm = ?, selected_node_id = ?, enabled = ?, probe_urls = ?,
      probe_interval = ?, probe_timeout = ?, fall_threshold = ?, rise_threshold = ?,
      latency_tolerance = ?, updated_at = ?
    WHERE id = ?
  `).run(
    group.name,
    group.regionCode,
    group.listenHost,
    group.listenPort,
    group.mode,
    group.algorithm,
    input.selectedNodeId ?? current.selected_node_id,
    input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    JSON.stringify(group.probeUrls),
    group.probeInterval,
    group.probeTimeout,
    group.fallThreshold,
    group.riseThreshold,
    group.latencyTolerance,
    now(),
    id,
  );
  addEvent({
    groupId: id,
    type: 'group.updated',
    message: `Updated configuration for proxy group “${group.name}”.`,
  });
  return serializeGroup(
    db.prepare('SELECT * FROM proxy_groups WHERE id = ?').get(id),
  );
}

export function deleteGroup(id) {
  const group = db
    .prepare('SELECT name FROM proxy_groups WHERE id = ?')
    .get(id);
  if (!group) throw new Error('Proxy group not found.');
  db.prepare('DELETE FROM proxy_groups WHERE id = ?').run(id);
  return { id, name: group.name };
}

export function createNode(groupId, input) {
  const group = db
    .prepare('SELECT id FROM proxy_groups WHERE id = ?')
    .get(groupId);
  if (!group) throw new Error('Proxy group not found.');
  const id = insertNode(groupId, input);
  return getNode(id);
}

export function getNode(id) {
  const node = db.prepare('SELECT * FROM proxy_nodes WHERE id = ?').get(id);
  if (!node) throw new Error('Node not found.');
  const sourceType = node.source_type ?? 'link';
  return {
    id: node.id,
    groupId: node.group_id,
    name: node.name,
    protocol: node.protocol,
    server: node.server,
    serverPort: node.server_port,
    sourceType,
    uriHint:
      sourceType === 'link'
        ? maskProxyUri(decryptSecret(node.encrypted_uri))
        : `${sourceType === 'json' ? 'JSON' : 'Manual configuration'} · ${node.protocol.toUpperCase()}`,
    adapterPort: node.adapter_port,
    weight: node.weight,
    priority: node.priority,
    enabled: Boolean(node.enabled),
    healthStatus: node.health_status,
    latencyMs: node.latency_ms,
    lastError: node.last_error,
    lastCheckedAt: node.last_checked_at,
  };
}

export function getNodeConfig(id) {
  const node = db.prepare('SELECT * FROM proxy_nodes WHERE id = ?').get(id);
  if (!node) throw new Error('Node not found.');
  const sourceType = node.source_type ?? 'link';
  const result = {
    id: node.id,
    name: node.name,
    weight: node.weight,
    priority: node.priority,
    enabled: Boolean(node.enabled),
    sourceType,
  };
  if (sourceType === 'link') {
    result.uri = decryptSecret(node.encrypted_uri);
  } else {
    const stored = JSON.parse(decryptSecret(node.encrypted_config));
    if (sourceType === 'manual') result.manual = stored.config;
    if (sourceType === 'json')
      result.json = JSON.stringify(
        stored.original ?? stored.outbound ?? stored.config,
        null,
        2,
      );
  }
  return result;
}

export function updateNode(id, input) {
  const current = db.prepare('SELECT * FROM proxy_nodes WHERE id = ?').get(id);
  if (!current) throw new Error('Node not found.');
  let parsed = {
    protocol: current.protocol,
    server: current.server,
    serverPort: current.server_port,
  };
  let encryptedUri = current.encrypted_uri;
  let sourceType = current.source_type ?? 'link';
  let encryptedConfig = current.encrypted_config;
  if (input.sourceType || input.uri || input.manual || input.json) {
    const prepared = prepareNodeInput(input, sourceType);
    parsed = prepared.parsed;
    encryptedUri = prepared.encryptedUri;
    sourceType = prepared.sourceType;
    encryptedConfig = prepared.encryptedConfig;
  }
  const name = String(input.name ?? current.name).trim();
  const weight = Number(input.weight ?? current.weight);
  const priority = Number(input.priority ?? current.priority);
  if (!name) throw new Error('Enter a node name.');
  if (!Number.isInteger(weight) || weight < 1 || weight > 256)
    throw new Error('Node weight must be between 1 and 256.');
  db.prepare(`
    UPDATE proxy_nodes SET
      name = ?, protocol = ?, server = ?, server_port = ?, encrypted_uri = ?,
      source_type = ?, encrypted_config = ?, weight = ?, priority = ?, enabled = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    parsed.protocol,
    parsed.server,
    parsed.serverPort,
    encryptedUri,
    sourceType,
    encryptedConfig,
    weight,
    priority,
    input.enabled === undefined ? current.enabled : input.enabled ? 1 : 0,
    now(),
    id,
  );
  addEvent({
    groupId: current.group_id,
    nodeId: id,
    type: 'node.updated',
    message: `Updated node “${name}”.`,
  });
  return getNode(id);
}

export function deleteNode(id) {
  const node = db
    .prepare('SELECT group_id, name FROM proxy_nodes WHERE id = ?')
    .get(id);
  if (!node) throw new Error('Node not found.');
  db.prepare('DELETE FROM proxy_nodes WHERE id = ?').run(id);
  addEvent({
    groupId: node.group_id,
    severity: 'warning',
    type: 'node.deleted',
    message: `Deleted node “${node.name}”.`,
  });
  return { id, groupId: node.group_id, name: node.name };
}

export function recordNodeHealth(id, result) {
  const node = db
    .prepare(`
    SELECT n.*, g.fall_threshold, g.rise_threshold
    FROM proxy_nodes n
    JOIN proxy_groups g ON g.id = n.group_id
    WHERE n.id = ?
  `)
    .get(id);
  if (!node) throw new Error('Node not found.');
  const timestamp = now();
  const successCount = result.ok ? node.consecutive_success + 1 : 0;
  const failureCount = result.ok ? 0 : node.consecutive_failure + 1;
  let status = node.health_status;
  if (
    result.ok &&
    (status === 'healthy' || successCount >= node.rise_threshold)
  )
    status = 'healthy';
  if (
    !result.ok &&
    (status === 'unhealthy' || failureCount >= node.fall_threshold)
  )
    status = 'unhealthy';
  db.prepare(`
    UPDATE proxy_nodes SET
      health_status = ?, latency_ms = ?, last_error = ?, last_checked_at = ?,
      consecutive_success = ?, consecutive_failure = ?, updated_at = ?
    WHERE id = ?
  `).run(
    status,
    result.latencyMs === null ? null : Math.round(result.latencyMs),
    result.ok ? null : result.error,
    timestamp,
    successCount,
    failureCount,
    timestamp,
    node.id,
  );
  addEvent({
    groupId: node.group_id,
    nodeId: id,
    severity: result.ok ? 'success' : 'error',
    type: 'node.checked',
    message: result.ok
      ? `Live check passed for node “${node.name}”: HTTP ${result.statusCode}, ${Math.round(result.latencyMs)} ms.`
      : `Live check failed for node “${node.name}”: ${result.error}`,
  });
  return { ...getNode(id), probe: result, successCount, failureCount };
}

export function addRuntimeLog(source, level, message) {
  if (!levelAllows(getSettings().logLevel, level)) return;
  db.prepare(
    'INSERT INTO runtime_logs (source, level, message, created_at) VALUES (?, ?, ?, ?)',
  ).run(source, level, String(message).slice(0, 4000), now());
}

export function getRuntimeLogs({
  limit = 200,
  level = 'all',
  source = 'all',
  search = '',
} = {}) {
  const clauses = [];
  const values = [];
  if (level !== 'all') {
    clauses.push('level = ?');
    values.push(level);
  }
  if (source !== 'all') {
    clauses.push('source = ?');
    values.push(source);
  }
  if (search) {
    clauses.push("(message LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\')");
    const escaped = `%${String(search)
      .slice(0, 200)
      .replace(/[\\%_]/g, '\\$&')}%`;
    values.push(escaped, escaped);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  values.push(Math.min(1000, Math.max(1, Number(limit) || 200)));
  return db
    .prepare(
      `SELECT id, source, level, message, created_at AS createdAt FROM runtime_logs ${where} ORDER BY id DESC LIMIT ?`,
    )
    .all(...values);
}

export function addTrafficSample(groupId, metrics) {
  db.prepare(`
    INSERT INTO traffic_samples (
      group_id, bytes_in, bytes_out, active_connections, total_connections,
      bytes_in_per_second, bytes_out_per_second, interval_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    groupId,
    metrics.bytesIn,
    metrics.bytesOut,
    metrics.activeConnections,
    metrics.totalConnections,
    metrics.speedIn,
    metrics.speedOut,
    metrics.intervalMs,
    now(),
  );
}

export function getTrafficTrend(range = '1h') {
  const definition = rangeDefinition(range);
  const oldestTimestamp = new Date(
    Date.now() - definition.seconds * 1000,
  ).toISOString();
  const rows = db
    .prepare(`
    WITH per_group AS (
      SELECT
        group_id,
        CAST(strftime('%s', created_at) / ? AS INTEGER) * ? AS epoch,
        AVG(bytes_in_per_second) AS bytes_in_per_second,
        AVG(bytes_out_per_second) AS bytes_out_per_second,
        AVG(active_connections) AS active_connections
      FROM traffic_samples
      WHERE created_at >= ?
      GROUP BY group_id, epoch
    )
    SELECT
      epoch,
      SUM(bytes_in_per_second) AS bytesInPerSecond,
      SUM(bytes_out_per_second) AS bytesOutPerSecond,
      SUM(active_connections) AS activeConnections
    FROM per_group
    GROUP BY epoch
    ORDER BY epoch ASC
  `)
    .all(definition.bucketSeconds, definition.bucketSeconds, oldestTimestamp);
  return {
    range: definition.key,
    label: definition.label,
    bucketSeconds: definition.bucketSeconds,
    points: rows.map((row) => ({
      createdAt: new Date(Number(row.epoch) * 1000).toISOString(),
      bytesInPerSecond: Number(row.bytesInPerSecond ?? 0),
      bytesOutPerSecond: Number(row.bytesOutPerSecond ?? 0),
      activeConnections: Number(row.activeConnections ?? 0),
    })),
  };
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM app_settings').all();
  const stored = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      // Ignore a damaged individual setting and fall back to its safe default.
    }
  }
  return normalizeSettings(stored);
}

export function updateSettings(input) {
  const settings = normalizeSettings(input, getSettings());
  const statement = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const timestamp = now();
  for (const [key, value] of Object.entries(settings))
    statement.run(key, JSON.stringify(value), timestamp);
  cleanupMonitoringData(settings);
  addEvent({
    type: 'settings.updated',
    message: `Monitoring settings updated: ${settings.metricsSampleIntervalSeconds}s sampling, ${settings.logLevel} log level.`,
  });
  return settings;
}

export function cleanupMonitoringData(settings = getSettings()) {
  const logThreshold = new Date(
    Date.now() - settings.logRetentionDays * 86_400_000,
  ).toISOString();
  const metricsThreshold = new Date(
    Date.now() - settings.metricsRetentionDays * 86_400_000,
  ).toISOString();
  db.prepare('DELETE FROM runtime_logs WHERE created_at < ?').run(logThreshold);
  db.prepare('DELETE FROM events WHERE created_at < ?').run(logThreshold);
  db.prepare('DELETE FROM traffic_samples WHERE created_at < ?').run(
    metricsThreshold,
  );
}

export function getLatestTrafficTotals(groupId) {
  const row = db
    .prepare(`
    SELECT
      bytes_in AS bytesIn,
      bytes_out AS bytesOut,
      active_connections AS activeConnections,
      total_connections AS totalConnections
    FROM traffic_samples
    WHERE group_id = ?
    ORDER BY id DESC
    LIMIT 1
  `)
    .get(groupId);
  return (
    row ?? {
      bytesIn: 0,
      bytesOut: 0,
      activeConnections: 0,
      totalConnections: 0,
    }
  );
}

export function getRawStateForEngine() {
  const groups = db
    .prepare('SELECT * FROM proxy_groups ORDER BY created_at')
    .all();
  return groups.map((group) => ({
    ...group,
    probe_urls: JSON.parse(group.probe_urls),
    nodes: db
      .prepare('SELECT * FROM proxy_nodes WHERE group_id = ? ORDER BY priority')
      .all(group.id)
      .map((node) => ({
        ...node,
        uri: decryptSecret(node.encrypted_uri),
        stored_config: node.encrypted_config
          ? JSON.parse(decryptSecret(node.encrypted_config))
          : null,
      })),
  }));
}

export { db, databasePath };
