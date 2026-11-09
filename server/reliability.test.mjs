import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { once } from 'node:events';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsunegate-test-'));
process.env.KITSUNEGATE_DATA_DIR = dir;
process.env.KITSUNEGATE_RUNTIME_DIR = path.join(dir, 'runtime');
process.env.KITSUNEGATE_SEED_DEMO_NODES = '0';
const {
  db,
  createNode,
  getState,
  deleteGroup,
  updateGroup,
  recordNodeHealth,
  getTrafficTrend,
} = await import('./database.mjs');
const { runtime } = await import('./runtime.mjs');
after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unusable links are rejected before insertion, including disabled links', () => {
  const count = getState().groups[0].nodes.length;
  assert.throws(
    () =>
      createNode('grp_us', {
        uri: 'vless://id@example.org:443?security=reality',
        enabled: false,
      }),
    /public key/i,
  );
  assert.equal(getState().groups[0].nodes.length, count);
});

test('split status line, explicit expected status, draft isolation, and all-down fixed routing', async () => {
  const stub = net.createServer((socket) => {
    let step = 0;
    socket.on('error', () => {});
    socket.on('data', (data) => {
      if (++step === 1) {
        socket.write(Buffer.from([5, 0]));
        return;
      }
      if (step === 2) {
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
        return;
      }
      const status = data.toString().includes('GET /bad')
        ? '407 Proxy Authentication Required'
        : '204 No Content';
      socket.write('HTTP/1.');
      setTimeout(
        () => socket.end('1 ' + status + '\r\nConnection: close\r\n\r\n'),
        15,
      );
    });
  });
  stub.listen(0, '127.0.0.1');
  await once(stub, 'listening');
  try {
    const n = createNode('grp_us', {
      uri: 'socks://127.0.0.1:1080',
      adapterPort: stub.address().port,
    });
    updateGroup('grp_us', {
      probeUrls: ['http://probe.invalid/generate_204'],
      riseThreshold: 1,
      fallThreshold: 1,
      mode: 'fixed',
      selectedNodeId: n.id,
    });
    assert.equal((await runtime.testNode(n.id)).healthStatus, 'healthy');
    const draft = await runtime.testGroup('grp_us', {
      probe_urls: ['http://probe.invalid/bad'],
      probe_timeout: 2,
    });
    assert.equal(draft.results[0].probe.statusCode, 407);
    assert.equal(draft.results[0].probe.ok, false);
    assert.equal(draft.results[0].healthStatus, 'healthy');
    assert.equal(
      (
        await runtime.testGroup('grp_us', {
          probe_urls: ['http://probe.invalid/ok 200'],
          probe_timeout: 2,
        })
      ).results[0].probe.ok,
      false,
    );
    recordNodeHealth(n.id, { ok: false, error: 'down', latencyMs: null });
    assert.equal(runtime.selectNode({ id: 'grp_us' }, {}), null);
  } finally {
    await new Promise((resolve) => stub.close(resolve));
  }
});

test('traffic rates weight coverage, split crossing intervals and preserve missing buckets', () => {
  const base = Math.floor(Date.now() / 60000) * 60000 - 120000;
  const insert = db.prepare(
    'INSERT INTO traffic_samples(group_id,bytes_in,bytes_out,active_connections,total_connections,bytes_in_per_second,bytes_out_per_second,interval_ms,created_at) VALUES(?,1000,0,0,0,?,0,?,?)',
  );
  for (const [offset, rate, ms] of [
    [1000, 1000, 1000],
    [10000, 0, 9000],
    [62000, 20, 4000],
  ])
    insert.run('grp_jp', rate, ms, new Date(base + offset).toISOString());
  const points = getTrafficTrend('6h').points;
  const at = (offset) =>
    points.find((p) => Date.parse(p.createdAt) === base + offset)
      .bytesInPerSecond;
  assert.equal(at(0), 1040 / 12);
  assert.equal(at(60000), 20);
  assert.equal(at(-60000), null);
});

test('an intentionally empty installation stays empty after reopening SQLite', async () => {
  for (const g of getState().groups) deleteGroup(g.id);
  const reopened = await import('./database.mjs?reopen');
  try {
    assert.equal(reopened.getState().groups.length, 0);
  } finally {
    reopened.db.close();
  }
});
