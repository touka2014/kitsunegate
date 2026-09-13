const protocols = new Set([
  'vless',
  'vmess',
  'ss',
  'trojan',
  'hysteria2',
  'socks',
]);
const networks = new Set(['tcp', 'ws', 'grpc', 'httpupgrade']);
const securities = new Set(['none', 'tls', 'reality']);

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function port(value, fallback = 443) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)
    throw new Error('Node port must be between 1 and 65535.');
  return parsed;
}

function requireText(value, message) {
  const parsed = text(value);
  if (!parsed) throw new Error(message);
  return parsed;
}

function normalizeProtocol(value) {
  const protocol = text(value)
    .toLowerCase()
    .replace('shadowsocks', 'ss')
    .replace('hy2', 'hysteria2')
    .replace('socks5', 'socks');
  if (!protocols.has(protocol))
    throw new Error(`Protocol ${protocol || '(empty)'} is not supported.`);
  return protocol;
}

export function normalizeManualConfig(input = {}) {
  const protocol = normalizeProtocol(input.protocol);
  const server = requireText(
    input.server ?? input.address,
    'Enter a node address.',
  );
  const serverPort = port(
    input.serverPort ?? input.port,
    protocol === 'ss' ? 8388 : 443,
  );
  const network = networks.has(input.network) ? input.network : 'tcp';
  const security = securities.has(input.security)
    ? input.security
    : protocol === 'hysteria2'
      ? 'tls'
      : 'none';
  const config = {
    protocol,
    server,
    serverPort,
    uuid: text(input.uuid ?? input.id),
    password: text(input.password),
    username: text(input.username),
    method: text(input.method, 'aes-256-gcm'),
    encryption: text(input.encryption, 'none'),
    flow: text(input.flow),
    network,
    security,
    sni: text(input.sni),
    fingerprint: text(input.fingerprint, 'chrome'),
    allowInsecure: Boolean(input.allowInsecure),
    realityPublicKey: text(input.realityPublicKey ?? input.publicKey),
    realityShortId: text(input.realityShortId ?? input.shortId),
    path: text(input.path, '/'),
    host: text(input.host),
    serviceName: text(input.serviceName),
    upMbps: Math.max(0, Number(input.upMbps ?? 0) || 0),
    downMbps: Math.max(0, Number(input.downMbps ?? 0) || 0),
    obfs: text(input.obfs),
    obfsPassword: text(input.obfsPassword),
  };

  if (['vless', 'vmess'].includes(protocol) && !config.uuid)
    throw new Error(`${protocol.toUpperCase()} nodes require a UUID.`);
  if (['trojan', 'hysteria2'].includes(protocol) && !config.password)
    throw new Error(`${protocol.toUpperCase()} nodes require a password.`);
  if (protocol === 'ss' && (!config.method || !config.password))
    throw new Error(
      'Shadowsocks nodes require an encryption method and password.',
    );
  if (security === 'reality' && !config.realityPublicKey)
    throw new Error('Reality nodes require a public key.');
  return config;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function firstProxyOutbound(value) {
  if (Array.isArray(value))
    return value.find(
      (item) =>
        item &&
        !['direct', 'block', 'dns', 'freedom', 'blackhole'].includes(
          item.type ?? item.protocol,
        ),
    );
  if (Array.isArray(value?.outbounds))
    return firstProxyOutbound(value.outbounds);
  return value;
}

function normalizeSingBox(raw) {
  const protocol = normalizeProtocol(raw.type);
  const server = requireText(raw.server, 'The JSON object is missing server.');
  const serverPort = port(
    raw.server_port ?? raw.serverPort,
    protocol === 'ss' ? 8388 : 443,
  );
  return {
    protocol,
    server,
    serverPort,
    tag: text(raw.tag),
    payload: {
      kind: 'singbox',
      outbound: {
        ...raw,
        type: protocol === 'ss' ? 'shadowsocks' : protocol,
        server,
        server_port: serverPort,
      },
    },
  };
}

function normalizeXray(raw) {
  const protocol = normalizeProtocol(raw.protocol);
  const settings = object(raw.settings);
  const stream = object(raw.streamSettings);
  let endpoint = settings;
  let user = settings;

  if (['vless', 'vmess'].includes(protocol)) {
    endpoint = object(
      Array.isArray(settings.vnext) ? settings.vnext[0] : settings,
    );
    user = object(Array.isArray(endpoint.users) ? endpoint.users[0] : settings);
  } else if (Array.isArray(settings.servers)) {
    endpoint = object(settings.servers[0]);
    user = endpoint;
  }

  const tls = object(stream.tlsSettings);
  const reality = object(stream.realitySettings);
  const ws = object(stream.wsSettings);
  const grpc = object(stream.grpcSettings);
  const httpUpgrade = object(stream.httpupgradeSettings);
  const headers = object(ws.headers ?? httpUpgrade.headers);
  const manual = normalizeManualConfig({
    protocol,
    server: endpoint.address ?? endpoint.server,
    serverPort: endpoint.port,
    uuid: user.id,
    password: user.password,
    username: user.user ?? user.username,
    method: user.method,
    encryption: user.encryption,
    flow: user.flow,
    network: stream.network ?? 'tcp',
    security: stream.security ?? 'none',
    sni: tls.serverName ?? reality.serverName,
    fingerprint: tls.fingerprint ?? reality.fingerprint,
    allowInsecure: tls.allowInsecure,
    realityPublicKey: reality.publicKey,
    realityShortId: reality.shortId,
    path: ws.path ?? httpUpgrade.path,
    host: headers.Host ?? headers.host,
    serviceName: grpc.serviceName,
  });
  return {
    protocol,
    server: manual.server,
    serverPort: manual.serverPort,
    tag: text(raw.tag),
    payload: { kind: 'manual', config: manual, original: raw },
  };
}

export function normalizeJsonConfig(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new Error('Outbound JSON is invalid.');
  }
  const raw = firstProxyOutbound(parsed);
  if (!raw || typeof raw !== 'object')
    throw new Error('No usable proxy outbound was found in the JSON.');
  if (raw.type) return normalizeSingBox(raw);
  if (raw.protocol) return normalizeXray(raw);
  throw new Error(
    'Unrecognized JSON format; provide a sing-box type or Xray protocol field.',
  );
}

export function manualToSingBox(config, tag) {
  const outbound = {
    type: config.protocol === 'ss' ? 'shadowsocks' : config.protocol,
    tag,
    server: config.server,
    server_port: config.serverPort,
  };
  if (config.protocol === 'vless')
    Object.assign(outbound, {
      uuid: config.uuid,
      flow: config.flow || undefined,
    });
  if (config.protocol === 'vmess')
    Object.assign(outbound, {
      uuid: config.uuid,
      security: config.encryption === 'none' ? 'auto' : config.encryption,
    });
  if (config.protocol === 'ss')
    Object.assign(outbound, {
      method: config.method,
      password: config.password,
    });
  if (config.protocol === 'trojan') outbound.password = config.password;
  if (config.protocol === 'hysteria2')
    Object.assign(outbound, {
      password: config.password,
      up_mbps: config.upMbps || undefined,
      down_mbps: config.downMbps || undefined,
      obfs: config.obfs
        ? { type: config.obfs, password: config.obfsPassword }
        : undefined,
    });
  if (config.protocol === 'socks')
    Object.assign(outbound, {
      username: config.username || undefined,
      password: config.password || undefined,
    });

  if (
    ['vless', 'vmess', 'trojan'].includes(config.protocol) &&
    config.network !== 'tcp'
  ) {
    outbound.transport = { type: config.network };
    if (['ws', 'httpupgrade'].includes(config.network)) {
      outbound.transport.path = config.path || '/';
      if (config.host) outbound.transport.headers = { Host: config.host };
    }
    if (config.network === 'grpc')
      outbound.transport.service_name = config.serviceName;
  }
  if (
    config.security !== 'none' ||
    ['trojan', 'hysteria2'].includes(config.protocol)
  ) {
    outbound.tls = {
      enabled: true,
      server_name: config.sni || config.server,
      insecure: Boolean(config.allowInsecure),
      utls: config.fingerprint
        ? { enabled: true, fingerprint: config.fingerprint }
        : undefined,
    };
    if (config.security === 'reality') {
      outbound.tls.reality = {
        enabled: true,
        public_key: config.realityPublicKey,
        short_id: config.realityShortId || undefined,
      };
    }
  }
  return outbound;
}

function decodeBase64(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  return Buffer.from(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='),
    'base64',
  ).toString('utf8');
}

function linkParameters(uri, protocol, server, serverPort) {
  const network =
    uri.searchParams.get('type') || uri.searchParams.get('network') || 'tcp';
  const security =
    uri.searchParams.get('security') ||
    (protocol === 'trojan' || protocol === 'hysteria2' ? 'tls' : 'none');
  return {
    protocol,
    server,
    serverPort,
    uuid: decodeURIComponent(uri.username),
    password: decodeURIComponent(uri.username),
    network,
    security,
    flow: uri.searchParams.get('flow') || '',
    sni: uri.searchParams.get('sni') || uri.searchParams.get('peer') || '',
    fingerprint: uri.searchParams.get('fp') || 'chrome',
    allowInsecure: ['1', 'true'].includes(
      uri.searchParams.get('allowInsecure') ||
        uri.searchParams.get('insecure') ||
        '',
    ),
    realityPublicKey:
      uri.searchParams.get('pbk') || uri.searchParams.get('publicKey') || '',
    realityShortId:
      uri.searchParams.get('sid') || uri.searchParams.get('shortId') || '',
    path: uri.searchParams.get('path') || '/',
    host: uri.searchParams.get('host') || '',
    serviceName: uri.searchParams.get('serviceName') || '',
    obfs: uri.searchParams.get('obfs') || '',
    obfsPassword:
      uri.searchParams.get('obfs-password') ||
      uri.searchParams.get('obfsPassword') ||
      '',
    upMbps: Number(
      uri.searchParams.get('upmbps') || uri.searchParams.get('up') || 0,
    ),
    downMbps: Number(
      uri.searchParams.get('downmbps') || uri.searchParams.get('down') || 0,
    ),
  };
}

export function linkToSingBox(value, tag) {
  const source = text(value);
  const protocolText = source.split('://')[0]?.toLowerCase();
  const protocol = normalizeProtocol(protocolText);

  if (protocol === 'vmess') {
    let raw;
    try {
      raw = JSON.parse(
        decodeBase64(source.slice('vmess://'.length).split('#')[0]),
      );
    } catch {
      throw new Error('The VMess share link is invalid.');
    }
    return manualToSingBox(
      normalizeManualConfig({
        protocol,
        server: raw.add,
        serverPort: raw.port,
        uuid: raw.id,
        encryption: raw.scy || 'auto',
        network: raw.net || 'tcp',
        security:
          raw.tls === 'tls'
            ? 'tls'
            : raw.tls === 'reality'
              ? 'reality'
              : 'none',
        sni: raw.sni,
        fingerprint: raw.fp,
        path: raw.path,
        host: raw.host,
        serviceName: raw.path,
        realityPublicKey: raw.pbk,
        realityShortId: raw.sid,
      }),
      tag,
    );
  }

  if (protocol === 'ss') {
    const withoutFragment = source.split('#')[0];
    const payload = withoutFragment.slice('ss://'.length);
    let methodPassword;
    let hostPort;
    if (payload.includes('@')) {
      const index = payload.lastIndexOf('@');
      const encodedUser = payload.slice(0, index);
      methodPassword = encodedUser.includes(':')
        ? decodeURIComponent(encodedUser)
        : decodeBase64(encodedUser);
      hostPort = payload.slice(index + 1);
    } else {
      const decoded = decodeBase64(payload);
      const index = decoded.lastIndexOf('@');
      methodPassword = decoded.slice(0, index);
      hostPort = decoded.slice(index + 1);
    }
    const separator = methodPassword.indexOf(':');
    const endpoint = new URL(`tcp://${hostPort}`);
    return manualToSingBox(
      normalizeManualConfig({
        protocol,
        server: endpoint.hostname,
        serverPort: endpoint.port || 8388,
        method: methodPassword.slice(0, separator),
        password: methodPassword.slice(separator + 1),
      }),
      tag,
    );
  }

  const uri = new URL(source);
  const config = linkParameters(
    uri,
    protocol,
    uri.hostname,
    Number(uri.port || (protocol === 'socks' ? 1080 : 443)),
  );
  if (protocol === 'socks') {
    config.username = decodeURIComponent(uri.username);
    config.password = decodeURIComponent(uri.password);
  }
  return manualToSingBox(normalizeManualConfig(config), tag);
}
