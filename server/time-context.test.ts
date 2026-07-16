import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCurrentTimeContext, formatShanghaiDateTime } from './time-context';

test('formats the server instant as an Asia/Shanghai ISO time', () => {
  assert.equal(
    formatShanghaiDateTime(new Date('2026-07-16T06:30:25.000Z')),
    '2026-07-16T14:30:25+08:00'
  );
});

test('handles the Shanghai calendar-day boundary', () => {
  assert.equal(
    formatShanghaiDateTime(new Date('2026-12-31T16:00:00.000Z')),
    '2027-01-01T00:00:00+08:00'
  );
});

test('provides the model with an explicit time and conversion rules', () => {
  const context = buildCurrentTimeContext(new Date('2026-07-16T06:30:25.000Z'));

  assert.match(context, /2026-07-16T14:30:25\+08:00/);
  assert.match(context, /Asia\/Shanghai/);
  assert.match(context, /scheduledAt/);
});
