export const DEFAULT_SETTINGS = Object.freeze({
  metricsSampleIntervalSeconds: 2,
  metricsRetentionDays: 7,
  logLevel: 'info',
  logRetentionDays: 7,
  uiLanguage: 'en',
});

export const LOG_LEVELS = Object.freeze(['debug', 'info', 'warning', 'error']);
export const UI_LANGUAGES = Object.freeze(['en', 'zh-CN', 'ja', 'fr', 'ko']);

const RANGE_DEFINITIONS = Object.freeze({
  '30m': { seconds: 30 * 60, bucketSeconds: 5, label: '30 分钟' },
  '1h': { seconds: 60 * 60, bucketSeconds: 10, label: '1 小时' },
  '6h': { seconds: 6 * 60 * 60, bucketSeconds: 60, label: '6 小时' },
  '12h': { seconds: 12 * 60 * 60, bucketSeconds: 120, label: '12 小时' },
  '24h': { seconds: 24 * 60 * 60, bucketSeconds: 300, label: '24 小时' },
  '7d': { seconds: 7 * 24 * 60 * 60, bucketSeconds: 1800, label: '7 天' },
});

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function normalizeSettings(input = {}, current = DEFAULT_SETTINGS) {
  const logLevel = LOG_LEVELS.includes(input.logLevel)
    ? input.logLevel
    : current.logLevel;
  const uiLanguage = UI_LANGUAGES.includes(input.uiLanguage)
    ? input.uiLanguage
    : current.uiLanguage;
  return {
    metricsSampleIntervalSeconds: boundedInteger(
      input.metricsSampleIntervalSeconds,
      current.metricsSampleIntervalSeconds,
      1,
      60,
    ),
    metricsRetentionDays: boundedInteger(
      input.metricsRetentionDays,
      current.metricsRetentionDays,
      1,
      30,
    ),
    logLevel,
    logRetentionDays: boundedInteger(
      input.logRetentionDays,
      current.logRetentionDays,
      1,
      90,
    ),
    uiLanguage,
  };
}

export function rangeDefinition(range) {
  return {
    key: RANGE_DEFINITIONS[range] ? range : '1h',
    ...(RANGE_DEFINITIONS[range] ?? RANGE_DEFINITIONS['1h']),
  };
}

export function levelAllows(configuredLevel, messageLevel) {
  const threshold = LOG_LEVELS.indexOf(configuredLevel);
  const level = LOG_LEVELS.indexOf(messageLevel);
  return level >= Math.max(0, threshold) || level < 0;
}

export function parseHAProxyActiveSessionBytes(output) {
  const totals = new Map();
  for (const block of String(output).split(/(?=^0x[0-9a-f]+:)/m)) {
    const proxy = block.match(/^\s*frontend=(pool_[^\s]+)\s/m)?.[1];
    if (!proxy) continue;
    const bytesIn = Number(block.match(/^\s*req=.*\btotal=(\d+)/m)?.[1] ?? 0);
    const bytesOut = Number(block.match(/^\s*res=.*\btotal=(\d+)/m)?.[1] ?? 0);
    const current = totals.get(proxy) ?? { bytesIn: 0, bytesOut: 0 };
    current.bytesIn += bytesIn;
    current.bytesOut += bytesOut;
    totals.set(proxy, current);
  }
  return totals;
}

export function advanceMonotonicCounter(previousValue, observedValue) {
  const previous = Math.max(0, Number(previousValue) || 0);
  const observed = Math.max(0, Number(observedValue) || 0);
  const current = Math.max(previous, observed);
  return { current, delta: current - previous };
}
