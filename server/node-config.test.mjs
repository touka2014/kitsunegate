import assert from 'node:assert/strict';
import test from 'node:test';

import {
  linkToSingBox,
  manualToSingBox,
  normalizeJsonConfig,
  normalizeManualConfig,
} from './node-config.mjs';

test('manual VLESS form becomes a sing-box outbound with WebSocket and TLS', () => {
  const config = normalizeManualConfig({
    protocol: 'vless',
    server: 'proxy.example.com',
    serverPort: 443,
    uuid: '11111111-2222-4333-8444-555555555555',
    network: 'ws',
    security: 'tls',
    path: '/relay',
    host: 'cdn.example.com',
  });
  const outbound = manualToSingBox(config, 'out-test');
  assert.equal(outbound.type, 'vless');
  assert.equal(outbound.transport.type, 'ws');
  assert.equal(outbound.transport.headers.Host, 'cdn.example.com');
  assert.equal(outbound.tls.enabled, true);
});

test('sing-box JSON import preserves advanced fields', () => {
  const result = normalizeJsonConfig({
    type: 'shadowsocks',
    tag: 'ss-json',
    server: 'ss.example.com',
    server_port: 8388,
    method: 'aes-256-gcm',
    password: 'secret',
  });
  assert.equal(result.protocol, 'ss');
  assert.equal(result.payload.kind, 'singbox');
  assert.equal(result.payload.outbound.method, 'aes-256-gcm');
});

test('Xray outbound JSON is normalized for the local sing-box engine', () => {
  const result = normalizeJsonConfig({
    protocol: 'trojan',
    tag: 'xray-trojan',
    settings: {
      servers: [
        { address: 'trojan.example.com', port: 443, password: 'secret' },
      ],
    },
    streamSettings: {
      network: 'tcp',
      security: 'tls',
      tlsSettings: { serverName: 'sni.example.com' },
    },
  });
  assert.equal(result.payload.kind, 'manual');
  assert.equal(result.payload.config.password, 'secret');
  assert.equal(result.payload.config.sni, 'sni.example.com');
});

test('manual protocol validation rejects incomplete credentials', () => {
  assert.throws(
    () =>
      normalizeManualConfig({
        protocol: 'vless',
        server: 'example.com',
        serverPort: 443,
      }),
    /UUID/,
  );
  assert.throws(
    () =>
      normalizeManualConfig({
        protocol: 'ss',
        server: 'example.com',
        serverPort: 8388,
      }),
    /password/,
  );
});

test('VLESS Reality share link becomes a usable sing-box outbound', () => {
  const outbound = linkToSingBox(
    'vless://11111111-2222-4333-8444-555555555555@edge.example.com:443?security=reality&sni=www.example.com&fp=chrome&pbk=public-key&sid=abcd&type=tcp#Reality',
    'out-reality',
  );
  assert.equal(outbound.type, 'vless');
  assert.equal(outbound.uuid, '11111111-2222-4333-8444-555555555555');
  assert.equal(outbound.tls.reality.enabled, true);
  assert.equal(outbound.tls.reality.public_key, 'public-key');
});

test('Shadowsocks SIP002 share link becomes a usable sing-box outbound', () => {
  const credentials = Buffer.from('aes-256-gcm:secret').toString('base64url');
  const outbound = linkToSingBox(
    `ss://${credentials}@ss.example.com:8388#Tokyo`,
    'out-ss',
  );
  assert.equal(outbound.type, 'shadowsocks');
  assert.equal(outbound.method, 'aes-256-gcm');
  assert.equal(outbound.password, 'secret');
  assert.equal(outbound.server_port, 8388);
});
