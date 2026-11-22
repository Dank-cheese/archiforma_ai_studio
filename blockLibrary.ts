/**
 * BLOCK LIBRARY helpers (pure): create / duplicate blocks, edit their shapes,
 * and share blocks between projects as a small JSON file.
 */
import type { ArchEntity, BlockCategory, BlockDefinition, Point } from '../types/model';

export const BLOCK_CATEGORIES: BlockCategory[] = ['Custom', 'Furniture', 'Kitchen', 'Plumbing', 'Architecture', 'Site', 'Cabin & Living', 'Kitchen & Bath', 'Stairs, Porches & Site'];

let seq = 0;
export const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export type BlockShape = Extract<ArchEntity, { type: 'rectangle' | 'circle' | 'line' | 'polyline' | 'arc' }>;
export const isShape = (e: ArchEntity): e is BlockShape => ['rectangle', 'circle', 'line', 'polyline', 'arc'].includes(e.type);

/** A new custom block: a 36" × 24" × 30" box. */
export function newCustomBlock(name = 'New Block'): BlockDefinition {
  const top = newId('shape');
  return {
    id: newId('block'),
    name,
    category: 'Custom',
    kind: 'custom',
    width: 36,
    depth: 24,
    height: 30,
    color: '#0d9488',
    entities: [{ id: top, type: 'rectangle', layer: '0', p1: { x: -18, y: -12 }, p2: { x: 18, y: 12 } }],
  };
}

/** Unique "Name (2)", "Name (3)"… among existing blocks. */
export function uniqueName(name: string, blocks: BlockDefinition[]): string {
  const names = new Set(blocks.map((b) => b.name.toLowerCase()));
  if (!names.has(name.toLowerCase())) return name;
  const base = name.replace(/\s*\(\d+\)$/, '');
  for (let i = 2; i < 1000; i++) {
    const n = `${base} (${i})`;
    if (!names.has(n.toLowerCase())) return n;
  }
  return `${base} ${Date.now()}`;
}

/** Copy of a block with fresh ids. */
export function duplicateBlock(def: BlockDefinition, blocks: BlockDefinition[]): BlockDefinition {
  const entities = def.entities.map((e) => ({ ...structuredCloneSafe(e), id: newId('shape') }) as ArchEntity);
  return { ...def, id: newId('block'), name: uniqueName(`${def.name} copy`, blocks), entities };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

export function shapeBounds(e: ArchEntity): { minX: number; minY: number; maxX: number; maxY: number } | null {
  switch (e.type) {
    case 'rectangle':
      return { minX: Math.min(e.p1.x, e.p2.x), minY: Math.min(e.p1.y, e.p2.y), maxX: Math.max(e.p1.x, e.p2.x), maxY: Math.max(e.p1.y, e.p2.y) };
    case 'circle':
    case 'arc':
      return { minX: e.center.x - e.radius, minY: e.center.y - e.radius, maxX: e.center.x + e.radius, maxY: e.center.y + e.radius };
    case 'line':
      return { minX: Math.min(e.start.x, e.end.x), minY: Math.min(e.start.y, e.end.y), maxX: Math.max(e.start.x, e.end.x), maxY: Math.max(e.start.y, e.end.y) };
    case 'polyline': {
      if (!e.points.length) return null;
      const xs = e.points.map((p) => p.x);
      const ys = e.points.map((p) => p.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
    default:
      return null;
  }
}

const mapPts = (e: ArchEntity, fn: (p: Point) => Point): ArchEntity => {
  switch (e.type) {
    case 'rectangle':
      return { ...e, p1: fn(e.p1), p2: fn(e.p2) };
    case 'circle':
      return { ...e, center: fn(e.center) };
    case 'line':
      return { ...e, start: fn(e.start), end: fn(e.end) };
    case 'polyline':
      return { ...e, points: e.points.map(fn) };
    case 'arc':
      return { ...e, center: fn(e.center) };
    default:
      return e;
  }
};

export function moveShape(e: ArchEntity, dx: number, dy: number): ArchEntity {
  return mapPts(e, (p) => ({ x: p.x + dx, y: p.y + dy }));
}

/** Mirror across the block's centre line: 'x' flips left↔right, 'y' flips front↔back. */
export function mirrorShape(e: ArchEntity, axis: 'x' | 'y'): ArchEntity {
  const m = mapPts(e, (p) => (axis === 'x' ? { x: -p.x, y: p.y } : { x: p.x, y: -p.y }));
  if (m.type === 'arc') {
    const a0 = (m as Extract<ArchEntity, { type: 'arc' }>).startAngle;
    const a1 = (m as Extract<ArchEntity, { type: 'arc' }>).endAngle;
    return axis === 'x' ? { ...m, startAngle: 180 - a1, endAngle: 180 - a0 } : { ...m, startAngle: -a1, endAngle: -a0 };
  }
  return m;
}

/** Copies a shape — optionally mirrored. Returns the new block. */
export function copyShape(def: BlockDefinition, shapeId: string, mirror?: 'x' | 'y'): { block: BlockDefinition; newId: string } {
  const src = def.entities.find((e) => e.id === shapeId);
  if (!src) return { block: def, newId: shapeId };
  const id = newId('shape');
  let copy: ArchEntity = { ...structuredCloneSafe(src), id };
  copy = mirror ? mirrorShape(copy, mirror) : moveShape(copy, 3, 3);
  return { block: { ...def, entities: [...def.entities, copy] }, newId: id };
}

export function removeShape(def: BlockDefinition, shapeId: string): BlockDefinition {
  return { ...def, entities: def.entities.filter((e) => e.id !== shapeId) };
}

/** Moves all shapes so their combined bounds are centred on (0,0) — the insertion point. */
export function centerShapes(def: BlockDefinition): BlockDefinition {
  const bs = def.entities.map(shapeBounds).filter(Boolean) as Array<NonNullable<ReturnType<typeof shapeBounds>>>;
  if (!bs.length) return def;
  const cx = (Math.min(...bs.map((b) => b.minX)) + Math.max(...bs.map((b) => b.maxX))) / 2;
  const cy = (Math.min(...bs.map((b) => b.minY)) + Math.max(...bs.map((b) => b.maxY))) / 2;
  if (Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6) return def;
  return { ...def, entities: def.entities.map((e) => moveShape(e, -cx, -cy)) };
}

/** Width / depth that wrap all shapes (used by "Fit size to shapes"). */
export function shapesExtent(def: BlockDefinition): { width: number; depth: number } | null {
  const bs = def.entities.map(shapeBounds).filter(Boolean) as Array<NonNullable<ReturnType<typeof shapeBounds>>>;
  if (!bs.length) return null;
  return {
    width: Math.max(1, Math.max(...bs.map((b) => b.maxX)) - Math.min(...bs.map((b) => b.minX))),
    depth: Math.max(1, Math.max(...bs.map((b) => b.maxY)) - Math.min(...bs.map((b) => b.minY))),
  };
}

// ---------------------------------------------------------------------------------------------
// Share blocks between projects (.archiblocks.json)
// ---------------------------------------------------------------------------------------------

export const BLOCK_FILE_FORMAT = 'archiforma-blocks';

export function serializeBlocks(blocks: BlockDefinition[]): string {
  return JSON.stringify({ format: BLOCK_FILE_FORMAT, version: 1, exported: new Date().toISOString(), blocks }, null, 2);
}

function isBlock(b: unknown): b is BlockDefinition {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string' && Array.isArray(o.entities) &&
    [o.width, o.depth, o.height].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
}

/** Accepts our block file, a single block, or a whole saved project (takes its blocks). */
export function parseBlockFile(text: string): BlockDefinition[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const o = raw as Record<string, unknown>;
  const list: unknown[] = Array.isArray(o?.blocks) ? (o.blocks as unknown[]) : Array.isArray(raw) ? (raw as unknown[]) : isBlock(raw) ? [raw] : [];
  const blocks = list.filter(isBlock).map((b) => ({
    ...b,
    category: (b.category || 'Custom') as BlockCategory,
    kind: b.kind || 'custom',
    color: typeof b.color === 'string' ? b.color : '#0d9488',
  }));
  if (!blocks.length) throw new Error('No blocks found in that file.');
  return blocks;
}

/** Adds imported blocks: identical ones are skipped, id / name clashes get new ids / names. */
export function mergeBlocks(existing: BlockDefinition[], incoming: BlockDefinition[]): { blocks: BlockDefinition[]; added: BlockDefinition[]; skipped: number } {
  const out = [...existing];
  const added: BlockDefinition[] = [];
  let skipped = 0;
  const sameContent = (a: BlockDefinition, b: BlockDefinition) =>
    JSON.stringify([a.name, a.width, a.depth, a.height, a.color, a.entities, a.libKind ?? '']) ===
    JSON.stringify([b.name, b.width, b.depth, b.height, b.color, b.entities, b.libKind ?? '']);
  for (const b of incoming) {
    const clash = out.find((e) => e.id === b.id);
    if (clash && sameContent(clash, b)) {
      skipped++;
      continue;
    }
    const nb: BlockDefinition = { ...b, id: clash ? newId('block') : b.id, name: uniqueName(b.name, out) };
    out.push(nb);
    added.push(nb);
  }
  return { blocks: out, added, skipped };
}
