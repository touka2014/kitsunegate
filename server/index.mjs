import http from 'node:http';

import {
  addRuntimeLog,
  createGroup,
  createNode,
  deleteGroup,
  deleteNode,
  getRawStateForEngine,
  getNodeConfig,
  getRuntimeLogs,
  getSettings,
  getState,
  getTrafficTrend,
  updateSettings,
  updateGroup,
  updateNode,
} from './database.mjs';
import { renderHAProxyConfig, renderSingBoxConfig } from './engine.mjs';
import { runtime } from './runtime.mjs';

const port = Number(
  process.env.KITSUNEGATE_API_PORT ?? process.env.RELAYDECK_API_PORT ?? 8787,
);
const allowedOrigin =
  process.env.KITSUNEGATE_WEB_ORIGIN ??
  process.env.RELAYDECK_WEB_ORIGIN ??
  'http://localhost:3000';

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
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});
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
      const previous = getSettings();
      const settings = updateSettings(await readBody(request));
      runtime.applySettings();
      if (settings.logLevel !== previous.logLevel)
        await runtime.reload('Core log level updated');
      return sendJson(response, 200, settings);
    }
    if (request.method === 'GET' && url.pathname === '/api/engine/preview') {
      const state = getRawStateForEngine();
      return sendJson(response, 200, {
        haproxy: renderHAProxyConfig(state),
        singbox: renderSingBoxConfig(state, {
          logLevel: getSettings().logLevel,
        }),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/groups') {
      const result = createGroup(await readBody(request));
      await runtime.reload('Proxy group added');
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
        const result = updateGroup(groupId, await readBody(request));
        await runtime.reload('Proxy group configuration updated');
        return sendJson(response, 200, result);
      }
      if (request.method === 'DELETE' && segments.length === 3) {
        const result = deleteGroup(groupId);
        await runtime.reload('Proxy group deleted');
        return sendJson(response, 200, result);
      }
      if (request.method === 'POST' && segments[3] === 'nodes') {
        const result = createNode(groupId, await readBody(request));
        await runtime.reload('Proxy node added');
        return sendJson(response, 201, result);
      }
      if (request.method === 'POST' && segments[3] === 'test') {
        return sendJson(response, 200, await runtime.testGroup(groupId));
      }
    }
    if (segments[0] === 'api' && segments[1] === 'nodes' && segments[2]) {
      const nodeId = segments[2];
      if (request.method === 'GET' && segments[3] === 'config') {
        return sendJson(response, 200, getNodeConfig(nodeId));
      }
      if (request.method === 'PUT' && segments.length === 3) {
        const result = updateNode(nodeId, await readBody(request));
        await runtime.reload('Proxy node configuration updated');
        return sendJson(response, 200, result);
      }
      if (request.method === 'DELETE' && segments.length === 3) {
        const result = deleteNode(nodeId);
        await runtime.reload('Proxy node deleted');
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
      : /占用|无效|请输入|必须|至少|支持|格式|限制|缺少|没有找到|无法识别|invalid|required|must|at least|supported|limit|missing|recognize|already in use|exceeds/i.test(
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

server.listen(port, '127.0.0.1', () => {
  console.log(`KitsuneGate API: http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(
    signal,
    () =>
      void runtime.stop().finally(() => server.close(() => process.exit(0))),
  );
}
