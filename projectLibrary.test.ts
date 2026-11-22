import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBlankProject } from './geometry';
import { formatBytes, formatSavedAt, planThumbSegments } from './projectLibrary';
import type { ArchModel } from '../types/model';

test('plan thumbnail segments are normalized to the longest side', () => {
  const m = createBlankProject() as ArchModel;
  const wall = (x1: number, y1: number, x2: number, y2: number) => ({ id: `w${x1}${y1}${x2}${y2}`, type: 'wall', layer: '0', start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 6, height: 96 });
  m.entities = [wall(100, 50, 500, 50), wall(500, 50, 500, 250), wall(500, 250, 100, 250), wall(100, 250, 100, 50)] as unknown as ArchModel['entities'];
  const { segs, aspect } = planThumbSegments(m);
  assert.equal(segs.length, 4);
  assert.deepEqual(segs[0], [0, 0, 1, 0]);
  assert.deepEqual(segs[1], [1, 0, 1, 0.5]);
  assert.equal(aspect, 2);
  assert.deepEqual(planThumbSegments(createBlankProject() as ArchModel).segs, []);
});

test('sizes and save times read naturally', () => {
  assert.equal(formatBytes(900), '900 B');
  assert.equal(formatBytes(20_480), '20 KB');
  assert.equal(formatBytes(3_500_000), '3.3 MB');
  const now = Date.UTC(2026, 10, 19, 18, 0);
  assert.equal(formatSavedAt(now - 20_000, now), 'just now');
  assert.equal(formatSavedAt(now - 5 * 60_000, now), '5 min ago');
});
