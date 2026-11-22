import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import type { PlanPrim } from './planPrimitives';
import { applyPlotStyle, BUILTIN_PLOT_STYLES, ctbToText, findPlotStyleTable, packCtb, parseCtbText, plotColor, unpackCtb, OBJECT_PEN } from './plotStyles';

const t = (n: string) => findPlotStyleTable({}, n)!;
const prims: PlanPrim[] = [
  { k: 'poly', pts: [], closed: false, stroke: '#44403c', w: 0.18, src: '#ff0000' },
  { k: 'poly', pts: [], closed: true, stroke: '#d6d3d1', fill: '#d6d3d1', w: 0.05, src: '#1c1917' },
  { k: 'poly', pts: [], closed: true, stroke: '#1c1917', fill: '#f5f5f4', w: 0.13, src: '#0000ff' },
  { k: 'text', p: { x: 0, y: 0 }, text: 'A', size: 2, align: 'left', rot: 0, color: '#1c1917', src: '#00ff00' },
];

test('no table leaves the drawing as it is', () => {
  assert.equal(applyPlotStyle(prims, null), prims);
});

test('acad.ctb plots object colors; monochrome plots black with gray fills', () => {
  const a = applyPlotStyle(prims, t('acad.ctb'));
  assert.equal((a[0] as { stroke: string }).stroke, '#ff0000');
  assert.equal((a[3] as { color: string }).color, '#00ff00');
  const m = applyPlotStyle(prims, t('monochrome.ctb'));
  assert.equal((m[0] as { stroke: string }).stroke, '#000000');
  assert.equal((m[3] as { color: string }).color, '#000000');
  const fill = m[2] as { fill: string; stroke: string };
  assert.equal(fill.stroke, '#000000');
  assert.match(fill.fill, /^#f[0-9a-f]f[0-9a-f]f[0-9a-f]$/, 'floor tint stays light');
  const seam = m[1] as { fill: string; stroke: string; w: number };
  assert.equal(seam.stroke, seam.fill, 'wall poché seams keep the fill color');
  assert.equal(seam.w, 0.05);
});

test('lineweight by color and screening', () => {
  const pens = applyPlotStyle(prims, t('ARCHIFORMA Pens.ctb'));
  assert.equal((pens[0] as { w: number }).w, 0.18); // red = pen 1
  assert.equal((pens[2] as { w: number }).w, 0.7); // blue = pen 5
  assert.equal(plotColor({ ...OBJECT_PEN, screening: 50 }, '#000000'), '#808080');
  assert.equal(plotColor({ ...OBJECT_PEN, grayscale: true }, '#ff0000'), '#4c4c4c');
});

test('.ctb files round-trip (header, zlib, pens)', () => {
  for (const table of BUILTIN_PLOT_STYLES) {
    const text = ctbToText(table);
    const file = packCtb(new Uint8Array(deflateSync(Buffer.from(text + '\0'))), text.length + 1);
    assert.equal(new TextDecoder().decode(file.slice(0, 14)), 'PIAFILEVERSION');
    const back = parseCtbText(new TextDecoder().decode(inflateSync(unpackCtb(file))), table.name);
    for (let aci = 1; aci <= 255; aci++) {
      const want = table.pens[aci] ?? OBJECT_PEN;
      const got = back.pens[aci] ?? OBJECT_PEN;
      assert.deepEqual({ ...got, grayscale: !!got.grayscale }, { ...want, grayscale: !!want.grayscale }, `${table.name} pen ${aci}`);
    }
  }
  assert.throws(() => unpackCtb(new Uint8Array([1, 2, 3])), /not an AutoCAD/);
  assert.throws(() => parseCtbText('aci_table_available=FALSE\nplot_style{\n}\n', 'x.stb'), /named plot style/);
});
