import { nodeOutbound } from './node-config.mjs';

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

    `  stats socket ${statsSocket} mode 600 level admin expose-fd listeners`,
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

    const activeNodes = group.nodes.filter((node) => node.enabled);
    activeNodes.forEach((node, index) => {
      const selected = group.selected_node_id === node.id;
      let backup = '';
      if (group.mode === 'fallback' && index > 0) backup = ' backup';
      if (group.mode === 'fixed' && !selected) return;
      if (group.mode === 'latency_best' && group.selected_node_id && !selected)
        backup = ' backup';
      if (node.health_status === 'unhealthy') backup += ' disabled';
      lines.push(
        `  server ${escapeName(node.id)} 127.0.0.1:${node.adapter_port} weight ${node.weight} check inter 5s rise ${group.rise_threshold} fall ${group.fall_threshold}${backup}`,
      );
    });
    lines.push('');
  }
  return lines.join('\n');
}

export function renderXrayConfig(groups, options = {}) {
  const nodes = groups
    .filter((group) => group.enabled)
    .flatMap((group) => group.nodes.filter((node) => node.enabled));
  return JSON.stringify(
    {
      log: { loglevel: options.logLevel ?? 'info', access: 'none' },
      inbounds: nodes.map((node) => ({
        tag: 'in-' + node.id,
        protocol: 'socks',
        listen: '127.0.0.1',
        port: node.adapter_port,
        settings: { auth: 'noauth', udp: false },
      })),
      outbounds: [
        { protocol: 'blackhole', tag: 'unrouted' },
        ...nodes.map((node) => {
          try {
            return nodeOutbound(node);
          } catch (error) {
            throw new Error(node.name + ': ' + error.message);
          }
        }),
      ],
      routing: {
        rules: nodes.map((node) => ({
          type: 'field',
          inboundTag: ['in-' + node.id],
          outboundTag: 'out-' + node.id,
        })),
      },
    },
    null,
    2,
  );
}
