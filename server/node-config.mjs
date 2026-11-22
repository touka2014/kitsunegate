const protocols = {
  vless: 'vless',
  vmess: 'vmess',
  ss: 'ss',
  shadowsocks: 'ss',
  trojan: 'trojan',
  hysteria2: 'hysteria2',
  hy2: 'hysteria2',
  hysteria: 'hysteria2',
  socks: 'socks',
  socks5: 'socks',
};
const networks = new Set(['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp']);
const securities = new Set(['none', 'tls', 'reality']);
const text = (value, fallback = '') => String(value ?? fallback).trim();

function required(value, name) {
  if (!text(value)) throw new Error(name + ' is required.');
  return text(value);
}
function protocolOf(value) {
  const key = text(value).toLowerCase();
  if (!Object.hasOwn(protocols, key))
    throw new Error('Unsupported proxy protocol.');
  return protocols[key];
}
function endpoint(address, value) {
  const server = required(address, 'Node address').replace(
    /^\[([^\]]+)\]$/,
    '$1',
  );
  const serverPort = Number(value);
  if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535)
    throw new Error('Node port must be between 1 and 65535.');
  return { server, serverPort };
}
function jsonObject(input, name) {
  let value = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error(name + ' must be valid JSON.');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(name + ' must be a JSON object.');
  return value;
}
export function normalizeManualConfig(input = {}) {
  const protocol = protocolOf(input.protocol);
  const network =
    input.network === 'raw'
      ? 'tcp'
      : input.network === 'splithttp'
        ? 'xhttp'
        : input.network || 'tcp';
  const security =
    input.security ||
    (['hysteria2', 'trojan'].includes(protocol) ? 'tls' : 'none');
  if (!networks.has(network))
    throw new Error(
      'Unsupported transport. Use native Xray JSON for advanced transports.',
    );
  if (!securities.has(security))
    throw new Error('Unsupported transport security.');
  if (input.allowInsecure && security === 'tls')
    throw new Error(
      'Xray requires certificate verification. Provide a trusted certificate or its SHA-256 pin.',
    );
  const config = {
    protocol,
    ...endpoint(
      input.server ?? input.address,
      input.serverPort ??
        input.port ??
        (protocol === 'ss' ? 8388 : protocol === 'socks' ? 1080 : 443),
    ),
    network,
    security,
    uuid: text(input.uuid ?? input.id),
    password: String(input.password ?? ''),
    username: String(input.username ?? ''),
    method: text(input.method, 'aes-256-gcm'),
    encryption: text(input.encryption, protocol === 'vmess' ? 'auto' : 'none'),
    flow: text(input.flow),
    sni: text(input.sni),
    fingerprint: text(input.fingerprint, 'chrome'),
    realityPublicKey: text(input.realityPublicKey ?? input.publicKey),
    realityShortId: text(input.realityShortId ?? input.shortId),
    spiderX: text(input.spiderX, '/'),
    path: text(input.path, '/'),
    host: text(input.host),
    serviceName: text(input.serviceName),
    authority: text(input.authority),
    multiMode: !!input.multiMode,
    xhttpMode: text(input.xhttpMode, 'auto'),
    xhttpExtra: '',
    alpn: text(input.alpn),
    pinnedPeerCertSha256: text(input.pinnedPeerCertSha256),
    verifyPeerCertByName: text(input.verifyPeerCertByName),
    upMbps: Number(input.upMbps ?? 0),
    downMbps: Number(input.downMbps ?? 0),
    obfs: text(input.obfs),
    obfsPassword: String(input.obfsPassword ?? ''),
  };
  if (network === 'xhttp') {
    if (
      !['auto', 'stream-up', 'stream-one', 'packet-up'].includes(
        config.xhttpMode,
      )
    )
      throw new Error('Unsupported XHTTP mode.');
    if (input.xhttpExtra && text(input.xhttpExtra))
      config.xhttpExtra = JSON.stringify(
        jsonObject(input.xhttpExtra, 'XHTTP extra'),
      );
  }
  if (['vless', 'vmess'].includes(protocol)) required(config.uuid, 'UUID');
  if (['trojan', 'hysteria2', 'ss'].includes(protocol))
    required(config.password, 'Node password');
  if (security === 'reality')
    required(config.realityPublicKey, 'Reality public key');
  if (protocol === 'hysteria2') {
    if (security !== 'tls') throw new Error('Hysteria2 requires TLS.');
    if (config.obfs && config.obfs !== 'salamander')
      throw new Error('Unsupported Hysteria2 obfuscation.');
    if (config.obfs) required(config.obfsPassword, 'Obfuscation password');
    if (
      [config.upMbps, config.downMbps].some((n) => !Number.isFinite(n) || n < 0)
    )
      throw new Error('Invalid Hysteria2 bandwidth.');
  }
  return config;
}
export function manualToXray(input, tag) {
  const c = normalizeManualConfig(input);
  const settings = { address: c.server, port: c.serverPort };
  const streamSettings = { network: c.network, security: c.security };
  switch (c.protocol) {
    case 'vless':
      Object.assign(settings, {
        id: c.uuid,
        encryption: c.encryption || 'none',
        flow: c.flow,
      });
      break;
    case 'vmess':
      Object.assign(settings, { id: c.uuid, security: c.encryption });
      break;
    case 'ss':
      Object.assign(settings, { method: c.method, password: c.password });
      break;
    case 'trojan':
      settings.password = c.password;
      break;
    case 'socks':
      Object.assign(settings, { user: c.username, pass: c.password });
      break;
    case 'hysteria2':
      settings.version = 2;
      streamSettings.network = 'hysteria';
      streamSettings.hysteriaSettings = { version: 2, auth: c.password };
      if (c.obfs || c.upMbps || c.downMbps) {
        streamSettings.finalmask = {};
        if (c.obfs)
          streamSettings.finalmask.udp = [
            { type: c.obfs, settings: { password: c.obfsPassword } },
          ];
        if (c.upMbps || c.downMbps)
          streamSettings.finalmask.quicParams = {
            congestion: 'brutal',
            brutalUp: c.upMbps ? c.upMbps + 'mbps' : undefined,
            brutalDown: c.downMbps ? c.downMbps + 'mbps' : undefined,
          };
      }
      break;
  }
  if (['ws', 'httpupgrade'].includes(c.network))
    streamSettings[c.network + 'Settings'] = { path: c.path, host: c.host };
  if (c.network === 'grpc')
    streamSettings.grpcSettings = {
      serviceName: c.serviceName,
      authority: c.authority,
      multiMode: c.multiMode,
    };
  if (c.network === 'xhttp')
    streamSettings.xhttpSettings = {
      ...JSON.parse(c.xhttpExtra || '{}'),
      path: c.path,
      host: c.host,
      mode: c.xhttpMode,
    };
  if (c.security === 'tls')
    streamSettings.tlsSettings = {
      serverName: c.sni || c.server,
      fingerprint:
        c.protocol === 'hysteria2' ? undefined : c.fingerprint || undefined,
      alpn: c.alpn
        ? c.alpn.split(',').map((v) => v.trim())
        : c.protocol === 'hysteria2'
          ? ['h3']
          : undefined,
      pinnedPeerCertSha256: c.pinnedPeerCertSha256 || undefined,
      verifyPeerCertByName: c.verifyPeerCertByName || undefined,
    };
  if (c.security === 'reality')
    streamSettings.realitySettings = {
      serverName: c.sni || c.server,
      fingerprint: c.fingerprint || 'chrome',
      password: c.realityPublicKey,
      shortId: c.realityShortId,
      spiderX: c.spiderX || '/',
    };
  const protocol =
    c.protocol === 'ss'
      ? 'shadowsocks'
      : c.protocol === 'hysteria2'
        ? 'hysteria'
        : c.protocol;
  return { tag, protocol, settings, streamSettings };
}

function decode64(s) {
  return Buffer.from(s, 'base64url').toString('utf8');
}

export function parseShareLink(value) {
  let uri = text(value);
  if (/^[a-z0-9]+\\:\/\//i.test(uri))
    uri = uri.replaceAll('\\:', ':').replaceAll('\\.', '.').replace(/\\$/, '');
  const match = /^([a-z0-9]+):\/\//i.exec(uri);
  if (!match) throw new Error('Invalid proxy share link.');
  const protocol = protocolOf(match[1]);
  let config, label;
  if (protocol === 'vmess') {
    let raw;
    try {
      raw = JSON.parse(decode64(uri.slice(match[0].length).split('#')[0]));
    } catch {
      throw new Error('Invalid VMess share link.');
    }
    config = {
      protocol,
      server: raw.add,
      serverPort: raw.port,
      uuid: raw.id,
      encryption: raw.scy || 'auto',
      network: raw.net,
      security: raw.tls || 'none',
      sni: raw.sni,
      fingerprint: raw.fp,
      path: raw.path,
      host: raw.host,
      serviceName: raw.path,
      realityPublicKey: raw.pbk,
      realityShortId: raw.sid,
      spiderX: raw.spx,
      xhttpMode: raw.mode,
      xhttpExtra: raw.extra,
      alpn: raw.alpn,
    };
    label = raw.ps;
  } else {
    let address = uri;
    let ss;
    if (protocol === 'ss') {
      const payload = uri.slice(match[0].length).split(/[?#]/)[0];
      const decoded = payload.includes('@') ? payload : decode64(payload);
      const at = decoded.lastIndexOf('@');
      if (at < 1) throw new Error('Invalid Shadowsocks endpoint.');
      const user = decoded.slice(0, at);
      const auth = !payload.includes('@')
        ? user
        : user.includes(':') || /%3a/i.test(user)
          ? decodeURIComponent(user)
          : decode64(user);
      const sep = auth.indexOf(':');
      if (sep <= 0) throw new Error('Invalid Shadowsocks credentials.');
      ss = { method: auth.slice(0, sep), password: auth.slice(sep + 1) };
      address =
        'ss://' +
        decoded.slice(at + 1) +
        uri.slice(match[0].length + payload.length);
    }
    let url;
    try {
      url = new URL(address);
    } catch {
      throw new Error('Invalid share-link address.');
    }
    const p = url.searchParams;
    if (
      p.has('plugin') ||
      p.has('mport') ||
      p.has('fm') ||
      (p.has('headerType') && p.get('headerType') !== 'none')
    )
      throw new Error(
        'Unsupported share-link extension. Import its native Xray outbound JSON.',
      );
    const user = decodeURIComponent(url.username);
    const pass = decodeURIComponent(url.password);
    config = {
      protocol,
      server: url.hostname,
      serverPort: url.port || undefined,
      uuid: user,
      username: user,
      password: protocol === 'socks' ? pass : pass ? user + ':' + pass : user,
      ...ss,
      network: p.get('type') || p.get('network'),
      security: p.get('security'),
      encryption: p.get('encryption') || undefined,
      sni: p.get('sni') || p.get('peer'),
      fingerprint: p.get('fp'),
      flow: p.get('flow'),
      realityPublicKey: p.get('pbk') || p.get('publicKey'),
      realityShortId: p.get('sid') || p.get('shortId'),
      spiderX: p.get('spx'),
      alpn: p.get('alpn'),
      pinnedPeerCertSha256: p.get('pcs') || p.get('pinSHA256'),
      verifyPeerCertByName: p.get('vcn'),
      allowInsecure: ['1', 'true'].includes(
        p.get('allowInsecure') || p.get('insecure'),
      ),
      host: p.get('host'),
      path: p.get('path'),
      serviceName: p.get('serviceName') || p.get('path'),
      authority: p.get('authority'),
      multiMode: p.get('mode') === 'multi',
      xhttpMode: p.get('mode') || undefined,
      xhttpExtra: p.get('extra'),
      upMbps: p.get('upmbps') || p.get('up'),
      downMbps: p.get('downmbps') || p.get('down'),
      obfs: p.get('obfs'),
      obfsPassword: p.get('obfs-password') || p.get('obfsPassword'),
    };
    if (['xhttp', 'splithttp'].includes(config.network)) {
      const extra = {
        ...(config.xhttpExtra
          ? jsonObject(config.xhttpExtra, 'XHTTP extra')
          : {}),
      };
      for (const key of [
        'xPaddingBytes',
        'scMaxEachPostBytes',
        'scMinPostsIntervalMs',
        'scStreamUpServerSecs',
      ])
        if (p.has(key)) extra[key] = p.get(key);
      config.xhttpExtra = extra;
    }
    label = decodeURIComponent(url.hash.slice(1));
  }
  return { config: normalizeManualConfig(config), label: text(label), uri };
}

// Reject unmapped legacy options instead of silently changing the route or TLS policy.
function fields(object, allowed, section) {
  const unknown = Object.keys(object).find((key) => !allowed.includes(key));
  if (unknown)
    throw new Error(
      'Unsupported sing-box ' +
        section +
        ' field: ' +
        unknown +
        '. Import native Xray JSON.',
    );
}
export function convertLegacyOutbound(raw, tag) {
  fields(
    raw,
    [
      'type',
      'tag',
      'server',
      'server_port',
      'uuid',
      'security',
      'flow',
      'password',
      'username',
      'method',
      'tls',
      'transport',
      'up_mbps',
      'down_mbps',
      'obfs',
      'version',
    ],
    'outbound',
  );
  const tls = raw.tls ?? {},
    reality = tls.reality ?? {},
    utls = tls.utls ?? {},
    tr = raw.transport ?? {},
    obfs = raw.obfs ?? {};
  fields(
    tls,
    ['enabled', 'server_name', 'alpn', 'insecure', 'utls', 'reality'],
    'TLS',
  );
  fields(utls, ['enabled', 'fingerprint'], 'uTLS');
  fields(reality, ['enabled', 'public_key', 'short_id'], 'Reality');
  fields(tr, ['type', 'path', 'headers', 'host', 'service_name'], 'transport');
  fields(obfs, ['type', 'password'], 'obfuscation');
  if (raw.version && String(raw.version) !== '5')
    throw new Error('Unsupported SOCKS version.');
  const headers = { ...tr.headers };
  const hostKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === 'host',
  );
  const host = tr.host || headers[hostKey];
  delete headers[hostKey];
  const outbound = manualToXray(
    {
      protocol: raw.type,
      server: raw.server,
      serverPort: raw.server_port,
      uuid: raw.uuid,
      password: raw.password,
      method: raw.method,
      username: raw.username,
      encryption: raw.security,
      flow: raw.flow,
      security: tls.enabled ? (reality.enabled ? 'reality' : 'tls') : 'none',
      sni: tls.server_name,
      alpn: tls.alpn?.join(','),
      fingerprint: utls.enabled ? utls.fingerprint : '',
      allowInsecure: tls.insecure,
      realityPublicKey: reality.public_key,
      realityShortId: reality.short_id,
      network: tr.type,
      host,
      path: tr.path,
      serviceName: tr.service_name,
      upMbps: raw.up_mbps,
      downMbps: raw.down_mbps,
      obfs: obfs.type,
      obfsPassword: obfs.password,
    },
    tag,
  );
  if (Object.keys(headers).length) {
    if (!['ws', 'httpupgrade'].includes(tr.type))
      throw new Error('Unsupported transport headers.');
    outbound.streamSettings[tr.type + 'Settings'].headers = headers;
  }
  return outbound;
}
export function normalizeJsonConfig(input) {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error('Outbound JSON is invalid.');
    }
  }
  const list = Array.isArray(raw) ? raw : raw?.outbounds;
  if (Array.isArray(list)) {
    const proxies = list.filter(
      (o) =>
        o &&
        !['direct', 'freedom', 'block', 'blackhole', 'dns'].includes(
          o.protocol ?? o.type,
        ),
    );
    if (proxies.length !== 1)
      throw new Error('A node requires exactly one proxy outbound.');
    raw = proxies[0];
  }
  raw = jsonObject(raw, 'Outbound');
  const outbound = raw.protocol ? raw : convertLegacyOutbound(raw, raw.tag);
  const protocol = protocolOf(outbound.protocol);
  if (
    outbound.proxySettings?.tag ||
    outbound.streamSettings?.sockopt?.dialerProxy
  )
    throw new Error(
      'A node requires a standalone outbound without references to other proxy tags.',
    );
  const settings = jsonObject(outbound.settings, 'Outbound settings');
  const target = settings.address
    ? settings
    : (settings.vnext?.[0] ?? settings.servers?.[0] ?? settings);
  return {
    protocol,
    ...endpoint(target.address, target.port),
    tag: text(raw.tag),
    payload: { kind: raw.protocol ? 'xray' : 'singbox', outbound: raw },
  };
}

export function savedManualConfig(saved) {
  // The v0.1.1 manual renderer always enabled TLS for Trojan.
  const c = saved.config;
  if (saved.core !== 'xray' && c.protocol === 'trojan' && c.security === 'none')
    return { ...c, security: 'tls' };
  return c;
}

export function nodeOutbound(node) {
  const tag = 'out-' + node.id;
  const saved = node.stored_config;
  // Previous versions stored Xray JSON with a lossy manual projection and a complete original.
  if (saved?.original || saved?.kind === 'xray') {
    const raw = saved.original ?? saved.outbound;
    normalizeJsonConfig(raw);
    return { ...raw, tag };
  }
  if (saved?.kind === 'singbox')
    return convertLegacyOutbound(saved.outbound, tag);
  if (saved?.kind === 'manual')
    return manualToXray(savedManualConfig(saved), tag);
  return manualToXray(parseShareLink(node.uri).config, tag);
}
