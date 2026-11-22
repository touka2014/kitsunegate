import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import test from 'node:test';
import { probeThroughNode } from './probes.mjs';

async function withProxy(onRequest, run) {
  const clients = new Set();
  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => clients.delete(socket));
    socket.once('data', () => {
      socket.write(Buffer.from([5, 0]));
      socket.once('data', () => onRequest(socket));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run({ adapter_port: server.address().port });
  } finally {
    for (const socket of clients) socket.destroy();
    await new Promise((r) => server.close(r));
  }
}

test('a SOCKS reply split across packets retains a coalesced HTTP response', async () => {
  await withProxy(
    (socket) => {
      socket.write(Buffer.from([5, 0, 0, 3, 3, 97]));
      socket.write(
        Buffer.concat([
          Buffer.from([98, 99, 0, 80]),
          Buffer.from('HTTP/1.1 204 No Content\r\n\r\n'),
        ]),
      );
    },
    async (node) => {
      const result = await probeThroughNode(
        node,
        'http://test.invalid/generate_204',
        2,
      );
      assert.equal(result.statusCode, 204);
    },
  );
});

test('HTTP probes stop on EOF and share one deadline across handshake and response', async () => {
  await withProxy(
    (socket) => socket.end(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80])),
    async (node) => {
      const result = await probeThroughNode(node, 'http://test.invalid/', 5);
      assert.match(result.error, /closed/i);
    },
  );
  await withProxy(
    (socket) => {
      const timer = setTimeout(
        () => socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80])),
        400,
      );
      socket.once('close', () => clearTimeout(timer));
      socket.once('data', () =>
        setTimeout(() => {
          if (!socket.destroyed) socket.end('HTTP/1.1 200 OK\r\n\r\n');
        }, 800).unref(),
      );
    },
    async (node) => {
      const result = await probeThroughNode(node, 'http://test.invalid/', 1);
      assert.equal(result.ok, false);
      assert.match(result.error, /timed out/);
    },
  );
});
