import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BlockDefinition } from '../types/model';
import {
  centerShapes, copyShape, duplicateBlock, mergeBlocks, mirrorShape, newCustomBlock,
  parseBlockFile, removeShape, serializeBlocks, shapesExtent, uniqueName,
} from './blockLibrary';

const withLegs = (name = 'Table'): BlockDefinition => ({
  ...newCustomBlock(name),
  entities: [
    { id: 'top', type: 'rectangle', layer: '0', p1: { x: -18, y: -12 }, p2: { x: 18, y: 12 } },
    { id: 'leg', type: 'rectangle', layer: '0', p1: { x: -17, y: -11 }, p2: { x: -15, y: -9 } },
  ],
});

test('a new custom block is a single editable rectangle', () => {
  const b = newCustomBlock();
  assert.equal(b.kind, 'custom');
  assert.equal(b.category, 'Custom');
  assert.equal(b.entities.length, 1);
  assert.deepEqual(shapesExtent(b), { width: 36, depth: 24 });
});

test('copy / mirror / remove shapes', () => {
  let b = withLegs();
  const { block, newId } = copyShape(b, 'leg', 'x');
  b = block;
  const src = b.entities.find((e) => e.id === 'leg')!;
  const cp = b.entities.find((e) => e.id === newId)!;
  assert.ok(src.type === 'rectangle' && cp.type === 'rectangle');
  if (src.type === 'rectangle' && cp.type === 'rectangle') assert.equal(cp.p1.x, -src.p1.x);
  b = removeShape(b, newId);
  assert.ok(!b.entities.some((e) => e.id === newId));
  assert.equal(b.entities.length, 2);
});

test('arc mirroring flips its angles', () => {
  const m = mirrorShape({ id: 'a', type: 'arc', layer: '0', center: { x: 10, y: 0 }, radius: 5, startAngle: 0, endAngle: 90 }, 'x');
  assert.ok(m.type === 'arc');
  if (m.type === 'arc') {
    assert.equal(m.center.x, -10);
    assert.deepEqual([m.startAngle, m.endAngle], [90, 180]);
  }
});

test('centre + extent', () => {
  const b: BlockDefinition = { ...newCustomBlock(), entities: [{ id: 'r', type: 'rectangle', layer: '0', p1: { x: 0, y: 0 }, p2: { x: 40, y: 20 } }] };
  const c = centerShapes(b);
  const r = c.entities[0];
  assert.ok(r.type === 'rectangle' && r.p1.x === -20 && r.p1.y === -10);
  assert.deepEqual(shapesExtent(c), { width: 40, depth: 20 });
});

test('duplicate gives fresh ids and a unique name', () => {
  const b = withLegs('Bench');
  const d = duplicateBlock(b, [b]);
  assert.notEqual(d.id, b.id);
  assert.equal(d.name, 'Bench copy');
  assert.equal(d.entities.length, b.entities.length);
  assert.ok(d.entities.every((e) => !b.entities.some((o) => o.id === e.id)));
});

test('block files round-trip and merge without clobbering', () => {
  const a = withLegs('Stool');
  const parsed = parseBlockFile(serializeBlocks([a]));
  assert.equal(parsed[0].name, 'Stool');
  // importing the same block again is skipped; a different block with the same id is renamed
  const again = mergeBlocks([a], parsed);
  assert.equal(again.added.length, 0);
  assert.equal(again.skipped, 1);
  const changed = mergeBlocks([a], [{ ...parsed[0], height: 18 }]);
  assert.equal(changed.added.length, 1);
  assert.notEqual(changed.added[0].id, a.id);
  assert.equal(changed.added[0].name, 'Stool (2)');
  // a whole project file works too; junk is rejected
  assert.equal(parseBlockFile(JSON.stringify({ projectName: 'x', blocks: [a] })).length, 1);
  assert.throws(() => parseBlockFile('{"blocks":[{"name":"x"}]}'), /No blocks/);
  assert.throws(() => parseBlockFile('nope'), /JSON/);
  assert.equal(uniqueName('Stool', [a, { ...a, name: 'Stool (2)' }]), 'Stool (3)');
});
