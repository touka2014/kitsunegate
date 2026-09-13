import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceMonotonicCounter,
  levelAllows,
  normalizeSettings,
  parseHAProxyActiveSessionBytes,
  rangeDefinition,
} from './monitoring.mjs';

test('monitoring settings support one-second samples and clamp unsafe ranges', () => {
  assert.deepEqual(
    normalizeSettings({
      metricsSampleIntervalSeconds: 1,
      metricsRetentionDays: 99,
      logLevel: 'warning',
      logRetentionDays: 0,
      uiLanguage: 'ja',
    }),
    {
      metricsSampleIntervalSeconds: 1,
      metricsRetentionDays: 30,
      logLevel: 'warning',
      logRetentionDays: 1,
      uiLanguage: 'ja',
    },
  );
});

test('traffic ranges use finer buckets for shorter windows', () => {
  assert.equal(rangeDefinition('30m').bucketSeconds, 5);
  assert.equal(rangeDefinition('12h').bucketSeconds, 120);
  assert.equal(rangeDefinition('invalid').key, '1h');
});

test('configured log level suppresses lower-severity records', () => {
  assert.equal(levelAllows('warning', 'info'), false);
  assert.equal(levelAllows('warning', 'warning'), true);
  assert.equal(levelAllows('warning', 'error'), true);
});

test('active HAProxy streams contribute in-flight request and response bytes', () => {
  const sessions = parseHAProxyActiveSessionBytes(
    `0x1: stream\n  frontend=pool_grp_a (id=1 mode=tcp)\n  req=0x1 (f=0 total=125)\n  res=0x2 (f=0 total=2048)\n0x2: stream\n  frontend=pool_grp_a (id=1 mode=tcp)\n  req=0x3 (f=0 total=75)\n  res=0x4 (f=0 total=952)\n0x3: stream\n  frontend=GLOBAL (id=0 mode=tcp)\n  req=0x5 (f=0 total=10)`,
  );
  assert.deepEqual(sessions.get('pool_grp_a'), {
    bytesIn: 200,
    bytesOut: 3000,
  });
  assert.equal(sessions.has('GLOBAL'), false);
});

test('HAProxy counter handoff cannot double count an active stream at close', () => {
  let counter = advanceMonotonicCounter(5_000_000, 0);
  assert.deepEqual(counter, { current: 5_000_000, delta: 0 });
  counter = advanceMonotonicCounter(counter.current, 6_000_000);
  assert.deepEqual(counter, { current: 6_000_000, delta: 1_000_000 });
});
