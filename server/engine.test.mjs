import assert from 'node:assert/strict';
import test from 'node:test';

import { renderHAProxyConfig, renderSingBoxConfig } from './engine.mjs';

const baseGroup = {
  id: 'test-pool',
  enabled: true,
  listen_host: '0.0.0.0',
  listen_port: 1188,
  mode: 'fallback',
  algorithm: 'leastconn',
  selected_node_id: 'node-a',
  rise_threshold: 2,
  fall_threshold: 3,
  probe_urls: ['https://example.com/generate_204'],
  nodes: [
    {
      id: 'node-a',
      enabled: true,
      adapter_port: 12001,
      weight: 10,
      protocol: 'socks',
      server: '127.0.0.1',
      server_port: 1080,
      uri: 'socks://user:pass@127.0.0.1:1080',
    },
    {
      id: 'node-b',
      enabled: true,
      adapter_port: 12002,
      weight: 5,
      protocol: 'vless',
      server: 'proxy.example.com',
      server_port: 443,
      uri: 'vless://uuid@proxy.example.com:443?security=tls&sni=proxy.example.com',
    },
  ],
};

test('HAProxy fallback marks secondary nodes as backup', () => {
  const config = renderHAProxyConfig([baseGroup]);
  assert.match(config, /bind 0\.0\.0\.0:1188/);
  assert.match(config, /server node-a 127\.0\.0\.1:12001 weight 10 check/);
  assert.match(config, /server node-b 127\.0\.0\.1:12002.* backup/);
});

test('fixed mode never exposes another node at startup', () => {
  const config = renderHAProxyConfig([{ ...baseGroup, mode: 'fixed' }]);
  assert.match(config, /server node-a /);
  assert.doesNotMatch(config, /server node-b /);
  assert.doesNotMatch(
    renderHAProxyConfig([
      { ...baseGroup, mode: 'fixed', selected_node_id: null },
    ]),
    /server node-/,
  );
});

test('sing-box exposes one local adapter inbound per enabled node', () => {
  const config = JSON.parse(renderSingBoxConfig([baseGroup]));
  assert.equal(config.inbounds.length, 2);
  assert.deepEqual(
    config.inbounds.map((item) => item.listen_port),
    [12001, 12002],
  );
  assert.equal(config.route.rules[1].outbound, 'out-node-b');
});
