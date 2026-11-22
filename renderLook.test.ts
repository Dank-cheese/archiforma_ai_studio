import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOOK, LOOK_PRESETS, LOOK_SCHEMA, compass, lookCategoryOf, normalizeLook, sunDirection } from './renderLook';

test('normalizeLook clamps numbers, fixes colours and keeps missing parts from the base', () => {
  const l = normalizeLook({
    name: '  Sunset villa ',
    skyTop: 'f80',
    skyBottom: 'not a colour',
    exposure: 9,
    sunAzimuth: -90,
    sunAltitude: 120,
    fogDensity: '0.4',
    materials: { walls: { color: '#FFFFFF', roughness: 3 }, bogus: { color: '#000000' } },
  });
  assert.equal(l.name, 'Sunset villa');
  assert.equal(l.skyTop, '#ff8800');
  assert.equal(l.skyBottom, DEFAULT_LOOK.skyBottom);
  assert.equal(l.exposure, 2.5);
  assert.equal(l.sunAzimuth, 270);
  assert.equal(l.sunAltitude, 90);
  assert.equal(l.fogDensity, 0.4);
  assert.deepEqual(l.materials.walls, { color: '#ffffff', roughness: 1, metalness: 0 });
  assert.deepEqual(l.materials.roof, DEFAULT_LOOK.materials.roof);
  assert.equal((l.materials as Record<string, unknown>).bogus, undefined);
});

test('presets are valid looks and the schema lists every category', () => {
  for (const p of LOOK_PRESETS) assert.deepEqual(normalizeLook(p, p), p, p.name);
  const cats = Object.keys(LOOK_SCHEMA.properties.materials.properties);
  assert.ok(cats.includes('walls') && cats.includes('windows') && cats.includes('furniture'));
});

test('sun direction: compass bearing on a y-down plan (north = −z, east = +x)', () => {
  const south = sunDirection(180, 0.5);
  assert.ok(south.z > 0.99 && Math.abs(south.x) < 1e-6);
  const east = sunDirection(90, 30);
  assert.ok(east.x > 0.86 && Math.abs(east.z) < 1e-6 && Math.abs(east.y - 0.5) < 1e-6);
  assert.equal(compass(225), 'SW');
  assert.equal(compass(359), 'N');
});

test('element categories', () => {
  assert.equal(lookCategoryOf('wall'), 'walls');
  assert.equal(lookCategoryOf('anything', 'hub:abc'), 'walls');
  assert.equal(lookCategoryOf('window'), 'windows');
  assert.equal(lookCategoryOf('block'), 'furniture');
  assert.equal(lookCategoryOf('dimension'), null);
});
