import { linkToSingBox, manualToSingBox } from './node-config.mjs';

function escapeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function modeAlgorithm(group) {
  return group.mode === 'load_balance' ? group.algorithm : 'roundrobin';
}

export function renderHAProxyConfig(groups, options = {}) {
  const statsSocket = options.statsSocket ?? '/run/kitsunegate/haproxy.sock';
  const lines = [
    'global',
    '  log stdout format raw local0',
    '  master-worker',
    `  stats socket ${statsSocket} mode 660 level admin`,
    '  maxconn 60000',
    '',
    'defaults',
    '  mode tcp',
    '  log global',
    '  option tcplog',
    '  option dontlognull',
    '  option redispatch',
    '  retries 2',
    '  timeout connect 10s',
    '  timeout client 1m',
    '  timeout server 1m',
    '  timeout check 5s',
    '',
  ];

  for (const group of groups.filter((item) => item.enabled)) {
    lines.push(`listen pool_${escapeName(group.id)}`);
    lines.push(`  bind ${group.listen_host}:${group.listen_port}`);
    lines.push('  mode tcp');
    lines.push(`  balance ${modeAlgorithm(group)}`);
    lines.push(`  # probe_urls: ${group.probe_urls.join(', ')}`);
    const activeNodes = group.nodes.filter((node) => node.enabled);
    activeNodes.forEach((node, index) => {
      const selected = group.selected_node_id === node.id;
      let backup = '';
      if (group.mode === 'fallback' && index > 0) backup = ' backup';
      if (
        (group.mode === 'fixed' || group.mode === 'latency_best') &&
        group.selected_node_id &&
        !selected
      )
        backup = ' backup';
      lines.push(
        `  server ${escapeName(node.id)} 127.0.0.1:${node.adapter_port} weight ${node.weight} check inter 5s rise ${group.rise_threshold} fall ${group.fall_threshold}${backup}`,
      );
    });
    lines.push('');
  }
  return lines.join('\n');
}

function parseSimpleUri(node) {
  if (node.stored_config?.kind === 'singbox') {
    return { ...node.stored_config.outbound, tag: `out-${node.id}` };
  }
  if (node.stored_config?.kind === 'manual') {
    return manualToSingBox(node.stored_config.config, `out-${node.id}`);
  }
  try {
    return linkToSingBox(node.uri, `out-${node.id}`);
  } catch (error) {
    throw new Error(
      `${node.name || node.id}: ${error instanceof Error ? error.message : 'Failed to parse the share link'}`,
    );
  }
}

export function renderSingBoxConfig(groups, options = {}) {
  const nodes = groups
    .flatMap((group) => group.nodes)
    .filter((node) => node.enabled);
  const parsedNodes = nodes.flatMap((node) => {
    try {
      return [{ node, outbound: parseSimpleUri(node) }];
    } catch {
      return [];
    }
  });
  return JSON.stringify(
    {
      $schema: 'https://sing-box.sagernet.org/schema.json',
      log: {
        level:
          options.logLevel === 'warning'
            ? 'warn'
            : (options.logLevel ?? 'info'),
        timestamp: true,
      },
      inbounds: parsedNodes.map(({ node }) => ({
        type: 'socks',
        tag: `in-${node.id}`,
        listen: '127.0.0.1',
        listen_port: node.adapter_port,
      })),
      outbounds: [
        ...parsedNodes.map(({ outbound }) => outbound),
        { type: 'direct', tag: 'direct' },
      ],
      route: {
        rules: parsedNodes.map(({ node }) => ({
          inbound: [`in-${node.id}`],
          action: 'route',
          outbound: `out-${node.id}`,
        })),
      },
    },
    null,
    2,
  );
}
