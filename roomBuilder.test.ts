import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DoorEntity, WallEntity, WindowEntity, WallOpeningEntity } from '../types/model';
import { createBlankProject } from './geometry';
import { computeDoorSymbol } from './planPrimitives';
import {
  autoClose, buildRoom, closureGap, connectionPoints, lShapeSpec, newFeature, newSide, placedCorners, rectangleSpec, sideCorners, snapPlacement,
} from './roomBuilder';

const blank = () => {
  const m = createBlankProject();
  return { ...m, entities: [] };
};
const area = (pts: { x: number; y: number }[]) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2);
const opts = { levelId: 'level-1', idPrefix: 'rb' };

test('rectangle and L-shape runs close', () => {
  const r = rectangleSpec('Bed', 144, 120);
  assert.equal(closureGap(r.sides), 0);
  assert.deepEqual(sideCorners(r.sides).slice(0, 4), [{ x: 0, y: 0 }, { x: 144, y: 0 }, { x: 144, y: 120 }, { x: 0, y: 120 }]);
  const l = lShapeSpec('Living', 240, 192, 96, 72);
  assert.ok(closureGap(l.sides) < 1e-6);
  assert.equal(area(placedCorners(l, { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 })), 240 * 192 - 96 * 72);
});

test('auto-close resizes the last side or adds one', () => {
  const r = rectangleSpec('A', 144, 120);
  const short = { ...r, sides: r.sides.map((s, i) => (i === 3 ? { ...s, length: 100 } : s)) };
  const fixed = autoClose(short)!;
  assert.equal(fixed.sides.length, 4);
  assert.equal(fixed.sides[3].length, 120);
  const three = { ...r, sides: r.sides.slice(0, 3) };
  const added = autoClose(three)!;
  assert.equal(added.sides.length, 4);
  assert.equal(added.sides[3].length, 120);
  assert.ok(closureGap(added.sides) < 0.01);
});

test('rotation and anchor move the room', () => {
  const r = rectangleSpec('A', 144, 120);
  const c = placedCorners(r, { at: { x: 500, y: 500 }, anchor: 2, rotation: 90 });
  assert.deepEqual(c[2], { x: 500, y: 500 });
  assert.equal(area(c), 144 * 120);
});

test('builds walls, a centred window and an inward door', () => {
  const spec = rectangleSpec('Bedroom', 144, 120);
  spec.sides[0].features.push(newFeature('window', 48));
  spec.sides[2].features.push(newFeature('door', 32, 30));
  const m = blank();
  const { entities, report } = buildRoom(m, spec, { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 }, opts);
  const walls = entities.filter((e): e is WallEntity => e.type === 'wall');
  assert.equal(walls.length, 4);
  assert.deepEqual(report.skipped, []);
  const win = entities.find((e): e is WindowEntity => e.type === 'window')!;
  assert.equal(win.wallId, walls[0].id);
  assert.equal(win.offset, 0.5);
  assert.equal(win.width, 48);
  const door = entities.find((e): e is DoorEntity => e.type === 'door')!;
  const host = walls.find((w) => w.id === door.wallId)!;
  assert.equal(door.width, 32);
  // the bottom side runs right→left; 30" from its start = x 114
  assert.ok(Math.abs(host.start.x + (host.end.x - host.start.x) * door.offset - 114) < 0.2);
  // the swing opens into the room (towards smaller y for the bottom wall)
  const sym = computeDoorSymbol(door, host);
  assert.ok(sym.leaf[1].y < 120, `door opens outward: ${JSON.stringify(sym.leaf)}`);
  const room = entities.find((e) => e.type === 'room')!;
  assert.equal((room as { name: string }).name, 'Bedroom');
});

test('a room snapped against another shares the wall instead of doubling it', () => {
  const m0 = blank();
  const a = buildRoom(m0, rectangleSpec('A', 144, 120), { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 }, opts);
  const m1 = { ...m0, entities: a.entities };
  const specB = rectangleSpec('B', 120, 120);
  specB.sides[3].features.push(newFeature('door', 36)); // left side of B = right side of A
  const b = buildRoom(m1, specB, { at: { x: 144, y: 0 }, anchor: 0, rotation: 0 }, { ...opts, idPrefix: 'rb2' });
  const newWalls = b.entities.filter((e) => e.type === 'wall');
  assert.equal(newWalls.length, 3);
  assert.equal(b.report.sharedSides, 1);
  const door = b.entities.find((e): e is DoorEntity => e.type === 'door')!;
  const aRight = a.entities.find((e): e is WallEntity => e.type === 'wall' && e.start.x === 144 && e.end.x === 144)!;
  assert.equal(door.wallId, aRight.id, 'door is cut into the existing shared wall');
  assert.equal(door.mark, 'D1');
  // the door swings into room B (x > 144)
  const sym = computeDoorSymbol(door, aRight);
  assert.ok(sym.leaf[1].x > 144);
});

test('partial overlap only adds the missing stretch; gaps leave the wall open', () => {
  const m0 = blank();
  const a = buildRoom(m0, rectangleSpec('A', 144, 120), { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 }, opts);
  const m1 = { ...m0, entities: a.entities };
  // B is deeper than A: its left side (240 long) overlaps A's right wall for 120
  const specB = rectangleSpec('B', 96, 240);
  specB.sides[0].features.push(newFeature('gap', 48));
  const b = buildRoom(m1, specB, { at: { x: 144, y: 0 }, anchor: 0, rotation: 0 }, { ...opts, idPrefix: 'rb2' });
  const walls = b.entities.filter((e): e is WallEntity => e.type === 'wall');
  // top split by the gap (2) + right + bottom + the lower half of the left side = 5
  assert.equal(walls.length, 5);
  const left = walls.filter((w) => w.start.x === 144 && w.end.x === 144);
  assert.equal(left.length, 1);
  assert.equal(Math.abs(left[0].end.y - left[0].start.y), 120);
  assert.equal(b.report.gaps, 1);
});

test('a gap on a shared side opens the existing wall full height', () => {
  const m0 = blank();
  const a = buildRoom(m0, rectangleSpec('A', 144, 120), { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 }, opts);
  const specB = rectangleSpec('B', 144, 120);
  specB.sides[0].features.push(newFeature('gap', 72)); // B's top = A's bottom
  const b = buildRoom({ ...m0, entities: a.entities }, specB, { at: { x: 0, y: 120 }, anchor: 0, rotation: 0 }, { ...opts, idPrefix: 'rb2' });
  const cut = b.entities.filter((e): e is WallOpeningEntity => e.type === 'wallopening');
  assert.equal(cut.length, 1);
  const host = a.entities.find((e) => e.id === cut[0].wallId) as WallEntity;
  assert.equal(cut[0].width, 72);
  assert.equal(cut[0].height, host.height);
  assert.equal(b.report.cutGaps, 1);
  assert.equal(b.report.openings, 0);
});

test('a gap or door on a shared side never cuts through an existing opening', () => {
  const m0 = blank();
  const specA = rectangleSpec('A', 144, 120);
  specA.sides[2].features.push(newFeature('door', 36)); // centred in A's bottom wall (x 54..90)
  const a = buildRoom(m0, specA, { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 }, opts);
  const specB = rectangleSpec('B', 144, 120);
  specB.sides[0].features.push(newFeature('gap', 48, 60), newFeature('door', 30, 120));
  const b = buildRoom({ ...m0, entities: a.entities }, specB, { at: { x: 0, y: 120 }, anchor: 0, rotation: 0 }, { ...opts, idPrefix: 'rb2' });
  assert.equal(b.entities.filter((e) => e.type === 'wallopening').length, 0);
  assert.equal(b.entities.filter((e) => e.type === 'door').length, 1, 'the door clear of D1 is still placed');
  assert.match(b.report.skipped.join(' '), /D1/);
});

test('openings straddling a gap are reported, not misplaced', () => {
  const spec = rectangleSpec('A', 144, 120);
  spec.sides[0].features.push(newFeature('gap', 48, 72), newFeature('window', 36, 72));
  const r = buildRoom(blank(), spec, { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 }, opts);
  assert.equal(r.entities.filter((e) => e.type === 'window').length, 0);
  assert.equal(r.report.skipped.length, 1);
  const o = rectangleSpec('B', 144, 120);
  o.sides[1].features.push(newFeature('opening', 48));
  const r2 = buildRoom(blank(), o, { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 }, opts);
  assert.equal(r2.entities.filter((e): e is WallOpeningEntity => e.type === 'wallopening').length, 1);
});

test('open runs are refused; connection points snap', () => {
  const r = rectangleSpec('A', 144, 120);
  assert.throws(() => buildRoom(blank(), { ...r, sides: r.sides.slice(0, 3) }, { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 }, opts), /close/);
  const m0 = blank();
  const a = buildRoom(m0, r, { at: { x: 0, y: 0 }, anchor: 0, rotation: 0 }, opts);
  const pts = connectionPoints({ ...m0, entities: a.entities }, 'level-1');
  assert.equal(pts.length, 4);
  const s = snapPlacement(rectangleSpec('B', 96, 96), { at: { x: 150, y: 5 }, anchor: 0, rotation: 0 }, pts, 12);
  assert.ok(s.snapped);
  assert.deepEqual(s.placement.at, { x: 144, y: 0 });
  assert.equal(newSide(10).turn, 90);
});
