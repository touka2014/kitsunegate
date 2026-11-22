import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectUpgrade } from './generation.mjs';

const binary =
  process.env.XRAY_BIN ||
  path.resolve(
    'runtime/bin',
    process.platform === 'win32' ? 'xray.exe' : 'xray',
  );
test(
  'the installed Xray accepts each supported protocol and isolates untranslatable saved outbounds',
  {
    skip:
      !process.env.XRAY_BIN && !existsSync(binary)
        ? 'Install Xray to run the binary compatibility test'
        : false,
  },
  async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'kg-core-test-'));
    const id = 'fef7207d-7619-4bd9-93d8-05e5c819bc14';
    const testKey = Buffer.alloc(32, 8).toString('base64url');
    const links = [
      'vless://' +
        id +
        '@edge.example?security=reality&pbk=' +
        testKey +
        '&type=xhttp&mode=stream-up&spx=%2Ftest&extra=%7B%22xPaddingBytes%22%3A%22100-200%22%7D',
      'vmess://' +
        Buffer.from(
          JSON.stringify({
            add: 'edge.example',
            port: 443,
            id,
            net: 'ws',
            tls: 'tls',
          }),
        ).toString('base64url'),
      'ss://' +
        Buffer.from('aes-128-gcm:test').toString('base64url') +
        '@edge.example:8388',
      'trojan://pw@edge.example?type=grpc&serviceName=svc',
      'hy2://pw@edge.example?obfs=salamander&obfs-password=abcdefgh&up=8&down=25',
      'socks://u:pw@[::1]:1080',
    ];
    const nodes = links.map((uri, i) => ({
      id: 'node-' + i,
      name: 'Fixture ' + i,
      uri,
      enabled: true,
      adapter_port: 13000 + i,
    }));
    nodes.push(
      {
        ...nodes[0],
        id: 'legacy-option',
        stored_config: {
          kind: 'singbox',
          outbound: {
            type: 'socks',
            server: 'localhost',
            server_port: 1080,
            detour: 'other',
          },
        },
      },
      {
        ...nodes[0],
        id: 'invalid-key',
        uri: links[0].replace(testKey, 'secret-should-not-appear'),
      },
    );
    try {
      const errors = await inspectUpgrade(
        [{ enabled: true, nodes }],
        binary,
        directory,
      );
      assert.deepEqual(
        errors.map((i) => i.node.id),
        ['legacy-option', 'invalid-key'],
      );
      assert.doesNotMatch(errors[1].reason, /secret-should-not-appear/);
      assert.deepEqual(readdirSync(directory), []);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
