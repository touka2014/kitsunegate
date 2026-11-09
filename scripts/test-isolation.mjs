// Run inside a disposable, freshly seeded KitsuneGate container.
// docker exec -i CONTAINER node --input-type=module < scripts/test-isolation.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const auth =
  'Basic ' +
  Buffer.from(
    (process.env.KITSUNEGATE_ADMIN_USER || 'kitsunegate') +
      ':' +
      process.env.KITSUNEGATE_ADMIN_PASSWORD,
  ).toString('base64');
const base = 'http://127.0.0.1:8080';
async function api(path, method = 'GET', body, expected = 200) {
  const r = await fetch(base + '/api' + path, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const result = await r.json();
  assert.equal(r.status, expected, result.error);
  return result;
}
const state = () => api('/state');
assert.equal(
  (await state()).groups.flatMap((g) => g.nodes).length,
  0,
  'disposable instance required',
);
const block = Buffer.alloc(65536, 0xa7);
const sent = crypto.createHash('sha256'),
  received = crypto.createHash('sha256');
let requests = 0,
  blocks = 0,
  done = false,
  receivedBytes = 0;
const target = http.createServer((req, res) => {
  if (req.url !== '/transfer') {
    res.writeHead(204);
    res.end();
    return;
  }
  requests++;
  const timer = setInterval(() => {
    if (done) {
      clearInterval(timer);
      res.end();
      return;
    }
    block.writeUInt32BE(blocks++);
    sent.update(block);
    res.write(Buffer.from(block));
  }, 10);
  res.on('close', () => clearInterval(timer));
});
async function localListen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
const targetPort = await localListen(target);
const proxy = net.createServer((client) => {
  client.on('error', () => {});
  client.once('data', () => {
    client.write(Buffer.from([5, 0]));
    client.once('data', (request) => {
      if (request.readUInt16BE(request.length - 2) !== targetPort) {
        client.destroy();
        return;
      }
      const dest = net.createConnection(targetPort, '127.0.0.1', () => {
        client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
        client.pipe(dest).pipe(client);
      });
      dest.on('error', () => client.destroy());
      client.on('close', () => dest.destroy());
    });
  });
});
const proxyPort = await localListen(proxy);
const checkUrl = 'http://127.0.0.1:' + targetPort + '/generate_204';
let curl;
try {
  assert.equal((await fetch(base + '/api/state')).status, 401);
  assert.equal(
    (
      await fetch(base + '/api/groups', {
        method: 'POST',
        headers: {
          Authorization: auth,
          Origin: 'https://untrusted.invalid',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + '/api/groups', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'text/plain' },
        body: '{}',
      })
    ).status,
    415,
  );
  assert.equal((await fetch(base + '/readyz')).status, 200);
  await api('/groups/grp_jp', 'PUT', {
    probeUrls: [checkUrl],
    riseThreshold: 1,
  });
  const node = await api(
    '/groups/grp_jp/nodes',
    'POST',
    { uri: 'socks://127.0.0.1:' + proxyPort },
    201,
  );
  const report = await api('/nodes/' + node.id + '/test', 'POST');
  assert.equal(report.probe.statusCode, 204);
  const before = await state();
  curl = spawn('curl', [
    '--silent',
    '--show-error',
    '--fail',
    '--max-time',
    '70',
    '--noproxy',
    '',
    '--proxy',
    'socks5h://127.0.0.1:2288',
    'http://127.0.0.1:' + targetPort + '/transfer',
  ]);
  const completed = once(curl, 'exit');
  curl.stderr.pipe(process.stderr);
  curl.stdout.on('data', (chunk) => {
    receivedBytes += chunk.length;
    received.update(chunk);
  });
  await Promise.race([
    once(curl.stdout, 'data'),
    completed.then(() => {
      throw Error('transfer never started');
    }),
  ]);
  async function rejected(label, path, method, body) {
    const initial = receivedBytes;
    const error = await api(path, method, body, 400);
    await delay(150);
    const after = await state();
    assert.equal(after.engine.configPath, before.engine.configPath);
    assert.equal(after.engine.status, 'running');
    const us = after.groups.find((g) => g.id === 'grp_us');
    assert.equal(us.listenPort, 1188);
    assert.equal(us.nodes.length, 0);
    assert.ok(receivedBytes > initial, label + ' stalled');
    console.log(
      label,
      'HTTP 400, same generation, bytes advanced by',
      receivedBytes - initial,
    );
    assert.ok(error.error);
  }
  await rejected('Missing Reality key', '/groups/grp_us/nodes', 'POST', {
    uri: 'vless://id@example.org:443?security=reality',
  });
  await rejected('sing-box binary validation', '/groups/grp_us/nodes', 'POST', {
    sourceType: 'json',
    json: {
      type: 'socks',
      server: '127.0.0.1',
      server_port: proxyPort,
      invalid_field_for_test: true,
    },
  });
  await rejected('Occupied US listener', '/groups/grp_us', 'PUT', {
    listenHost: '127.0.0.1',
    listenPort: targetPort,
  });
  // Also exercise concurrent accepted saves and draining across a successful handoff.
  await Promise.all([
    api('/groups/grp_us', 'PUT', { name: 'US saved' }),
    api('/groups/grp_sg', 'PUT', { name: 'SG saved' }),
  ]);
  const after = await state();
  assert.ok(after.groups.some((g) => g.name === 'US saved'));
  assert.ok(after.groups.some((g) => g.name === 'SG saved'));
  assert.notEqual(after.engine.configPath, before.engine.configPath);
  const fresh = spawn('curl', [
    '--silent',
    '--fail',
    '--max-time',
    '8',
    '--noproxy',
    '',
    '--proxy',
    'socks5h://127.0.0.1:2288',
    checkUrl,
  ]);
  assert.equal(
    (await once(fresh, 'exit'))[0],
    0,
    'new Japanese connection after handoff',
  );
  await delay(1000);
  done = true;
  const [code] = await completed;
  assert.equal(code, 0);
  assert.equal(requests, 1);
  assert.equal(receivedBytes, blocks * block.length);
  let counted = 0;
  for (let i = 0; i < 30 && counted < receivedBytes; i++) {
    await delay(150);
    counted = (await state()).groups.find((g) => g.id === 'grp_jp').stats
      .bytesOut;
  }
  assert.ok(
    counted >= receivedBytes,
    'traffic from draining connections must be counted: ' +
      counted +
      '/' +
      receivedBytes,
  );
  const digest = received.digest('hex');
  assert.equal(digest, sent.digest('hex'));
  console.log(
    JSON.stringify(
      {
        requests,
        receivedBytes,
        counted,
        sha256: digest,
        core: after.engine.balancer,
      },
      null,
      2,
    ),
  );
} finally {
  done = true;
  curl?.kill();
  target.closeAllConnections();
  target.close();
  proxy.close();
}
