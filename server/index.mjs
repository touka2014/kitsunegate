import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { probeOptions } from './probes.mjs';

import {
  addRuntimeLog,
  createGroup,
  createNode,
  deleteGroup,
  deleteNode,
  databasePath,
  getNodeConfig,
  getRuntimeLogs,
  getSettings,
  getState,
  getTrafficTrend,
  updateSettings,
  updateGroup,
  updateNode,
} from './database.mjs';

import { runtime } from './runtime.mjs';

const port = Number(
  process.env.KITSUNEGATE_API_PORT ?? process.env.RELAYDECK_API_PORT ?? 8787,
);
const allowedOrigin =
  process.env.KITSUNEGATE_WEB_ORIGIN ??
  process.env.RELAYDECK_WEB_ORIGIN ??
  'http://localhost:3000';

const apiSocket = process.env.KITSUNEGATE_API_SOCKET;
let localAuthorization;
if (!apiSocket) {
  const passwordFile = path.join(path.dirname(databasePath), '.admin-password');
  let password = process.env.KITSUNEGATE_ADMIN_PASSWORD;
  if (!password) {
    try {
      fs.writeFileSync(
        passwordFile,
        crypto.randomBytes(24).toString('base64url'),
        { flag: 'wx', mode: 0o600 },
      );
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    password = fs.readFileSync(passwordFile, 'utf8').trim();
    console.log('Local dashboard password file: ' + passwordFile);
  }
  localAuthorization =
    'Basic ' +
    Buffer.from(
      (process.env.KITSUNEGATE_ADMIN_USER || 'kitsunegate') + ':' + password,
    ).toString('base64');
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Cache-Control': 'no-store',
  });
  response.end(status === 204 ? '' : JSON.stringify(payload));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024)
      throw new Error('Request body exceeds the 1 MB limit.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Request body contains invalid JSON.');
  }
}

const server = http.createServer(async (request, response) => {
  if (request.url === '/readyz' && request.method === 'GET') {
    const ready = runtime.getStatus().status === 'running';
    return sendJson(response, ready ? 200 : 503, { ready });
  }
  const origin = request.headers.origin;
  const host = request.headers.host;
  const sameProxyOrigin =
    apiSocket && origin === `${request.headers['x-forwarded-proto']}://${host}`;
  const sameLocalOrigin =
    !apiSocket &&
    ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(origin);
  if (
    origin &&
    origin !== allowedOrigin &&
    !sameProxyOrigin &&
    !sameLocalOrigin
  )
    return sendJson(response, 403, { error: 'Untrusted request origin.' });
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
  if (!apiSocket && request.headers.authorization !== localAuthorization) {
    response.setHeader('WWW-Authenticate', 'Basic realm="KitsuneGate"');
    return sendJson(response, 401, {
      error: 'Management credentials required.',
    });
  }
  if (
    ['POST', 'PUT', 'DELETE'].includes(request.method) &&
    request.headers['content-type']?.split(';')[0].toLowerCase() !==
      'application/json'
  )
    return sendJson(response, 415, {
      error: 'Use application/json for management writes.',
    });
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  const segments = url.pathname.split('/').filter(Boolean);

  try {
    if (request.method === 'GET' && url.pathname === '/api/state') {
      const state = getState();
      const metrics = runtime.getMetrics();
      return sendJson(response, 200, {
        ...state,
        engine: runtime.getStatus(),
        groups: state.groups.map((group) => ({
          ...group,
          nodes: group.nodes.map((n) => ({
            ...n,
            adapterPort: runtime.generation?.ports.get(n.id) ?? n.adapterPort,
          })),
          stats: {
            ...group.stats,
            connections: metrics[group.id]?.activeConnections ?? 0,
            throughputMbps: Number(
              (
                (((metrics[group.id]?.speedIn ?? 0) +
                  (metrics[group.id]?.speedOut ?? 0)) *
                  8) /
                1_000_000
              ).toFixed(2),
            ),
            speedInMbps: Number(
              (((metrics[group.id]?.speedIn ?? 0) * 8) / 1_000_000).toFixed(3),
            ),
            speedOutMbps: Number(
              (((metrics[group.id]?.speedOut ?? 0) * 8) / 1_000_000).toFixed(3),
            ),
            bytesIn: metrics[group.id]?.bytesIn ?? 0,
            bytesOut: metrics[group.id]?.bytesOut ?? 0,
            totalConnections: metrics[group.id]?.totalConnections ?? 0,
          },
        })),
        settings: getSettings(),
        runtimeLogs: getRuntimeLogs({ limit: 50 }),
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/metrics/history') {
      return sendJson(
        response,
        200,
        getTrafficTrend(url.searchParams.get('range') ?? '1h'),
      );
    }
    if (request.method === 'GET' && url.pathname === '/api/logs') {
      return sendJson(response, 200, {
        logs: getRuntimeLogs({
          limit: url.searchParams.get('limit') ?? 300,
          level: url.searchParams.get('level') ?? 'all',
          source: url.searchParams.get('source') ?? 'all',
          search: url.searchParams.get('search') ?? '',
        }),
      });
    }
    if (request.method === 'PUT' && url.pathname === '/api/settings') {
      const input = await readBody(request);
      const settings = await runtime.reload(
        'Settings updated',
        () => updateSettings(input),
        (a, b) => a.logLevel !== b.logLevel,
      );
      runtime.applySettings();
      return sendJson(response, 200, settings);
    }
    if (request.method === 'GET' && url.pathname === '/api/engine/preview') {
      return sendJson(response, 200, {
        haproxy: runtime.generation?.haConfig ?? '',
        singbox: runtime.generation?.singConfig ?? '',
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/groups') {
      const input = {
        ...(await readBody(request)),
        id: 'grp_' + crypto.randomUUID(),
      };
      const result = await runtime.reload('Proxy group added', () =>
        createGroup(input),
      );
      return sendJson(response, 201, result);
    }
    if (request.method === 'POST' && url.pathname === '/api/groups/test-all') {
      return sendJson(response, 200, { groups: await runtime.testAll() });
    }
    if (request.method === 'POST' && url.pathname === '/api/engine/reload') {
      return sendJson(response, 200, await runtime.reload('Manual reload'));
    }
    if (segments[0] === 'api' && segments[1] === 'groups' && segments[2]) {
      const groupId = segments[2];
      if (request.method === 'PUT' && segments.length === 3) {
        const input = await readBody(request);
        const result = await runtime.reload(
          'Proxy group configuration updated',
          () => updateGroup(groupId, input),
        );
        return sendJson(response, 200, result);
      }
      if (request.method === 'DELETE' && segments.length === 3) {
        const result = await runtime.reload('Proxy group deleted', () =>
          deleteGroup(groupId),
        );
        return sendJson(response, 200, result);
      }
      if (request.method === 'POST' && segments[3] === 'nodes') {
        const input = {
          ...(await readBody(request)),
          id: 'node_' + crypto.randomUUID(),
        };
        const result = await runtime.reload('Proxy node added', () =>
          createNode(groupId, input),
        );
        return sendJson(response, 201, result);
      }
      if (request.method === 'POST' && segments[3] === 'test') {
        const { draft } = await readBody(request);
        const options = draft
          ? probeOptions(draft.probeUrls, draft.probeTimeout)
          : undefined;
        return sendJson(
          response,
          200,
          await runtime.testGroup(groupId, options),
        );
      }
    }
    if (segments[0] === 'api' && segments[1] === 'nodes' && segments[2]) {
      const nodeId = segments[2];
      if (request.method === 'GET' && segments[3] === 'config') {
        return sendJson(response, 200, getNodeConfig(nodeId));
      }
      if (request.method === 'PUT' && segments.length === 3) {
        const input = await readBody(request);
        const result = await runtime.reload(
          'Proxy node configuration updated',
          () => updateNode(nodeId, input),
        );
        return sendJson(response, 200, result);
      }
      if (request.method === 'DELETE' && segments.length === 3) {
        const result = await runtime.reload('Proxy node deleted', () =>
          deleteNode(nodeId),
        );
        return sendJson(response, 200, result);
      }
      if (request.method === 'POST' && segments[3] === 'test') {
        return sendJson(response, 200, await runtime.testNode(nodeId));
      }
    }
    return sendJson(response, 404, { error: 'Endpoint not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = /不存在|not found/i.test(message)
      ? 404
      : /占用|无效|请输入|必须|至少|支持|格式|限制|缺少|没有找到|无法识别|configuration rejected|invalid|require|must|at least|supported|limit|missing|recognize|already (in use|used)|EADDRINUSE|exceeds/i.test(
            message,
          )
        ? 400
        : 500;
    addRuntimeLog(
      'api',
      status >= 500 ? 'error' : 'warning',
      `${request.method} ${url.pathname}：${message}`,
    );
    return sendJson(response, status, { error: message });
  }
});

await runtime.start();

if (apiSocket) {
  // The directory is private to this container, shared only with nginx.
  fs.rmSync(apiSocket, { force: true });
  process.umask(0o077);
  server.listen(apiSocket, () =>
    console.log('KitsuneGate management socket ready.'),
  );
} else
  server.listen(port, '127.0.0.1', () =>
    console.log('KitsuneGate API on loopback port ' + port),
  );

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(
    signal,
    () =>
      void runtime.stop().finally(() => server.close(() => process.exit(0))),
  );
}
