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
