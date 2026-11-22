import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BlockInstanceEntity, RoomEntity, WallEntity } from '../types/model';
import { applyAiPlan } from './aiPlan';
import { createBlankProject } from './geometry';
import { PLAN_TEMPLATES, TEMPLATE_BLOCKS, buildTemplateModel } from './templates';

type Box = { minX: number; minY: number; maxX: number; maxY: number };
const overlap = (a: Box, b: Box, tol = 0.5) => a.minX < b.maxX - tol && a.maxX > b.minX + tol && a.minY < b.maxY - tol && a.maxY > b.minY + tol;
const furnBox = (f: BlockInstanceEntity): Box => {
  const turned = Math.round(f.rotation / 90) % 2 !== 0;
  const w = (turned ? f.depth : f.width) / 2;
  const d = (turned ? f.width : f.depth) / 2;
  return { minX: f.position.x - w, maxX: f.position.x + w, minY: f.position.y - d, maxY: f.position.y + d };
};
const wallBox = (w: WallEntity): Box => {
  const t = w.thickness / 2;
  return { minX: Math.min(w.start.x, w.end.x) - t, maxX: Math.max(w.start.x, w.end.x) + t, minY: Math.min(w.start.y, w.end.y) - t, maxY: Math.max(w.start.y, w.end.y) + t };
};
const inPoly = (p: { x: number; y: number }, poly: { x: number; y: number }[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

for (const tpl of PLAN_TEMPLATES) {
  test(`template "${tpl.name}" builds cleanly`, () => {
    const m = buildTemplateModel(tpl, 'imperial');
    assert.ok(m.entities.length > 0 || tpl.id === 'blank');
    if (!tpl.plan) return;
    // every door / window / room landed
    const r = applyAiPlan({ ...createBlankProject(), blocks: [...(createBlankProject().blocks ?? []), ...TEMPLATE_BLOCKS] }, tpl.plan, 'level-1', 'replace', 'x').report;
    assert.deepEqual(r.skipped, [], `${tpl.id}: ${r.skipped.join('; ')}`);
    assert.equal(r.doors + r.openings, tpl.plan.doors?.length ?? 0);
    assert.equal(r.windows, tpl.plan.windows?.length ?? 0);
    assert.equal(r.rooms, tpl.plan.rooms?.length ?? 0);
    // every furniture block exists and sits inside a room, clear of walls and other furniture
    const furn = m.entities.filter((e): e is BlockInstanceEntity => e.type === 'block');
    assert.equal(furn.length, tpl.furniture?.length ?? 0, 'missing furniture block definitions');
    const walls = m.entities.filter((e): e is WallEntity => e.type === 'wall');
    const rooms = m.entities.filter((e): e is RoomEntity => e.type === 'room');
    // doorways stay passable: door width × 2'-0" each side of the wall is free of furniture
    const doorways = m.entities.filter((e) => e.type === 'door' || e.type === 'wallopening').map((d) => {
      const o = d as unknown as { wallId: string; offset: number; width: number; mark?: string };
      const w = walls.find((x) => x.id === o.wallId)!;
      const c = { x: w.start.x + (w.end.x - w.start.x) * o.offset, y: w.start.y + (w.end.y - w.start.y) * o.offset };
      const horiz = Math.abs(w.end.y - w.start.y) < 1e-6;
      const half = o.width / 2, reach = w.thickness / 2 + 24;
      return { mark: o.mark, box: horiz ? { minX: c.x - half, maxX: c.x + half, minY: c.y - reach, maxY: c.y + reach } : { minX: c.x - reach, maxX: c.x + reach, minY: c.y - half, maxY: c.y + half } };
    });
    for (const f of furn) {
      const b = furnBox(f);
      const blocked = doorways.find((d) => overlap(b, d.box));
      assert.ok(!blocked, `${tpl.id}: ${f.name} at (${f.position.x / 12}, ${f.position.y / 12}) blocks door ${blocked?.mark}`);
      const hitWall = walls.find((w) => overlap(b, wallBox(w)));
      assert.ok(!hitWall, `${tpl.id}: ${f.name} at (${f.position.x / 12}, ${f.position.y / 12}) hits wall ${hitWall?.id}`);
      assert.ok(rooms.some((rm) => inPoly(f.position, rm.polygon)), `${tpl.id}: ${f.name} is outside every room`);
      const other = furn.find((g) => g !== f && overlap(b, furnBox(g)));
      assert.ok(!other, `${tpl.id}: ${f.name} at (${f.position.x / 12}, ${f.position.y / 12}) overlaps ${other?.name} at (${(other?.position.x ?? 0) / 12}, ${(other?.position.y ?? 0) / 12})`);
    }
  });
}

test('template keeps units and names the project', () => {
  const m = buildTemplateModel(PLAN_TEMPLATES.find((t) => t.id === 'office')!, 'metric');
  assert.equal(m.settings.units, 'metric');
  assert.equal(m.projectName, 'Office');
  assert.ok((m.blocks ?? []).some((b) => b.id === 'tpl-workstation'));
});
