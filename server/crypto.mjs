import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataDirectory = path.resolve(
  process.env.KITSUNEGATE_DATA_DIR ?? process.env.RELAYDECK_DATA_DIR ?? 'data',
);
const keyPath = path.join(dataDirectory, '.secret');

function loadKey() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const configuredSecret =
    process.env.KITSUNEGATE_SECRET ?? process.env.RELAYDECK_SECRET;
  if (configuredSecret) {
    return crypto.createHash('sha256').update(configuredSecret).digest();
  }
  if (!fs.existsSync(keyPath)) {
    fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('base64'), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
  return Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'base64');
}

const key = loadKey();

export function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSecret(value) {
  if (!value) return '';
  const [version, ivText, tagText, encryptedText] = value.split('.');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
    throw new Error(
      'Unable to read the node encryption key; check the local key file.',
    );
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskProxyUri(value) {
  if (!value) return '';
  try {
    const protocol = value.split('://')[0]?.toUpperCase() || 'PROXY';
    const label = decodeURIComponent(value.split('#')[1] ?? '').trim();
    return label ? `${protocol} · ${label}` : `${protocol} · encrypted`;
  } catch {
    return 'Node credentials are encrypted';
  }
}
