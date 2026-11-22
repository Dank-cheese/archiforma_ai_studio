import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAiPlan } from './aiPlan';
import { createBlankProject } from './geometry';
import { createTraceImage } from './traceImage';
import { imageToWorld, parseDimensionText, parseTraceResult, refineWallsToImage, traceToPlan, type GrayImage } from './autoTrace';

/** 1000 × 700 px image with a 10 px dark wall band centred on y = 205 and x = 103 */
function synthetic(): GrayImage {
  const width = 1000, height = 700;
  const dark = new Uint8Array(width * height);
  for (let y = 200; y <= 210; y++) for (let x = 100; x <= 900; x++) dark[y * width + x] = 230;
  for (let x = 98; x <= 108; x++) for (let y = 200; y <= 650; y++) dark[y * width + x] = 230;
  return { width, height, dark };
}

test('AI answers are cleaned and clamped', () => {
  const r = parseTraceResult({
    walls: [{ x1: 10, y1: 10, x2: 500, y2: 10, exterior: true }, { x1: 5, y1: 5, x2: 5.5, y2: 5 }, { x1: 'x' }],
    openings: [{ kind: 'weird', x1: 100, y1: 10, x2: 140, y2: 10 }, { kind: 'window', x1: 200, y1: 10, x2: 260, y2: 10 }],
    rooms: [{ name: 'Kitchen', polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 1200 }] }, { name: 'bad', polygon: [] }],
    dimension: { x1: 10, y1: 990, x2: 500, y2: 990, text: "30'-0\"" },
  });
  assert.equal(r.walls.length, 1);
  assert.equal(r.openings[0].kind, 'door');
  assert.equal(r.openings[1].kind, 'window');
  assert.equal(r.rooms.length, 1);
  assert.equal(r.rooms[0].polygon[2].y, 1000);
  assert.equal(r.dimension?.text, "30'-0\"");
});

test('walls snap onto the dark band of the image and get straightened', () => {
  const img = synthetic();
  // AI is 12 px (17 in 0–1000 y units) off and slightly tilted
  const [h, v] = refineWallsToImage(
    [
      { x1: 100, y1: (190 / 700) * 1000, x2: 900, y2: (194 / 700) * 1000 },
      { x1: 95, y1: (200 / 700) * 1000, x2: 96, y2: (650 / 700) * 1000 },
    ],
    img
  );
  const yPx = (h.y1 / 1000) * 700;
  assert.ok(Math.abs(yPx - 205) <= 1, `horizontal wall at ${yPx}px`);
  assert.equal(h.y1, h.y2, 'straightened');
  assert.ok(h.thickness > 5, 'found the drawn thickness');
  assert.ok(Math.abs(v.x1 - 103) <= 1, `vertical wall at ${v.x1}px`);
  assert.equal(v.x1, v.x2);
});

test('image coordinates map through the trace placement', () => {
  const t = createTraceImage({ name: 'p', src: 'data:image/jpeg;base64,AA', pixelWidth: 1000, pixelHeight: 500, levelId: 'level-1', width: 480, at: { x: 100, y: 50 } });
  assert.deepEqual(imageToWorld(t, 0, 0), { x: 100, y: 50 });
  assert.deepEqual(imageToWorld(t, 1000, 1000), { x: 580, y: 290 });
  const plan = traceToPlan(
    {
      walls: [
        { x1: 0, y1: 0, x2: 1000, y2: 0, exterior: true },
        { x1: 1000, y1: 0, x2: 1000, y2: 1000, exterior: true },
        { x1: 1000, y1: 1000, x2: 0, y2: 1000, exterior: true },
        { x1: 0, y1: 1000, x2: 0, y2: 0, exterior: true },
      ],
      openings: [{ kind: 'door', x1: 400, y1: 1000, x2: 475, y2: 1000 }, { kind: 'window', x1: 200, y1: 0, x2: 300, y2: 0 }],
      rooms: [{ name: 'Studio', polygon: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }] }],
    },
    t
  );
  assert.equal(plan.unit, 'in');
  assert.equal(plan.doors![0].width, 36);
  assert.equal(plan.windows![0].width, 48);
  // applied with keepPosition the walls stay exactly where the image is
  const r = applyAiPlan(createBlankProject(), plan, 'level-1', 'beside', 'tr', { keepPosition: true, module: 0 });
  const xs = r.model.entities.filter((e) => e.type === 'wall').flatMap((w) => (w.type === 'wall' ? [w.start.x, w.end.x] : []));
  assert.equal(Math.min(...xs), 100);
  assert.equal(Math.max(...xs), 580);
  assert.equal(r.report.doors + r.report.windows, 2);
  assert.equal(r.report.rooms, 1);
});

test('dimension text', () => {
  assert.equal(parseDimensionText(`30'-0"`, 'imperial'), 360);
  assert.equal(parseDimensionText(`12' 6"`, 'imperial'), 150);
  assert.equal(parseDimensionText(`12'-6 1/2"`, 'imperial'), 150.5);
  assert.equal(parseDimensionText('150"', 'imperial'), 150);
  assert.ok(Math.abs(parseDimensionText('3600', 'metric')! - 141.732) < 0.01);
  assert.ok(Math.abs(parseDimensionText('3.6 m', 'imperial')! - 141.732) < 0.01);
  assert.equal(parseDimensionText('kitchen', 'imperial'), null);
});
