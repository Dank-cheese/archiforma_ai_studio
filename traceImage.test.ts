import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrateTraceImage, createTraceImage, moveTraceImage, pdfWorldWidth, traceBounds, traceHeight, updateTraceImage } from './traceImage';
import type { ArchModel } from '../types/model';

const img = () => createTraceImage({ name: 'Plan', src: 'data:image/jpeg;base64,AAAA', pixelWidth: 2000, pixelHeight: 1000, levelId: 'L1', width: 480, at: { x: 100, y: 50 } });

test('height follows aspect ratio', () => {
  const t = img();
  assert.equal(traceHeight(t), 240);
  assert.deepEqual(traceBounds(t), { minX: 100, minY: 50, maxX: 580, maxY: 290 });
});

test('two-point calibration scales about the first point', () => {
  const t = img();
  const a = { x: 200, y: 100 };
  const b = { x: 300, y: 100 }; // measured 100", real 150"
  const c = calibrateTraceImage(t, a, b, 150);
  assert.equal(c.width, 720);
  // the first point stays at the same place on the image
  const u = (a.x - t.x) / t.width;
  assert.ok(Math.abs(c.x + u * c.width - a.x) < 1e-9);
  const v = (a.y - t.y) / traceHeight(t);
  assert.ok(Math.abs(c.y + v * traceHeight(c) - a.y) < 1e-9);
  // degenerate inputs leave it alone
  assert.equal(calibrateTraceImage(t, a, a, 100), t);
  assert.equal(calibrateTraceImage(t, a, b, 0), t);
});

test('pdf page width at drawing scale', () => {
  // 36" wide sheet (2592 pt) at 1/4" = 1'-0" → 36 × 48 = 1728" = 144 ft
  assert.equal(pdfWorldWidth(2592, 48), 1728);
});

test('move and update', () => {
  const t = img();
  assert.deepEqual([moveTraceImage(t, 10, -5).x, moveTraceImage(t, 10, -5).y], [110, 45]);
  const m = { traceImages: [t] } as unknown as ArchModel;
  assert.equal(updateTraceImage(m, t.id, (x) => ({ ...x, opacity: 0.2 })).traceImages![0].opacity, 0.2);
  assert.equal(updateTraceImage(m, t.id, () => null).traceImages!.length, 0);
});
