import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DoorEntity, RoomEntity, WallEntity, WindowEntity, WallOpeningEntity } from '../types/model';
import { createBlankProject, createSampleProject } from './geometry';
import { applyAiPlan, isStarterSample, buildAiUserPrompt, buildPlanEntities, cleanWalls, labelPointFor, parseAiPlan, pickDoorType, levelHasPlan, type AiPlan } from './aiPlan';

const walls = (ents: { type: string }[]) => ents.filter((e): e is WallEntity => e.type === 'wall');
const ptKey = (p: { x: number; y: number }) => `${p.x},${p.y}`;

// A 30' x 20' house drawn sloppily: corners miss by a few inches, top wall is tilted,
// the partition at x=18 stops short of the top wall and overshoots the bottom wall.
const SLOPPY: AiPlan = {
  unit: 'ft',
  walls: [
    { x1: 0, y1: 0, x2: 30, y2: 0.6, exterior: true },        // tilted ~1.1°
    { x1: 30.2, y1: 0.3, x2: 29.9, y2: 20, exterior: true },
    { x1: 30, y1: 20.3, x2: 0.2, y2: 20, exterior: true },
    { x1: 0, y1: 19.8, x2: -0.3, y2: 0.2, exterior: true },
    { x1: 18, y1: 0.8, x2: 18, y2: 20.5, exterior: false },   // short at top, overshoots bottom
  ],
  doors: [
    { x: 18, y: 10, width: 2.67, kind: 'single' },
    { x: 8, y: 20, width: 3, kind: 'single', exterior: true },
  ],
  windows: [
    { x: 9, y: 0, width: 5 },
    { x: 30, y: 10, width: 4 },
    { x: 15, y: 10, width: 3 },   // in the middle of a room: not on a wall
  ],
  rooms: [
    { name: 'Living Room', polygon: [{ x: 0, y: 0 }, { x: 18, y: 0.2 }, { x: 18, y: 20 }, { x: 0.1, y: 20 }] },
    { name: 'Bedroom', polygon: [{ x: 18, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 18, y: 20 }] },
  ],
};

test('parseAiPlan tolerates code fences, string numbers and unknown kinds', () => {
  const plan = parseAiPlan('Here you go:\n```json\n{"unit":"ft","walls":[{"x1":"0","y1":0,"x2":10,"y2":0}],"doors":[{"x":5,"y":0,"kind":"french"}],"rooms":[{"name":"A","polygon":[{"x":0,"y":0}]}]}\n```');
  assert.equal(plan.walls.length, 1);
  assert.equal(plan.walls[0].x1, 0);
  assert.equal(plan.doors![0].kind, 'single');
  assert.equal(plan.rooms!.length, 0, 'rooms with < 3 points are dropped');
});

test('parseAiPlan rejects replies without walls', () => {
  assert.throws(() => parseAiPlan('{"walls":[]}'), /walls/);
  assert.throws(() => parseAiPlan('sorry, I cannot'), /plan/);
});

test('sloppy rectangle is squared and every corner is shared exactly', () => {
  const m = createBlankProject();
  const { entities, report } = buildPlanEntities(SLOPPY, m, { levelId: 'level-1', origin: { x: 0, y: 0 }, idPrefix: 't' });
  const ws = walls(entities);
  assert.equal(report.walls, 5);
  for (const w of ws) assert.ok(w.start.x === w.end.x || w.start.y === w.end.y, `wall ${w.id} is orthogonal`);
  const ext = ws.filter((w) => w.wallTypeId === 'wt-ext-2x6');
  assert.equal(ext.length, 4);
  // each exterior endpoint coincides with exactly one other exterior endpoint
  const ends = ext.flatMap((w) => [ptKey(w.start), ptKey(w.end)]);
  for (const k of ends) assert.equal(ends.filter((x) => x === k).length, 2, `corner ${k} joined`);
  assert.ok(Math.abs(report.width - 360) <= 4, `width ${report.width}`);
  assert.ok(Math.abs(report.depth - 240) <= 4, `depth ${report.depth}`);
});

test('partition is extended / trimmed onto the walls it meets', () => {
  const { entities } = buildPlanEntities(SLOPPY, createBlankProject(), { levelId: 'level-1', origin: { x: 0, y: 0 }, idPrefix: 't' });
  const ws = walls(entities);
  const part = ws.find((w) => w.wallTypeId === 'wt-int-45')!;
  const horiz = ws.filter((w) => w.wallTypeId === 'wt-ext-2x6' && w.start.y === w.end.y).map((w) => w.start.y).sort((a, b) => a - b);
  const ys = [part.start.y, part.end.y].sort((a, b) => a - b);
  assert.deepEqual(ys, horiz, 'partition ends exactly on the top and bottom walls');
  assert.equal(part.start.x, 216);
});

test('openings are hosted on the nearest wall with catalog types; strays are reported', () => {
  const { entities, report } = buildPlanEntities(SLOPPY, createBlankProject(), { levelId: 'level-1', origin: { x: 0, y: 0 }, idPrefix: 't' });
  const doors = entities.filter((e): e is DoorEntity => e.type === 'door');
  const wins = entities.filter((e): e is WindowEntity => e.type === 'window');
  assert.equal(doors.length, 2);
  assert.equal(wins.length, 2);
  assert.equal(report.skipped.length, 1);
  const entry = doors.find((d) => d.depthPosition === 'exterior')!;
  assert.equal(entry.doorTypeId, 'dt-36x80');
  const inner = doors.find((d) => d.depthPosition === 'center')!;
  assert.equal(inner.doorTypeId, 'dt-32x80');
  const host = walls(entities).find((w) => w.id === inner.wallId)!;
  assert.equal(host.wallTypeId, 'wt-int-45');
  assert.ok(Math.abs(inner.offset - 0.5) < 0.01);
  assert.deepEqual(doors.map((d) => d.mark).sort(), ['D1', 'D2']);
  for (const w of wins) assert.ok(w.windowTypeId && w.offset > 0 && w.offset < 1);
});

test('overlapping openings slide apart instead of stacking', () => {
  const plan: AiPlan = {
    unit: 'ft',
    walls: [{ x1: 0, y1: 0, x2: 20, y2: 0, exterior: true }],
    windows: [{ x: 10, y: 0, width: 4 }, { x: 10.5, y: 0, width: 4 }],
    doors: [{ x: 3, y: 0, width: 6, kind: 'opening' }],
  };
  const { entities } = buildPlanEntities(plan, createBlankProject(), { levelId: 'level-1', origin: { x: 0, y: 0 }, idPrefix: 't' });
  const wins = entities.filter((e): e is WindowEntity => e.type === 'window');
  assert.equal(wins.length, 2);
  const spans = wins.map((w) => [w.offset * 240 - w.width / 2, w.offset * 240 + w.width / 2]).sort((a, b) => a[0] - b[0]);
  assert.ok(spans[0][1] <= spans[1][0], 'windows do not overlap');
  const wo = entities.find((e): e is WallOpeningEntity => e.type === 'wallopening');
  assert.ok(wo && wo.width === 72 && wo.sillHeight === 0);
});

test('rooms snap to wall lines and get marks, materials and inside labels', () => {
  const { entities } = buildPlanEntities(
    { ...SLOPPY, rooms: [...SLOPPY.rooms!, { name: 'Bath', polygon: [{ x: 1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 3 }] }, { name: 'Closet', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] },
    createBlankProject(),
    { levelId: 'level-1', origin: { x: 0, y: 0 }, idPrefix: 't' },
  );
  const rooms = entities.filter((e): e is RoomEntity => e.type === 'room');
  assert.equal(rooms.length, 2, 'rooms under 9 sq ft are skipped');
  const living = rooms.find((r) => r.name === 'Living Room')!;
  const ws = walls(entities);
  const xs = new Set(ws.flatMap((w) => [w.start.x, w.end.x]));
  const ys = new Set(ws.flatMap((w) => [w.start.y, w.end.y]));
  assert.equal(living.polygon.length, 4);
  for (const v of living.polygon) assert.ok(xs.has(v.x) && ys.has(v.y), `room vertex ${v.x},${v.y} sits on wall lines`);
  assert.equal(living.mark, '101');
  assert.equal(living.floorMaterial, 'wood');
});

test('label point stays inside an L-shaped room', () => {
  const L = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 100 }, { x: 0, y: 100 }];
  const p = labelPointFor(L);
  assert.ok((p.x <= 10 && p.y <= 100) || (p.y <= 10 && p.x <= 100), `label ${p.x},${p.y} is inside`);
});

test('metric plans are converted to inches', () => {
  const { report } = buildPlanEntities(
    { unit: 'm', walls: [{ x1: 0, y1: 0, x2: 10, y2: 0, exterior: true }, { x1: 10, y1: 0, x2: 10, y2: 5, exterior: true }] },
    createBlankProject(),
    { levelId: 'level-1', origin: { x: 0, y: 0 }, idPrefix: 't' },
  );
  assert.equal(report.width, 394);
  assert.equal(report.depth, 197);
});

test('lines within 2" of a 6" module snap to it (imperial only)', () => {
  const plan: AiPlan = {
    unit: 'ft',
    walls: [
      { x1: 0, y1: 0.1, x2: 40.1, y2: 0.1, exterior: true },
      { x1: 40.1, y1: 0.1, x2: 40.1, y2: 27.9, exterior: true },
      { x1: 40.1, y1: 27.9, x2: 0, y2: 27.9, exterior: true },
      { x1: 0, y1: 27.9, x2: 0, y2: 0.1, exterior: true },
    ],
  };
  const { report } = buildPlanEntities(plan, createBlankProject(), { levelId: 'level-1', origin: { x: 0, y: 0 }, idPrefix: 't' });
  assert.equal(report.width, 480, '40\'-1 1/4" → 40\'-0"');
  assert.equal(report.depth, 336, '27\'-9 1/2" → 28\'-0"');
});

test('cleanWalls drops duplicates and zero-length walls', () => {
  const { walls: out } = cleanWalls([
    { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, exterior: true },
    { a: { x: 100, y: 0 }, b: { x: 0, y: 0 }, exterior: true },
    { a: { x: 50, y: 50 }, b: { x: 52, y: 51 }, exterior: false },
  ]);
  assert.equal(out.length, 1);
});

test('applyAiPlan: new project, replace level, add beside', () => {
  const sample = createSampleProject();
  assert.ok(isStarterSample(sample));
  assert.ok(levelHasPlan(sample, 'level-1'));
  assert.equal(levelHasPlan(sample, 'level-2'), false);

  const fresh = applyAiPlan({ ...sample, settings: { ...sample.settings, units: 'metric' } }, SLOPPY, 'level-2', 'new', 'ai0');
  assert.ok(fresh.model.entities.every((e) => e.id.startsWith('ai0-')), 'only the AI plan in a new project');
  assert.equal(fresh.levelId, 'level-1');
  assert.equal(fresh.model.activeLevelId, 'level-1');
  assert.equal(fresh.model.settings.units, 'metric', 'units carried over');
  assert.equal(isStarterSample(fresh.model), false);

  const rep = applyAiPlan(sample, SLOPPY, 'level-1', 'replace', 'ai1');
  assert.ok(rep.model.entities.filter((e) => (e.levelId ?? 'level-1') === 'level-1').every((e) => e.id.startsWith('ai1-')), 'level 1 cleared');
  assert.ok(rep.model.entities.some((e) => e.type === 'beam' && e.levelId === 'level-2'), 'other levels kept');

  const before = sample.entities.length;
  const bes = applyAiPlan(sample, SLOPPY, 'level-1', 'beside', 'ai2');
  assert.ok(bes.model.entities.length > before);
  const newWalls = walls(bes.model.entities).filter((w) => w.id.startsWith('ai2-'));
  const oldMaxX = Math.max(...walls(sample.entities).flatMap((w) => [w.start.x, w.end.x]));
  assert.ok(Math.min(...newWalls.flatMap((w) => [w.start.x, w.end.x])) > oldMaxX, 'placed to the right');
  const newDoors = bes.model.entities.filter((e): e is DoorEntity => e.type === 'door' && e.id.startsWith('ai2-'));
  assert.deepEqual(newDoors.map((d) => d.mark).sort(), ['D3', 'D4'], 'marks continue after D1, D2');
});

test('door type picking respects kind and width', () => {
  const types = createBlankProject().doorTypes!;
  assert.equal(pickDoorType(types, 'sliding', 96, true)!.id, 'dt-slide-96x80');
  assert.equal(pickDoorType(types, 'garage', 190, true)!.id, 'dt-garage-16x7');
  assert.equal(pickDoorType(types, 'opening', 48, false), null);
});

test('user prompt mentions sketch vs. brief and units', () => {
  assert.match(buildAiUserPrompt('make it 40 ft wide', true, 'imperial'), /attached floor plan sketch[\s\S]*40 ft[\s\S]*"ft"/);
  assert.match(buildAiUserPrompt('3 bed house', false, 'metric'), /Design a floor plan for this request: 3 bed house[\s\S]*"m"/);
});
