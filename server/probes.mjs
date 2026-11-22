import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';

// Each existing bare URL remains valid. An optional status after a space
// overrides the default (204 for generate_204, any 2xx elsewhere).
export function probeTarget(line) {
  const match = /^(\S+)(?:[ \t]+([1-5]\d{2}))?$/.exec(String(line).trim());
  if (!match) throw new Error('Invalid probe target. Use URL or URL STATUS.');
  const url = new URL(match[1]);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      'Invalid probe URL. Use HTTP or HTTPS without credentials.',
    );
  return {
    url,
    expected: match[2]
      ? Number(match[2])
      : /\/generate_204\/?$/.test(url.pathname)
        ? 204
        : null,
  };
}

export function probeOptions(urls, timeout) {
  if (!Array.isArray(urls)) throw new Error('Probe URLs must be a list.');
  const lines = urls.map((value) => String(value).trim()).filter(Boolean);
  if (!lines.length) throw new Error('At least one probe URL is required.');
  for (const line of lines) probeTarget(line);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60)
    throw new Error('Probe timeout must be 1–60 seconds.');
  return { probe_urls: lines, probe_timeout: timeout };
}

// Read only the requested bytes. A single TCP packet can contain the SOCKS reply
// and the start of the next protocol, or either record may span multiple packets.
function readBytes(socket, count) {
  return new Promise((resolve, reject) => {
    function finish(error, data) {
      socket.off('readable', read);
      socket.off('end', closed);
      socket.off('close', closed);
      socket.off('error', finish);
      if (error) reject(error);
      else resolve(data);
    }
    function closed() {
      finish(new Error('SOCKS connection closed early'));
    }
    function read() {
      const data = socket.read(count);
      if (data !== null) finish(null, data);
      else if (socket.readableEnded || socket.destroyed) closed();
    }
    socket.on('readable', read);
    socket.once('end', closed);
    socket.once('close', closed);
    socket.once('error', finish);
    read();
  });
}

async function negotiateSocks(socket, host, port) {
  socket.write(Buffer.from([5, 1, 0]));
  const greeting = await readBytes(socket, 2);
  if (greeting[0] !== 5 || greeting[1] !== 0)
    throw new Error('SOCKS5 authentication negotiation failed');
  const address = Buffer.from(host);
  if (address.length > 255) throw new Error('Probe hostname is too long');
  socket.write(
    Buffer.concat([
      Buffer.from([5, 1, 0, 3, address.length]),
      address,
      Buffer.from([port >> 8, port & 255]),
    ]),
  );
  const reply = await readBytes(socket, 4);
  if (reply[0] !== 5 || reply[1] !== 0 || reply[2] !== 0)
    throw new Error('SOCKS5 connection failed with code ' + reply[1]);
  const length =
    reply[3] === 1
      ? 4
      : reply[3] === 4
        ? 16
        : reply[3] === 3
          ? (await readBytes(socket, 1))[0]
          : 0;
  if (!length) throw new Error('Invalid SOCKS5 reply address');
  await readBytes(socket, length + 2);
}

export async function probeThroughNode(node, probeUrl, timeoutSeconds) {
  const started = performance.now();
  let socket, stream;
  const deadline = setTimeout(
    () => (stream ?? socket)?.destroy(new Error('Health check timed out')),
    timeoutSeconds * 1000,
  );
  try {
    const { url, expected } = probeTarget(probeUrl);
    probeUrl = url.href;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const secure = url.protocol === 'https:';
    socket = net.createConnection({
      host: '127.0.0.1',
      port: node.adapter_port,
    });
    await once(socket, 'connect');
    await negotiateSocks(socket, host, Number(url.port || (secure ? 443 : 80)));
    stream = secure
      ? tls.connect({
          socket,
          host,
          servername: net.isIP(host) ? undefined : host,
          rejectUnauthorized: true,
        })
      : socket;
    if (secure) await once(stream, 'secureConnect');
    stream.write(
      'GET ' +
        url.pathname +
        url.search +
        ' HTTP/1.1\r\nHost: ' +
        url.host +
        '\r\nUser-Agent: KitsuneGate\r\nConnection: close\r\n\r\n',
    );
    let line = '';
    for await (const chunk of stream) {
      line += chunk.toString(
        'latin1',
        0,
        Math.min(chunk.length, 8194 - line.length),
      );
      const end = line.indexOf('\r\n');
      if (end < 0 && line.length < 8194) continue;
      const match =
        end >= 0 &&
        /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s|$)/.exec(line.slice(0, end));
      if (!match) throw new Error('Invalid HTTP status line');
      const statusCode = Number(match[1]);
      const ok =
        expected === null
          ? statusCode >= 200 && statusCode < 300
          : statusCode === expected;
      return {
        ok,
        statusCode,
        latencyMs: performance.now() - started,
        url: probeUrl,
        error: ok
          ? null
          : 'HTTP ' + statusCode + '; expected ' + (expected ?? '2xx'),
      };
    }
    throw new Error('Connection closed before HTTP response');
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: null,
      url: probeUrl,
      error: error.message,
    };
  } finally {
    clearTimeout(deadline);
    stream?.destroy();
    socket?.destroy();
  }
}
