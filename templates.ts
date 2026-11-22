/**
 * TEMPLATE GALLERY: ready-made starting plans (walls, doors, windows, rooms and furniture).
 * Plans are written in feet with (0,0) at the top-left and y growing down, then built with the
 * same engine as the AI sketch importer, so every template is ordinary editable geometry.
 */
import type { ArchEntity, ArchModel, BlockDefinition, BlockInstanceEntity, UnitSystem } from '../types/model';
import { applyAiPlan, type AiDoor, type AiPlan, type AiRoom, type AiWall, type AiWindow } from './aiPlan';
import { createBlankProject, createSampleProject } from './geometry';

export type TemplateCategory = 'Residential' | 'Commercial' | 'Start';

/** Furniture placement: block id, centre in feet, rotation in degrees (0 = back against a wall above it,
 *  90 = back against a wall to its left, 180 = below it, 270 = to its right). */
export interface TemplateFurniture { block: string; x: number; y: number; rot?: number }

export interface PlanTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  description: string;
  projectName: string;
  plan?: AiPlan;
  furniture?: TemplateFurniture[];
  blocks?: BlockDefinition[];
}

// ---------------------------------------------------------------------------------------------
// helpers (feet)
// ---------------------------------------------------------------------------------------------
const box = (x0: number, y0: number, x1: number, y1: number): AiWall[] => [
  { x1: x0, y1: y0, x2: x1, y2: y0, exterior: true },
  { x1: x1, y1: y0, x2: x1, y2: y1, exterior: true },
  { x1: x1, y1: y1, x2: x0, y2: y1, exterior: true },
  { x1: x0, y1: y1, x2: x0, y2: y0, exterior: true },
];
const h = (y: number, x0: number, x1: number): AiWall => ({ x1: x0, y1: y, x2: x1, y2: y });
const v = (x: number, y0: number, y1: number): AiWall => ({ x1: x, y1: y0, x2: x, y2: y1 });
const room = (name: string, ...pts: Array<[number, number]>): AiRoom => ({ name, polygon: pts.map(([x, y]) => ({ x, y })) });
const rectRoom = (name: string, x0: number, y0: number, x1: number, y1: number) => room(name, [x0, y0], [x1, y0], [x1, y1], [x0, y1]);
const win = (x: number, y: number, width = 4): AiWindow => ({ x, y, width });
const door = (x: number, y: number, width = 3, kind: AiDoor['kind'] = 'single', exterior = false): AiDoor => ({ x, y, width, kind, exterior });

// block symbol shapes (inches, centred on 0,0; back of the object at -y)
let shapeN = 0;
const R = (x1: number, y1: number, x2: number, y2: number): ArchEntity => ({ id: `tpls-${shapeN++}`, type: 'rectangle', layer: '0', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });
const C = (x: number, y: number, r: number): ArchEntity => ({ id: `tpls-${shapeN++}`, type: 'circle', layer: '0', center: { x, y }, radius: r });
const L = (x1: number, y1: number, x2: number, y2: number): ArchEntity => ({ id: `tpls-${shapeN++}`, type: 'line', layer: '0', start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });

const blk = (id: string, name: string, category: BlockDefinition['category'], w: number, d: number, ht: number, color: string, entities: ArchEntity[], tags: string[] = [], kind: BlockDefinition['kind'] = 'custom'): BlockDefinition => ({
  id, name, category, kind, width: w, depth: d, height: ht, color, entities, tags,
});

/** Commercial / office pieces the starter library does not have. */
export const TEMPLATE_BLOCKS: BlockDefinition[] = [
  blk('tpl-range', 'Commercial Range — 6 Burner + Oven', 'Kitchen', 60, 34, 36, '#9ca3af',
    [R(-30, -17, 30, 17), R(-30, -17, 30, -11), ...[-20, 0, 20].flatMap((x) => [C(x, -3, 5), C(x, 10, 5)])], ['range', 'stove', 'commercial', 'restaurant'], 'stove'),
  blk('tpl-prep-table', 'Stainless Prep Table 6\'', 'Kitchen', 72, 30, 36, '#d1d5db',
    [R(-36, -15, 36, 15), L(-36, 9, 36, 9)], ['prep', 'work table', 'stainless', 'restaurant']),
  blk('tpl-3comp-sink', '3-Compartment Sink with Drainboards', 'Kitchen', 90, 24, 36, '#d1d5db',
    [R(-45, -12, 45, 12), R(-27, -8, -11, 8), R(-8, -8, 8, 8), R(11, -8, 27, 8), L(-45, -10, 45, -10)], ['sink', 'dish', 'commercial', 'restaurant'], 'kitchen-counter'),
  blk('tpl-reach-in', 'Reach-in Refrigerator (2 door)', 'Kitchen', 54, 32, 80, '#94a3b8',
    [R(-27, -16, 27, 16), L(0, -16, 0, 16), L(-27, 12, 27, 12)], ['fridge', 'cooler', 'refrigerator', 'restaurant'], 'fridge'),
  blk('tpl-shelf', 'Storage Shelving 4\'', 'Furniture', 48, 18, 72, '#a8a29e',
    [R(-24, -9, 24, 9), L(-24, 0, 24, 0)], ['shelf', 'shelving', 'storage', 'rack']),
  blk('tpl-table-4', 'Dining Table for 4', 'Furniture', 60, 60, 30, '#b45309',
    [R(-18, -18, 18, 18), R(-9, -30, 9, -20), R(-9, 20, 9, 30), R(-30, -9, -20, 9), R(20, -9, 30, 9)], ['table', 'dining', 'restaurant', 'four top'], 'table-chairs'),
  blk('tpl-table-2', 'Dining Table for 2', 'Furniture', 30, 54, 30, '#b45309',
    [R(-15, -15, 15, 15), R(-9, -27, 9, -17), R(-9, 17, 9, 27)], ['table', 'dining', 'restaurant', 'two top']),
  blk('tpl-workstation', 'Desk 5\' with Chair', 'Furniture', 60, 48, 30, '#57534e',
    [R(-30, -24, 30, 6), L(-30, -18, 30, -18), C(0, 15, 9), L(-8, 6, 8, 6)], ['desk', 'office', 'workstation', 'chair']),
  blk('tpl-conf-table', 'Conference Table for 10', 'Furniture', 168, 84, 30, '#78350f',
    [R(-66, -24, 66, 24), ...[-48, -16, 16, 48].flatMap((x) => [C(x, -33, 8), C(x, 33, 8)]), C(-76, 0, 8), C(76, 0, 8)], ['conference', 'meeting', 'table', 'office']),
  blk('tpl-reception', 'Reception Desk', 'Furniture', 96, 30, 42, '#44403c',
    [R(-48, -15, 48, 15), R(-48, 5, 48, 15), C(0, -6, 8)], ['reception', 'desk', 'front desk', 'office']),
];

// ---------------------------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------------------------
const SMALL_HOUSE: PlanTemplate = {
  id: 'house-2bed',
  name: 'Small House — 2 Bed, 1 Bath',
  category: 'Residential',
  description: 'Open living / kitchen / dining, two bedrooms and a full bath off a short hall.',
  projectName: 'Small House',
  plan: {
    unit: 'ft',
    walls: [...box(0, 0, 36, 28), v(20, 0, 28), h(12, 20, 36), h(19, 20, 36), v(28, 12, 19)],
    doors: [door(16, 28, 3, 'single', true), door(20, 15.5), door(24, 12), door(24, 19), door(28, 15.5, 2.5)],
    windows: [win(6, 0, 6), win(14, 0, 4), win(0, 8), win(10, 28, 3), win(28, 0), win(28, 28), win(36, 15.5, 2)],
    rooms: [rectRoom('Living / Kitchen', 0, 0, 20, 28), rectRoom('Bedroom 1', 20, 0, 36, 12), rectRoom('Hall', 20, 12, 28, 19), rectRoom('Bath', 28, 12, 36, 19), rectRoom('Bedroom 2', 20, 19, 36, 28)],
  },
  furniture: [
    { block: 'starter-sofa', x: 1.9, y: 7, rot: 90 },
    { block: 'starter-fridge', x: 1.7, y: 17.6, rot: 90 },
    { block: 'starter-kitchen-counter', x: 1.4, y: 23.5, rot: 90 },
    { block: 'starter-stove', x: 5.5, y: 26.6, rot: 180 },
    { block: 'starter-table-chairs', x: 11, y: 21.5 },
    { block: 'starter-bed', x: 32.4, y: 6, rot: 270 },
    { block: 'starter-bed', x: 32.4, y: 23.5, rot: 270 },
    { block: 'starter-toilet', x: 34.4, y: 14, rot: 270 },
    { block: 'starter-sink', x: 30.6, y: 13.2 },
    { block: 'starter-bathtub', x: 33, y: 17.4, rot: 180 },
  ],
};

const RESTAURANT: PlanTemplate = {
  id: 'restaurant',
  name: 'Restaurant — Kitchen & Dining',
  category: 'Commercial',
  description: 'Commercial kitchen with range line, prep island, 3-compartment sink, walk-in cooler, dry storage, two restrooms and a 50-seat dining room.',
  projectName: 'Restaurant',
  plan: {
    unit: 'ft',
    walls: [...box(0, 0, 48, 32), v(20, 0, 32), h(20, 0, 20), v(8, 20, 32), v(14, 20, 32), h(26, 14, 20)],
    doors: [
      door(48, 16, 6, 'double', true), door(6.5, 0, 3, 'single', true), door(20, 10, 5, 'double'),
      door(4, 20), door(11, 20), door(20, 23), door(20, 29),
    ],
    windows: [win(28, 0, 6), win(38, 0, 6), win(28, 32, 6), win(38, 32, 6), win(48, 5), win(48, 27)],
    rooms: [
      rectRoom('Kitchen', 0, 0, 20, 20), rectRoom('Walk-in Cooler', 0, 20, 8, 32), rectRoom('Dry Storage', 8, 20, 14, 32),
      rectRoom('Restroom', 14, 20, 20, 26), rectRoom('Restroom', 14, 26, 20, 32), rectRoom('Dining', 20, 0, 48, 32),
    ],
  },
  furniture: [
    { block: 'tpl-range', x: 12, y: 1.7 },
    { block: 'tpl-prep-table', x: 10, y: 8.4 },
    { block: 'tpl-prep-table', x: 10, y: 10.9, rot: 180 },
    { block: 'tpl-3comp-sink', x: 1.3, y: 12, rot: 90 },
    { block: 'tpl-reach-in', x: 1.7, y: 4.5, rot: 90 },
    { block: 'tpl-shelf', x: 1.1, y: 26.5, rot: 90 },
    { block: 'tpl-shelf', x: 6.9, y: 26.5, rot: 270 },
    { block: 'tpl-shelf', x: 9.1, y: 27, rot: 90 },
    { block: 'tpl-shelf', x: 12.9, y: 27, rot: 270 },
    { block: 'starter-toilet', x: 15.4, y: 24.5, rot: 90 },
    { block: 'starter-sink', x: 16.2, y: 21.1 },
    { block: 'starter-toilet', x: 15.4, y: 30.5, rot: 90 },
    { block: 'starter-sink', x: 16.2, y: 27.1 },
    ...[25.5, 32, 38.5].flatMap((x) => [5, 12.5, 20, 27].map((y) => ({ block: 'tpl-table-4', x, y }))),
    { block: 'tpl-table-2', x: 45.3, y: 5 },
    { block: 'tpl-table-2', x: 45.3, y: 27 },
  ],
};

const OFFICE: PlanTemplate = {
  id: 'office',
  name: 'Small Office',
  category: 'Commercial',
  description: 'Open office for 20, conference room for 10, two private offices, reception, break room, restroom and storage.',
  projectName: 'Office',
  plan: {
    unit: 'ft',
    walls: [...box(0, 0, 50, 36), v(32, 0, 12), h(12, 32, 50), v(41, 12, 24), h(18, 41, 50), h(24, 20, 50), v(20, 24, 36), v(26, 24, 36), v(40, 24, 36)],
    doors: [
      door(10, 36, 6, 'double', true), door(32, 6), door(41, 15), door(41, 21), door(23, 24), door(33, 24, 4, 'opening'), door(40, 30),
    ],
    windows: [
      win(6, 0, 6), win(14, 0, 6), win(22, 0, 6), win(41, 0, 6), win(50, 6), win(50, 15), win(50, 21),
      win(0, 8), win(0, 16), win(4, 36), win(16, 36), win(33, 36),
    ],
    rooms: [
      room('Open Office', [0, 0], [32, 0], [32, 12], [41, 12], [41, 24], [0, 24]),
      rectRoom('Conference', 32, 0, 50, 12), rectRoom('Office', 41, 12, 50, 18), rectRoom('Office', 41, 18, 50, 24),
      rectRoom('Reception', 0, 24, 20, 36), rectRoom('Restroom', 20, 24, 26, 36), rectRoom('Break Room', 26, 24, 40, 36), rectRoom('Storage', 40, 24, 50, 36),
    ],
  },
  furniture: [
    ...[4, 9.5, 15, 20.5, 26].flatMap((x) => [
      { block: 'tpl-workstation', x, y: 4, rot: 180 },
      { block: 'tpl-workstation', x, y: 8 },
      { block: 'tpl-workstation', x, y: 15, rot: 180 },
      { block: 'tpl-workstation', x, y: 19 },
    ]),
    { block: 'tpl-conf-table', x: 41.5, y: 6 },
    { block: 'tpl-workstation', x: 47.7, y: 15, rot: 270 },
    { block: 'tpl-workstation', x: 47.7, y: 21, rot: 270 },
    { block: 'tpl-reception', x: 10, y: 27.5 },
    { block: 'starter-sofa', x: 1.9, y: 31.5, rot: 90 },
    { block: 'starter-toilet', x: 24.6, y: 33, rot: 270 },
    { block: 'starter-sink', x: 21.1, y: 33, rot: 90 },
    { block: 'starter-kitchen-counter', x: 31, y: 34.6, rot: 180 },
    { block: 'starter-fridge', x: 36.5, y: 34.3, rot: 180 },
    { block: 'starter-table-chairs', x: 32, y: 28.8 },
    { block: 'tpl-shelf', x: 48.9, y: 28, rot: 270 },
    { block: 'tpl-shelf', x: 48.9, y: 32.5, rot: 270 },
  ],
};

const STUDIO: PlanTemplate = {
  id: 'studio',
  name: 'Studio Apartment',
  category: 'Residential',
  description: 'One open living / sleeping room with a kitchen corner and a full bath.',
  projectName: 'Studio Apartment',
  plan: {
    unit: 'ft',
    walls: [...box(0, 0, 24, 30), h(20, 0, 10), v(10, 20, 30)],
    doors: [door(17, 30, 3, 'single', true), door(7, 20, 2.5)],
    windows: [win(6, 0, 5), win(18, 0, 5), win(24, 10), win(0, 15), win(13, 30, 3)],
    rooms: [rectRoom('Living / Sleeping', 0, 0, 24, 20), rectRoom('Bath', 0, 20, 10, 30), rectRoom('Kitchen', 10, 20, 24, 30)],
  },
  furniture: [
    { block: 'starter-bed', x: 3.6, y: 7, rot: 90 },
    { block: 'starter-sofa', x: 16, y: 12, rot: 180 },
    { block: 'starter-kitchen-counter', x: 22.6, y: 25, rot: 270 },
    { block: 'starter-fridge', x: 12, y: 28.3, rot: 180 },
    { block: 'starter-table-chairs', x: 16, y: 23.5 },
    { block: 'starter-toilet', x: 1.5, y: 27, rot: 90 },
    { block: 'starter-sink', x: 5, y: 28.9, rot: 180 },
    { block: 'starter-bathtub', x: 8.45, y: 25.3, rot: 270 },
  ],
};

export const PLAN_TEMPLATES: PlanTemplate[] = [
  { id: 'sample', name: 'Two-Room House (sample)', category: 'Residential', description: 'The starter house: living room and bedroom with doors, windows and furniture.', projectName: 'Sample 2-Room House' },
  SMALL_HOUSE,
  STUDIO,
  RESTAURANT,
  OFFICE,
  { id: 'blank', name: 'Blank Project', category: 'Start', description: 'An empty level to start from scratch.', projectName: 'Untitled Building Plan' },
];

/** "36' × 28' · 1,008 sq ft" or "11.0 × 8.5 m · 94 m²" (overall outside size). */
export function templateSizeLabel(t: PlanTemplate, units: UnitSystem): string {
  if (!t.plan) return t.id === 'sample' ? (units === 'metric' ? '8.5 × 5.5 m' : "28' × 18'") : '';
  const xs = t.plan.walls.flatMap((w) => [w.x1, w.x2]);
  const ys = t.plan.walls.flatMap((w) => [w.y1, w.y2]);
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...ys) - Math.min(...ys);
  if (units === 'metric') {
    const m = 0.3048;
    return `${(w * m).toFixed(1)} × ${(d * m).toFixed(1)} m · ${Math.round(w * d * m * m)} m²`;
  }
  return `${w}' × ${d}' · ${(w * d).toLocaleString('en-US')} sq ft`;
}

/** Builds a complete project from a template (units kept from the current project). */
export function buildTemplateModel(tpl: PlanTemplate, units: UnitSystem): ArchModel {
  if (tpl.id === 'sample') {
    const m = createSampleProject();
    return { ...m, settings: { ...m.settings, units } };
  }
  const blank = createBlankProject();
  const base: ArchModel = { ...blank, projectName: tpl.projectName, settings: { ...blank.settings, units } };
  if (!tpl.plan) return base;
  const levelId = base.levels?.[0]?.id ?? 'level-1';
  const have = new Set((base.blocks ?? []).map((b) => b.id));
  const blocks = [...(base.blocks ?? []), ...TEMPLATE_BLOCKS.filter((b) => !have.has(b.id))];
  const built = applyAiPlan({ ...base, blocks }, tpl.plan, levelId, 'replace', `tpl-${tpl.id}`).model;
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const furniture: BlockInstanceEntity[] = [];
  (tpl.furniture ?? []).forEach((f, i) => {
    const def = byId.get(f.block);
    if (!def) return;
    furniture.push({
      id: `tpl-${tpl.id}-f${i + 1}`,
      type: 'block',
      layer: 'A-FURN',
      levelId,
      blockId: def.id,
      name: def.name,
      position: { x: Math.round(f.x * 12 * 100) / 100, y: Math.round(f.y * 12 * 100) / 100 },
      rotation: f.rot ?? 0,
      scale: 1,
      width: def.width,
      depth: def.depth,
      height: def.height,
      color: def.color,
    });
  });
  return { ...built, blocks, entities: [...built.entities, ...furniture], activeLevelId: levelId };
}
