import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convertLegacyOutbound,
  manualToXray,
  normalizeJsonConfig,
  normalizeManualConfig,
  nodeOutbound,
  parseShareLink,
} from './node-config.mjs';

const id = '11111111-2222-4333-8444-555555555555';
const manual = { protocol: 'vless', server: 'edge.example', uuid: id };
const extras = {
  xPaddingBytes: '100-1000',
  scMaxEachPostBytes: '1000000',
  scMinPostsIntervalMs: '30',
  xmux: { maxConcurrency: '4-8' },
};

test('VLESS XHTTP / REALITY share link and manual configuration produce identical outbounds', () => {
  const params = new URLSearchParams({
    type: 'xhttp',
    security: 'reality',
    sni: 'peer.example',
    fp: 'chrome',
    pbk: 'test-public-key',
    sid: '00aa',
    spx: '/spider',
    mode: 'packet-up',
    host: 'host.example',
    path: '/test',
    extra: JSON.stringify(extras),
  });
  const link = 'vless://' + id + '@edge.example:443?' + params + '#US';
  const expected = manualToXray(
    {
      ...manual,
      network: 'xhttp',
      security: 'reality',
      realityPublicKey: 'test-public-key',
      realityShortId: '00aa',
      sni: 'peer.example',
      spiderX: '/spider',
      host: 'host.example',
      path: '/test',
      xhttpMode: 'packet-up',
      xhttpExtra: JSON.stringify(extras),
    },
    'out-n',
  );
  for (const uri of [
    link,
    link.replace('vless:', 'vless\\:').replaceAll('.example', '\\.example') +
      '\\',
  ]) {
    assert.equal(parseShareLink(uri).label, 'US');
    assert.deepEqual(nodeOutbound({ id: 'n', uri }), expected);
  }
  assert.deepEqual(expected.streamSettings.xhttpSettings, {
    ...extras,
    path: '/test',
    host: 'host.example',
    mode: 'packet-up',
  });
  assert.equal(expected.streamSettings.realitySettings.spiderX, '/spider');
  assert.equal(expected.settings.id, id);
});
test('native Xray and historical 3x-ui JSON retain advanced fields', () => {
  for (const settings of [
    { address: 'edge.example', port: 443, id, encryption: 'none' },
    {
      vnext: [
        {
          address: 'edge.example',
          port: 443,
          users: [{ id, encryption: 'none' }],
        },
      ],
    },
  ]) {
    const original = {
      protocol: 'vless',
      tag: 'custom',
      settings,
      mux: { enabled: true, concurrency: 4 },
      streamSettings: {
        network: 'xhttp',
        xhttpSettings: { path: '/a', extra: extras },
      },
    };
    const result = normalizeJsonConfig({
      outbounds: [{ protocol: 'blackhole' }, original],
    });
    assert.equal(result.server, 'edge.example');
    for (const stored_config of [
      result.payload,
      { kind: 'manual', original, config: {} },
    ])
      assert.deepEqual(nodeOutbound({ id: 'legacy', stored_config }), {
        ...original,
        tag: 'out-legacy',
      });
  }
});
test('previous manual format and sing-box WS headers, TLS, SOCKS credentials survive conversion', () => {
  const old = {
    type: 'vless',
    tag: 'old',
    server: 'edge.example',
    server_port: 443,
    uuid: id,
    transport: {
      type: 'ws',
      path: '/w',
      headers: { Host: 'cdn.example', Origin: 'https://cdn.example' },
    },
    tls: {
      enabled: true,
      server_name: 'cdn.example',
      utls: { enabled: true, fingerprint: 'chrome' },
    },
  };
  const normalized = normalizeJsonConfig(old);
  const o = nodeOutbound({ id: 'n', stored_config: normalized.payload });
  assert.deepEqual(o.streamSettings.wsSettings, {
    path: '/w',
    host: 'cdn.example',
    headers: { Origin: 'https://cdn.example' },
  });
  assert.equal(o.streamSettings.tlsSettings.serverName, 'cdn.example');
  assert.equal(
    nodeOutbound({ id: 'n', stored_config: { kind: 'manual', config: manual } })
      .settings.id,
    id,
  );
  assert.equal(
    convertLegacyOutbound(
      {
        type: 'socks',
        server: 'localhost',
        server_port: 1080,
        username: 'a',
        password: 'b',
      },
      'n',
    ).settings.pass,
    'b',
  );
  assert.throws(
    () => normalizeJsonConfig({ ...old, detour: 'other' }),
    /Unsupported.*detour/,
  );
});
test('share links reject unsupported transport, malformed extra, chained tags and missing credentials', () => {
  for (const param of [
    'type=typo',
    'security=typo',
    'type=xhttp&extra=%5B%5D',
    'type=xhttp&extra=nope',
    'security=reality',
    'security=tls&allowInsecure=1',
  ])
    assert.throws(() =>
      parseShareLink('vless://' + id + '@edge.example?' + param),
    );
  assert.throws(() => normalizeManualConfig({ ...manual, uuid: '' }), /UUID/);
  assert.throws(
    () =>
      normalizeJsonConfig({
        outbounds: [{ protocol: 'socks' }, { protocol: 'vless' }],
      }),
    /exactly one/,
  );
  assert.throws(
    () =>
      normalizeJsonConfig({
        protocol: 'socks',
        settings: { address: 'localhost', port: 1080 },
        proxySettings: { tag: 'other' },
      }),
    /standalone/,
  );
});
test('existing SS, VMess, Trojan, Hysteria2 and SOCKS forms target Xray protocol settings', () => {
  const auth = Buffer.from('aes-256-gcm:secret').toString('base64url');
  for (const uri of [
    'ss://' + auth + '@edge.example:8388',
    'ss://' +
      Buffer.from('aes-256-gcm:secret@edge.example:8388').toString('base64url'),
  ])
    assert.deepEqual(nodeOutbound({ id: 'n', uri }).settings, {
      address: 'edge.example',
      port: 8388,
      method: 'aes-256-gcm',
      password: 'secret',
    });
  const vm = Buffer.from(
    JSON.stringify({
      add: 'edge.example',
      port: 443,
      id,
      net: 'grpc',
      path: 'test',
      tls: 'tls',
    }),
  ).toString('base64');
  assert.equal(
    nodeOutbound({ id: 'n', uri: 'vmess://' + vm }).streamSettings.grpcSettings
      .serviceName,
    'test',
  );
  assert.equal(
    nodeOutbound({ id: 'n', uri: 'trojan://pw@edge.example' }).streamSettings
      .security,
    'tls',
  );
  const hy = nodeOutbound({
    id: 'n',
    uri: 'hy2://pw@edge.example?obfs=salamander&obfs-password=obfs&up=5',
  });
  assert.equal(hy.protocol, 'hysteria');
  assert.equal(hy.streamSettings.hysteriaSettings.auth, 'pw');
  assert.equal(hy.streamSettings.finalmask.udp[0].settings.password, 'obfs');
  assert.equal(hy.streamSettings.finalmask.quicParams.brutalUp, '5mbps');
  const socks = nodeOutbound({ id: 'n', uri: 'socks5://u:p%40ss@[::1]' });
  assert.deepEqual(socks.settings, {
    address: '::1',
    port: 1080,
    user: 'u',
    pass: 'p@ss',
  });
});
