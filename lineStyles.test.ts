import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArchModel } from '../types/model';
import { createBlankProject } from './geometry';
import {
  allLineTypes, dashArray, effectiveColor, effectiveLineType, effectiveLineWeight, findLineType, hasExplicitLineWeight,
  lineTypeScaleFor, parseLinFile, writeLinFile, STANDARD_LINETYPES,
} from './lineStyles';

const model = (): ArchModel => {
  const m = createBlankProject();
  return { ...m, layers: [...m.layers, { id: 'hid', name: 'A-HIDDEN', color: '#ff0000', visible: true, locked: false, lineType: 'HIDDEN', lineWeight: 0.35 }] };
};

test('ByLayer resolution of linetype, lineweight and color', () => {
  const m = model();
  const onLayer = { layer: 'hid' };
  assert.equal(effectiveLineType(m, onLayer).name, 'HIDDEN');
  assert.equal(effectiveLineWeight(m, onLayer), 0.35);
  assert.equal(effectiveColor(m, onLayer), '#ff0000');
  assert.ok(hasExplicitLineWeight(m, onLayer));
  const over = { layer: 'hid', lineType: 'center', lineWeight: 0.7, color: '#00ff00' };
  assert.equal(effectiveLineType(m, over).name, 'CENTER');
  assert.equal(effectiveLineWeight(m, over), 0.7);
  assert.equal(effectiveColor(m, over), '#00ff00');
  // Default lineweight and unknown names fall back
  assert.equal(effectiveLineWeight(m, { layer: 'hid', lineWeight: -3 }), 0.25);
  assert.ok(!hasExplicitLineWeight(m, { layer: 'hid', lineWeight: -3 }));
  assert.equal(effectiveLineType(m, { layer: 'hid', lineType: 'NOPE' }).name, 'Continuous');
  assert.equal(effectiveLineType(m, { layer: m.layers[0].id }).name, 'Continuous');
});

test('dash arrays scale and handle dots and leading gaps', () => {
  const dashed = findLineType({}, 'DASHED')!;
  assert.deepEqual(dashArray(dashed, 12), [6, 3]);
  assert.equal(dashArray(STANDARD_LINETYPES[0], 12), null);
  const dot = findLineType({}, 'DOT')!;
  assert.deepEqual(dashArray(dot, 2, 0.1), [0.1, 0.5]);
  const center = findLineType({}, 'CENTER')!;
  assert.deepEqual(dashArray(center, 1), [1.25, 0.25, 0.25, 0.25]);
  assert.deepEqual(dashArray({ name: 'g', description: '', pattern: [-0.5, 1] }, 1), [0, 0.5, 1, 0]);
  const m = model();
  assert.equal(lineTypeScaleFor(m, {}), 12);
  assert.equal(lineTypeScaleFor({ ...m, settings: { ...m.settings, ltScale: 24 } }, { lineTypeScale: 0.5 }), 12);
});

test('.lin files round-trip; complex linetypes are skipped', () => {
  const src = [
    ';; my linetypes',
    '*FENCE,Fence ----0----0----',
    'A,.25,-.1,["O",STANDARD,S=.1],-.1',
    '*MYDASH,My dash __  __',
    'A,.75,-.2',
    '*BIGDOT,Big dots',
    'A,0,-.5',
  ].join('\n');
  const r = parseLinFile(src);
  assert.deepEqual(r.skipped, ['FENCE']);
  assert.deepEqual(r.lineTypes.map((l) => [l.name, l.pattern]), [['MYDASH', [0.75, -0.2]], ['BIGDOT', [0, -0.5]]]);
  const again = parseLinFile(writeLinFile(r.lineTypes));
  assert.deepEqual(again.lineTypes, r.lineTypes);
  // project linetypes join (and can override) the standard set
  const all = allLineTypes({ lineTypes: r.lineTypes });
  assert.ok(all.some((l) => l.name === 'MYDASH') && all.some((l) => l.name === 'HIDDEN'));
});

test('DXF round trip keeps linetypes, lineweights, colors and LTSCALE', async () => {
  const { exportModelToDXF } = await import('./dxfExport');
  const { importFromDXF } = await import('./dxfImport');
  const m = model();
  m.settings = { ...m.settings, ltScale: 24 };
  m.lineTypes = [{ name: 'MYDASH', description: 'My dash', pattern: [0.75, -0.2] }];
  m.layers = m.layers.map((l) => (l.id === 'hid' ? { ...l, plot: false } : l));
  m.entities = [
    { id: 'a', type: 'line', layer: 'hid', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { id: 'b', type: 'circle', layer: m.layers[0].id, center: { x: 0, y: 0 }, radius: 20, lineType: 'MYDASH', lineWeight: 0.5, color: '#00ff00', lineTypeScale: 2 },
  ];
  const dxf = exportModelToDXF(m);
  assert.match(dxf, /\nLTYPE\r?\n[\s\S]*\nHIDDEN\r?\n/);
  const back = importFromDXF(dxf, 'level-1', createBlankProject().layers, 'imperial', []);
  const line = back.entities.find((e) => e.type === 'line')!;
  const circle = back.entities.find((e) => e.type === 'circle')!;
  const lay = back.layers.find((l) => l.name === 'A-HIDDEN')!;
  assert.equal(lay.lineType, 'HIDDEN');
  assert.equal(lay.lineWeight, 0.35);
  assert.equal(lay.plot, false);
  assert.equal(line.lineType, undefined, 'ByLayer stays ByLayer');
  assert.equal(circle.lineType, 'MYDASH');
  assert.equal(circle.lineWeight, 0.5);
  assert.equal(circle.color, '#00ff00');
  assert.equal(circle.lineTypeScale, 2);
  assert.deepEqual(back.lineTypes.map((l) => [l.name, l.pattern]), [['MYDASH', [0.75, -0.2]]]);
  assert.equal(back.ltScale, 24);
});
