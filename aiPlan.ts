/**
 * AI SKETCH → PLAN
 * ----------------
 * Turns the JSON an AI model returns for a hand sketch (or a text brief) into real ARCHIFORMA
 * BIM entities: typed walls, hosted doors / windows / cased openings, rooms and overall dimensions.
 *
 * Vision models draw sloppy geometry (corners that miss by a few inches, walls 2° off square,
 * partitions that stop short of the wall they meet), so the raw coordinates are cleaned up here
 * before anything reaches the model:
 *   1. convert to inches            4. join T-junctions (extend / trim to the wall they meet)
 *   2. square near-orthogonal walls 5. host openings on the nearest wall, sized from the type catalog
 *   3. align endpoints on shared X / Y lines (corners meet exactly)
 *
 * Everything in this file is pure (no network, no DOM) so it can be unit tested.
 */
import type {
  ArchEntity,
  ArchModel,
  DimensionEntity,
  DoorEntity,
  DoorType,
  Point,
  RoomEntity,
  WallEntity,
  WallOpeningEntity,
  WallType,
  WindowEntity,
  WindowType,
} from '../types/model';
import { computeModelExtents, createBlankProject, getWallTypeTotalThickness } from './geometry';
import { doorTypeFields, windowTypeFields } from './openings';

// ---------------------------------------------------------------------------------------------
// AI response shape
// ---------------------------------------------------------------------------------------------

export type AiUnit = 'ft' | 'm' | 'in';
export type AiDoorKind = 'single' | 'double' | 'sliding' | 'pocket' | 'garage' | 'barn' | 'bifold' | 'opening';

export interface AiPoint { x: number; y: number }
export interface AiWall { x1: number; y1: number; x2: number; y2: number; exterior?: boolean }
export interface AiDoor { x: number; y: number; width?: number; kind?: AiDoorKind; exterior?: boolean }
export interface AiWindow { x: number; y: number; width?: number }
export interface AiRoom { name: string; polygon: AiPoint[] }

export interface AiPlan {
  unit?: AiUnit;
  summary?: string;
  assumptions?: string[];
  walls: AiWall[];
  doors?: AiDoor[];
  windows?: AiWindow[];
  rooms?: AiRoom[];
}

/** JSON Schema handed to the model as its required response format. */
export const AI_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    unit: { type: 'string', enum: ['ft', 'm'], description: 'Unit for every coordinate and width in this response.' },
    summary: { type: 'string', description: 'One sentence describing the plan.' },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short notes on anything guessed: missing dimensions, unreadable labels, scale.',
    },
    walls: {
      type: 'array',
      description: 'Wall centerlines. Corners share identical endpoints; interior walls end exactly on the wall they meet.',
      items: {
        type: 'object',
        properties: {
          x1: { type: 'number' },
          y1: { type: 'number' },
          x2: { type: 'number' },
          y2: { type: 'number' },
          exterior: { type: 'boolean', description: 'true for walls on the outside of the building.' },
        },
        required: ['x1', 'y1', 'x2', 'y2', 'exterior'],
      },
    },
    doors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Center of the door, on the wall centerline.' },
          y: { type: 'number' },
          width: { type: 'number' },
          kind: { type: 'string', enum: ['single', 'double', 'sliding', 'pocket', 'garage', 'barn', 'bifold', 'opening'] },
          exterior: { type: 'boolean' },
        },
        required: ['x', 'y', 'width', 'kind'],
      },
    },
    windows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Center of the window, on the wall centerline.' },
          y: { type: 'number' },
          width: { type: 'number' },
        },
        required: ['x', 'y', 'width'],
      },
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          polygon: {
            type: 'array',
            description: 'Room boundary along wall centerlines, in order, not repeating the first point.',
            items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
          },
        },
        required: ['name', 'polygon'],
      },
    },
  },
  required: ['unit', 'summary', 'walls', 'doors', 'windows', 'rooms'],
} as const;

/** System instruction: how to read a sketch and how to lay out the JSON. */
export const AI_PLAN_SYSTEM_PROMPT = `You are an experienced residential architect who converts floor plan sketches and written briefs into precise CAD geometry for a single building level.

COORDINATES
- Top-left corner of the building is (0, 0). x grows to the right, y grows DOWN (same orientation as the sketch image).
- Give every value in the unit you choose: "ft" (decimal feet, e.g. 12.5) or "m". Use "m" only if the user or the sketch uses metric.
- Walls are CENTERLINES. Walls that meet at a corner must share exactly the same endpoint. An interior wall that meets another wall must end exactly on it (T-junction). Keep walls straight and use right angles unless the sketch clearly shows an angle.
- Split nothing unnecessarily: one straight run of wall = one wall.

READING A SKETCH
- Use every written dimension and label. If dimensions are missing, infer scale from typical sizes (interior door 2.5-3 ft, bedroom 10-14 ft, bathroom 5x8 ft, kitchen 10-14 ft, garage 20-24 ft) and say so in assumptions.
- Hand-drawn lines are wobbly: straighten them and align walls that are clearly meant to line up.
- Arcs or gaps in a wall are doors. Thin double/triple lines or marks in an exterior wall are windows. A gap without a door swing between two spaces is kind "opening".

WRITTEN BRIEFS (no sketch, or extra instructions)
- Design a sensible, buildable plan that satisfies the request: good circulation, every room reachable, bedrooms with windows, bathrooms near bedrooms, an entry door on the outside.
- When a sketch is attached, the text is extra guidance (overall size, room names, changes to make).

OPENINGS
- Door and window (x, y) is the CENTER of the opening on its host wall's centerline. Typical widths: interior door 2.5-3 ft, entry door 3 ft, double/French 5 ft, sliding patio 6-8 ft, garage 9 or 16 ft, windows 2-6 ft.
- Set exterior: true on doors in exterior walls.

ROOMS
- One room per enclosed space, with its name ("Living Room", "Bedroom 2", "Bath", "Kitchen", "Closet"...). Polygon follows the wall centerlines around the space.`;

/** Builds the per-request text that accompanies the sketch. */
export function buildAiUserPrompt(userText: string, hasSketch: boolean, units: 'imperial' | 'metric'): string {
  const brief = userText.trim();
  const lines: string[] = [];
  if (hasSketch) {
    lines.push('Convert the attached floor plan sketch into the JSON plan.');
    if (brief) lines.push(`Extra instructions from the user: ${brief}`);
  } else {
    lines.push(`Design a floor plan for this request: ${brief || 'a small two-bedroom house'}`);
  }
  lines.push(`The project uses ${units === 'metric' ? 'metric units (prefer "m")' : 'imperial units (prefer "ft")'}.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Parsing / validation
// ---------------------------------------------------------------------------------------------

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Parses the model's text reply into an AiPlan, tolerating code fences and stray fields. */
export function parseAiPlan(text: string): AiPlan {
  let body = (text || '').trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('The AI reply did not contain a plan.');
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(first, last + 1));
  } catch {
    throw new Error('The AI reply was not valid JSON. Try again.');
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []);

  const unitRaw = String(o.unit ?? 'ft').toLowerCase();
  const unit: AiUnit = unitRaw.startsWith('m') ? 'm' : unitRaw.startsWith('in') ? 'in' : 'ft';

  const walls: AiWall[] = [];
  for (const w of arr(o.walls)) {
    const x1 = num(w.x1), y1 = num(w.y1), x2 = num(w.x2), y2 = num(w.y2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) continue;
    walls.push({ x1, y1, x2, y2, exterior: w.exterior === true });
  }
  const kinds: AiDoorKind[] = ['single', 'double', 'sliding', 'pocket', 'garage', 'barn', 'bifold', 'opening'];
  const doors: AiDoor[] = [];
  for (const d of arr(o.doors)) {
    const x = num(d.x), y = num(d.y);
    if (x === null || y === null) continue;
    const k = String(d.kind ?? 'single').toLowerCase() as AiDoorKind;
    doors.push({ x, y, width: num(d.width) ?? undefined, kind: kinds.includes(k) ? k : 'single', exterior: d.exterior === true });
  }
  const windows: AiWindow[] = [];
  for (const w of arr(o.windows)) {
    const x = num(w.x), y = num(w.y);
    if (x === null || y === null) continue;
    windows.push({ x, y, width: num(w.width) ?? undefined });
  }
  const rooms: AiRoom[] = [];
  for (const r of arr(o.rooms)) {
    const pts: AiPoint[] = [];
    for (const p of arr(r.polygon)) {
      const x = num(p.x), y = num(p.y);
      if (x !== null && y !== null) pts.push({ x, y });
    }
    if (pts.length >= 3) rooms.push({ name: String(r.name ?? 'Room').slice(0, 60) || 'Room', polygon: pts });
  }
  if (walls.length === 0) throw new Error('The AI could not find any walls. Try a clearer sketch or describe the plan in words.');
  return {
    unit,
    summary: typeof o.summary === 'string' ? o.summary : undefined,
    assumptions: Array.isArray(o.assumptions) ? o.assumptions.filter((s): s is string => typeof s === 'string').slice(0, 12) : [],
    walls: walls.slice(0, 400),
    doors: doors.slice(0, 200),
    windows: windows.slice(0, 300),
    rooms: rooms.slice(0, 120),
  };
}

// ---------------------------------------------------------------------------------------------
// Geometry clean-up helpers
// ---------------------------------------------------------------------------------------------

const UNIT_TO_IN: Record<AiUnit, number> = { ft: 12, m: 39.3700787, in: 1 };
const SQUARE_TOL_DEG = 5;     // walls within this many degrees of horizontal / vertical are squared
const ALIGN_TOL = 6;          // inches: endpoints this close on X or Y share one line
const JOIN_TOL = 15;          // inches: a free wall end this close to another wall is extended / trimmed to it
const HOST_TOL = 30;          // inches: openings this close to a wall are hosted on it
const OPEN_MARGIN = 6;        // inches: keep openings clear of wall ends (corners)

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const round1 = (v: number) => Math.round(v);

/** 1-D clustering: values within `tol` of a group's first value collapse to the group mean. */
export function makeAxisSnapper(values: number[], tol: number, module = 0): (v: number) => number {
  // lines that land within 2" of a whole module (6" in imperial) snap to it: 27'-11 3/4" → 28'-0"
  const nice = (m: number) => {
    if (!module) return m;
    const n = Math.round(m / module) * module;
    return Math.abs(n - m) <= 2 ? n : m;
  };
  const sorted = [...values].sort((a, b) => a - b);
  const means: number[] = [];
  let group: number[] = [];
  const flush = () => {
    if (group.length) means.push(nice(round1(group.reduce((s, v) => s + v, 0) / group.length)));
    group = [];
  };
  for (const v of sorted) {
    if (group.length && v - group[0] > tol) flush();
    group.push(v);
  }
  flush();
  return (v: number) => {
    let best = v;
    let bestD = tol + 1e-9;
    for (const m of means) {
      const d = Math.abs(m - v);
      if (d <= bestD) { bestD = d; best = m; }
    }
    return best === v ? round1(v) : best;
  };
}

interface Seg { a: Point; b: Point; exterior: boolean }

/** Squares near-orthogonal walls, aligns shared lines, joins T-junctions and drops junk. */
export function cleanWalls(input: Seg[], module = 0): { walls: Seg[]; snapX: (v: number) => number; snapY: (v: number) => number } {
  const tan = Math.tan((SQUARE_TOL_DEG * Math.PI) / 180);
  // 1. square up
  let segs = input.map((s) => {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    if (Math.abs(dy) <= Math.abs(dx) * tan) {
      const y = (s.a.y + s.b.y) / 2;
      return { ...s, a: { x: s.a.x, y }, b: { x: s.b.x, y } };
    }
    if (Math.abs(dx) <= Math.abs(dy) * tan) {
      const x = (s.a.x + s.b.x) / 2;
      return { ...s, a: { x, y: s.a.y }, b: { x, y: s.b.y } };
    }
    return s;
  });
  // 2. align endpoints on shared X / Y lines
  const snapX = makeAxisSnapper(segs.flatMap((s) => [s.a.x, s.b.x]), ALIGN_TOL, module);
  const snapY = makeAxisSnapper(segs.flatMap((s) => [s.a.y, s.b.y]), ALIGN_TOL, module);
  segs = segs.map((s) => ({ ...s, a: { x: snapX(s.a.x), y: snapY(s.a.y) }, b: { x: snapX(s.b.x), y: snapY(s.b.y) } }));

  // 3. T-junctions: move each free end along its own wall line onto the nearest wall it should meet
  const onSegment = (p: Point, s: Seg, tol: number) => {
    const L2 = (s.b.x - s.a.x) ** 2 + (s.b.y - s.a.y) ** 2;
    if (L2 === 0) return dist(p, s.a) <= tol;
    const t = ((p.x - s.a.x) * (s.b.x - s.a.x) + (p.y - s.a.y) * (s.b.y - s.a.y)) / L2;
    if (t < -1e-6 || t > 1 + 1e-6) return false;
    return dist(p, { x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) }) <= tol;
  };
  for (let i = 0; i < segs.length; i++) {
    for (const end of ['a', 'b'] as const) {
      const s = segs[i];
      const p = s[end];
      const other = end === 'a' ? s.b : s.a;
      if (segs.some((o, j) => j !== i && onSegment(p, o, 0.75))) continue; // already joined
      const dx = p.x - other.x;
      const dy = p.y - other.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len;
      const uy = dy / len;
      let best: Point | null = null;
      let bestD = JOIN_TOL;
      for (let j = 0; j < segs.length; j++) {
        if (j === i) continue;
        const o = segs[j];
        const ex = o.b.x - o.a.x;
        const ey = o.b.y - o.a.y;
        const denom = ux * ey - uy * ex;
        if (Math.abs(denom) < 1e-9) continue; // parallel
        // p + u*s = o.a + e*t
        const sParam = ((o.a.x - p.x) * ey - (o.a.y - p.y) * ex) / denom;
        const tParam = ((o.a.x - p.x) * uy - (o.a.y - p.y) * ux) / denom;
        if (tParam < -0.001 || tParam > 1.001) continue;
        if (len + sParam < 6) continue; // would collapse the wall
        const d = Math.abs(sParam);
        if (d < bestD) {
          bestD = d;
          best = { x: round1(p.x + ux * sParam), y: round1(p.y + uy * sParam) };
        }
      }
      if (best) segs[i] = { ...s, [end]: best };
    }
  }

  // 4. drop tiny and duplicate walls
  const seen = new Set<string>();
  const out: Seg[] = [];
  for (const s of segs) {
    if (dist(s.a, s.b) < 6) continue;
    const k1 = `${s.a.x},${s.a.y}|${s.b.x},${s.b.y}`;
    const k2 = `${s.b.x},${s.b.y}|${s.a.x},${s.a.y}`;
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.add(k1);
    out.push(s);
  }
  return { walls: out, snapX, snapY };
}

function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A point inside the polygon for the room label (area centroid, or the widest span on the mid line). */
export function labelPointFor(poly: Point[]): Point {
  const A = polygonArea(poly);
  if (Math.abs(A) > 1e-6) {
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const f = p.x * q.y - q.x * p.y;
      cx += (p.x + q.x) * f;
      cy += (p.y + q.y) * f;
    }
    const c = { x: cx / (6 * A), y: cy / (6 * A) };
    if (pointInPolygon(c, poly)) return { x: round1(c.x), y: round1(c.y) };
  }
  const ys = poly.map((p) => p.y);
  const y = (Math.min(...ys) + Math.max(...ys)) / 2 + 0.01;
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((m, n) => m - n);
  let best = { x: poly[0].x, y };
  let bestW = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > bestW) {
      bestW = xs[i + 1] - xs[i];
      best = { x: (xs[i] + xs[i + 1]) / 2, y };
    }
  }
  return { x: round1(best.x), y: round1(best.y) };
}

export function floorMaterialFor(name: string): RoomEntity['floorMaterial'] {
  const n = name.toLowerCase();
  if (/bath|wc|toilet|powder|laundry|kitchen|mud|shower|entry|foyer|utility room/.test(n)) return 'tile';
  if (/garage|carport|mechanical|storage|shop|workshop/.test(n)) return 'concrete';
  if (/porch|deck|patio|terrace|veranda/.test(n)) return 'stone';
  return 'wood';
}

// ---------------------------------------------------------------------------------------------
// Type selection
// ---------------------------------------------------------------------------------------------

const DOOR_CANDIDATES: Record<Exclude<AiDoorKind, 'opening'>, string[]> = {
  single: ['dt-30x80', 'dt-32x80', 'dt-36x80'],
  double: ['dt-double-flush-60', 'dt-double-60x80'],
  sliding: ['dt-slide-72x80', 'dt-slide-96x80', 'dt-patio-3', 'dt-patio-4'],
  pocket: ['dt-pocket-30'],
  garage: ['dt-rollup-9x7', 'dt-garage-16x7'],
  barn: ['dt-barn-36', 'dt-barn-bypass-72'],
  bifold: ['dt-louver-bifold-48', 'dt-bifold-3', 'dt-bifold-4'],
};
const DEFAULT_DOOR_WIDTH: Record<AiDoorKind, number> = {
  single: 32, double: 60, sliding: 72, pocket: 30, garage: 192, barn: 36, bifold: 48, opening: 48,
};

export function pickDoorType(types: DoorType[], kind: AiDoorKind, width: number, exterior: boolean): DoorType | null {
  if (kind === 'opening') return null;
  const ids = DOOR_CANDIDATES[kind] ?? DOOR_CANDIDATES.single;
  let pool = types.filter((t) => ids.includes(t.id));
  if (kind === 'single' && exterior) {
    const wide = pool.filter((t) => t.width >= 36);
    if (wide.length) pool = wide;
  }
  if (!pool.length) pool = types.filter((t) => (t.kind || 'single') === (kind === 'pocket' ? 'pocket' : kind));
  if (!pool.length) pool = types.filter((t) => (t.kind || 'single') === 'single');
  if (!pool.length) return null;
  return pool.reduce((best, t) => (Math.abs(t.width - width) < Math.abs(best.width - width) ? t : best));
}

export function pickWindowType(types: WindowType[], width: number): WindowType | null {
  if (!types.length) return null;
  return types.reduce((best, t) => (Math.abs(t.width - width) < Math.abs(best.width - width) ? t : best));
}

// ---------------------------------------------------------------------------------------------
// Main conversion
// ---------------------------------------------------------------------------------------------

export interface AiPlanReport {
  walls: number;
  doors: number;
  windows: number;
  openings: number;
  rooms: number;
  width: number;  // inches, overall
  depth: number;  // inches, overall
  skipped: string[];
}

export interface BuildOptions {
  levelId: string;
  /** Top-left corner of the generated plan, in model inches. */
  origin: Point;
  idPrefix: string;
  /** Numbering continues after these (e.g. existing D3 → first new door is D4). */
  startMarks?: { door: number; window: number; room: number };
  /** keep the plan's own coordinates (traced plans land exactly on their image) */
  keepPosition?: boolean;
  /** round lines to this module in inches (default 6" imperial / none metric; 0 = off) */
  module?: number;
}

/** Converts a parsed AI plan into ARCHIFORMA entities using the model's own type catalogs. */
export function buildPlanEntities(plan: AiPlan, model: ArchModel, opts: BuildOptions): { entities: ArchEntity[]; report: AiPlanReport } {
  const k = UNIT_TO_IN[plan.unit ?? 'ft'];
  const sc = (v: number) => v * k;
  const skipped: string[] = [];

  const rawSegs: Seg[] = plan.walls.map((w) => ({ a: { x: sc(w.x1), y: sc(w.y1) }, b: { x: sc(w.x2), y: sc(w.y2) }, exterior: !!w.exterior }));
  const { walls: segs, snapX, snapY } = cleanWalls(rawSegs, opts.module ?? (plan.unit === 'm' ? 0 : 6));
  if (!segs.length) throw new Error('The AI plan had no usable walls.');

  // exterior detection fallback: walls on the bounding box
  const minX0 = Math.min(...segs.flatMap((s) => [s.a.x, s.b.x]));
  const minY0 = Math.min(...segs.flatMap((s) => [s.a.y, s.b.y]));
  const maxX0 = Math.max(...segs.flatMap((s) => [s.a.x, s.b.x]));
  const maxY0 = Math.max(...segs.flatMap((s) => [s.a.y, s.b.y]));
  if (!segs.some((s) => s.exterior)) {
    for (const s of segs) {
      const onEdge = (v1: number, v2: number, e: number) => Math.abs(v1 - e) < 1 && Math.abs(v2 - e) < 1;
      s.exterior = onEdge(s.a.x, s.b.x, minX0) || onEdge(s.a.x, s.b.x, maxX0) || onEdge(s.a.y, s.b.y, minY0) || onEdge(s.a.y, s.b.y, maxY0);
    }
  }

  // translate so the plan's top-left lands on the requested origin
  const dx = opts.keepPosition ? 0 : opts.origin.x - minX0;
  const dy = opts.keepPosition ? 0 : opts.origin.y - minY0;
  const tr = (p: Point): Point => ({ x: round1(p.x + dx), y: round1(p.y + dy) });

  const wallTypes: WallType[] = model.wallTypes ?? [];
  const extType = wallTypes.find((t) => t.id === 'wt-ext-2x6') ?? wallTypes[0];
  const intType = wallTypes.find((t) => t.id === 'wt-int-45') ?? extType;
  const thick = (t: WallType | undefined, fallback: number) => (t ? getWallTypeTotalThickness(t) || fallback : fallback);
  const level = (model.levels ?? []).find((l) => l.id === opts.levelId);

  const p = opts.idPrefix;
  const walls: WallEntity[] = segs.map((s, i) => {
    const t = s.exterior ? extType : intType;
    return {
      id: `${p}-wall-${i + 1}`,
      type: 'wall',
      layer: 'A-WALL',
      levelId: opts.levelId,
      wallTypeId: t?.id,
      start: tr(s.a),
      end: tr(s.b),
      thickness: thick(t, s.exterior ? 6 : 4.5),
      height: level?.floorToFloorHeight ?? t?.defaultHeight ?? 108,
      baseOffset: 0,
      justification: 'center',
      ...(s.exterior ? { exteriorSide: 'auto' as const } : {}),
    };
  });

  // ---- openings: host each on the nearest wall (in AI-space coordinates, then same wall ids)
  const placed = new Map<string, Array<[number, number]>>(); // wallId → occupied [start, end] along wall
  const host = (pt: Point, width: number, label: string): { wall: WallEntity; offset: number; width: number } | null => {
    let best: { i: number; t: number; d: number } | null = null;
    segs.forEach((s, i) => {
      const L2 = (s.b.x - s.a.x) ** 2 + (s.b.y - s.a.y) ** 2;
      if (!L2) return;
      const t = Math.max(0, Math.min(1, ((pt.x - s.a.x) * (s.b.x - s.a.x) + (pt.y - s.a.y) * (s.b.y - s.a.y)) / L2));
      const d = dist(pt, { x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) });
      if (!best || d < best.d) best = { i, t, d };
    });
    const b = best as { i: number; t: number; d: number } | null;
    if (!b || b.d > HOST_TOL) {
      skipped.push(`${label} was not on a wall`);
      return null;
    }
    const wall = walls[b.i];
    const L = dist(segs[b.i].a, segs[b.i].b);
    const w = Math.min(width, L - 2 * OPEN_MARGIN);
    if (w < 18) {
      skipped.push(`${label} did not fit its wall`);
      return null;
    }
    const lo = w / 2 + OPEN_MARGIN;
    const hi = L - w / 2 - OPEN_MARGIN;
    let c = Math.max(lo, Math.min(hi, b.t * L));
    const taken = placed.get(wall.id) ?? [];
    const clash = (cc: number) => taken.some(([s0, e0]) => cc - w / 2 < e0 + 4 && cc + w / 2 > s0 - 4);
    if (clash(c)) {
      // slide to the nearest free spot
      const candidates = taken.flatMap(([s0, e0]) => [e0 + 4 + w / 2, s0 - 4 - w / 2]).filter((cc) => cc >= lo && cc <= hi && !clash(cc));
      if (!candidates.length) {
        skipped.push(`${label} overlapped another opening`);
        return null;
      }
      c = candidates.reduce((m, cc) => (Math.abs(cc - c) < Math.abs(m - c) ? cc : m));
    }
    taken.push([c - w / 2, c + w / 2]);
    placed.set(wall.id, taken);
    return { wall, offset: Math.round((c / L) * 10000) / 10000, width: w };
  };

  const marks = opts.startMarks ?? { door: 0, window: 0, room: 0 };
  let doorN = marks.door;
  let winN = marks.window;
  let openN = 0;
  const openings: ArchEntity[] = [];
  const doorTypes = model.doorTypes ?? [];
  const windowTypes = model.windowTypes ?? [];

  // larger openings first so small ones slide around them, not the other way round
  const doorsIn = [...(plan.doors ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  for (const d of doorsIn) {
    const kind = d.kind ?? 'single';
    const wantW = d.width ? sc(d.width) : DEFAULT_DOOR_WIDTH[kind];
    if (kind === 'opening') {
      const h = host({ x: sc(d.x), y: sc(d.y) }, wantW, 'An opening');
      if (!h) continue;
      openN++;
      const wo: WallOpeningEntity = {
        id: `${p}-wo-${openN}`, type: 'wallopening', layer: 'A-WALL', levelId: opts.levelId,
        mark: `O${openN}`, wallId: h.wall.id, offset: h.offset, width: Math.round(h.width), height: 84, sillHeight: 0, shape: 'rect',
      };
      openings.push(wo);
      continue;
    }
    const exterior = d.exterior ?? false;
    const dt = pickDoorType(doorTypes, kind, wantW, exterior);
    const typeW = dt?.width ?? wantW;
    const h = host({ x: sc(d.x), y: sc(d.y) }, typeW, `A ${kind} door`);
    if (!h) continue;
    doorN++;
    const fields = dt ? doorTypeFields(dt) : { width: Math.round(h.width), height: 80 };
    const door: DoorEntity = {
      id: `${p}-door-${doorN}`, type: 'door', layer: 'A-DOOR', levelId: opts.levelId, mark: `D${doorN}`,
      wallId: h.wall.id, offset: h.offset, swing: 'left-in', depthPosition: exterior ? 'exterior' : 'center',
      width: 36, height: 80,
      ...(fields as Partial<DoorEntity>),
    };
    if (h.width < door.width) door.width = Math.round(h.width); // squeezed onto a short wall
    openings.push(door);
  }
  for (const wi of plan.windows ?? []) {
    const wantW = wi.width ? sc(wi.width) : 36;
    const wt = pickWindowType(windowTypes, wantW);
    const h = host({ x: sc(wi.x), y: sc(wi.y) }, wt?.width ?? wantW, 'A window');
    if (!h) continue;
    winN++;
    const fields = wt ? windowTypeFields(wt) : { width: Math.round(h.width), height: 48 };
    const win: WindowEntity = {
      id: `${p}-win-${winN}`, type: 'window', layer: 'A-GLAZ', levelId: opts.levelId, mark: `W${winN}`,
      wallId: h.wall.id, offset: h.offset, sillHeight: wt?.sillHeight ?? 36, depthPosition: 'center',
      width: 36, height: 48,
      ...(fields as Partial<WindowEntity>),
    };
    if (h.width < win.width) win.width = Math.round(h.width);
    openings.push(win);
  }

  // ---- rooms: snap vertices onto the same wall lines, then translate
  const rooms: RoomEntity[] = [];
  let roomN = marks.room;
  for (const r of plan.rooms ?? []) {
    let poly = r.polygon.map((q) => ({ x: snapX(sc(q.x)), y: snapY(sc(q.y)) }));
    poly = poly.filter((q, i) => i === 0 || q.x !== poly[i - 1].x || q.y !== poly[i - 1].y);
    if (poly.length > 1 && poly[0].x === poly[poly.length - 1].x && poly[0].y === poly[poly.length - 1].y) poly.pop();
    if (poly.length < 3 || Math.abs(polygonArea(poly)) < 9 * 144) {
      skipped.push(`Room "${r.name}" was too small to draw`);
      continue;
    }
    const moved = poly.map(tr);
    roomN++;
    rooms.push({
      id: `${p}-room-${roomN}`, type: 'room', layer: 'A-AREA', levelId: opts.levelId,
      mark: String(100 + roomN), name: r.name, wallIds: [], polygon: moved, labelPos: labelPointFor(moved),
      floorMaterial: floorMaterialFor(r.name),
    });
  }

  // ---- overall dimensions (top and left)
  const o = tr({ x: minX0, y: minY0 });
  const e = tr({ x: maxX0, y: maxY0 });
  const dims: DimensionEntity[] = [
    { id: `${p}-dim-w`, type: 'dimension', dimType: 'aligned', layer: 'A-ANNO', levelId: opts.levelId, p1: { x: o.x, y: o.y }, p2: { x: e.x, y: o.y }, offset: -36 },
    { id: `${p}-dim-d`, type: 'dimension', dimType: 'aligned', layer: 'A-ANNO', levelId: opts.levelId, p1: { x: o.x, y: e.y }, p2: { x: o.x, y: o.y }, offset: -36 },
  ];

  const doorsCount = openings.filter((x) => x.type === 'door').length;
  const winCount = openings.filter((x) => x.type === 'window').length;
  return {
    entities: [...walls, ...openings, ...rooms, ...dims],
    report: {
      walls: walls.length,
      doors: doorsCount,
      windows: winCount,
      openings: openN,
      rooms: rooms.length,
      width: e.x - o.x,
      depth: e.y - o.y,
      skipped,
    },
  };
}

export type ApplyMode = 'new' | 'replace' | 'beside';

const onLevel = (ent: ArchEntity, levelId: string) => (ent.levelId ?? 'level-1') === levelId;

/** True when the level already has walls (so the UI can offer Replace vs. Add beside). */
export function levelHasPlan(model: ArchModel, levelId: string): boolean {
  return model.entities.some((e) => e.type === 'wall' && onLevel(e, levelId));
}

/** True while the model is still the untouched starter house (then "New project" is the natural default). */
export function isStarterSample(model: ArchModel): boolean {
  const ids = new Set(model.entities.map((e) => e.id));
  return ['wall-n1', 'wall-mid', 'room-living', 'room-bedroom'].every((id) => ids.has(id));
}

/**
 * Adds the AI plan to the model.
 * - 'new'     starts a fresh project (same units) with the plan on Level 1.
 * - 'replace' removes everything on `levelId` first (other levels are kept) and builds at (0, 0).
 * - 'beside'  keeps everything and places the new plan 10'-0" to the right of what is there.
 */
export function applyAiPlan(
  model: ArchModel,
  plan: AiPlan,
  levelId: string,
  mode: ApplyMode,
  idPrefix: string,
  extra: { keepPosition?: boolean; module?: number } = {}
): { model: ArchModel; report: AiPlanReport; levelId: string } {
  if (mode === 'new') {
    const blank = createBlankProject();
    const fresh: ArchModel = { ...blank, projectName: model.projectName || blank.projectName, settings: { ...blank.settings, units: model.settings.units } };
    const lvl = fresh.levels?.[0]?.id ?? 'level-1';
    const r = applyAiPlan(fresh, plan, lvl, 'replace', idPrefix);
    return { ...r, model: { ...r.model, activeLevelId: lvl } };
  }
  let base = model.entities;
  if (mode === 'replace') base = base.filter((e) => !onLevel(e, levelId));
  let origin: Point = { x: 0, y: 0 };
  if (mode === 'beside') {
    const levelEnts = base.filter((e) => onLevel(e, levelId));
    if (levelEnts.length) {
      const ext = computeModelExtents(levelEnts);
      if (Number.isFinite(ext.maxX) && Number.isFinite(ext.minY)) origin = { x: Math.round(ext.maxX + 120), y: Math.round(ext.minY) };
    }
  }
  const countMarks = (type: string, prefix: string) =>
    base.reduce((m, e) => {
      if (e.type !== type) return m;
      const mk = (e as { mark?: string }).mark ?? '';
      const n = mk.startsWith(prefix) ? parseInt(mk.slice(prefix.length), 10) : NaN;
      return Number.isFinite(n) ? Math.max(m, n) : m;
    }, 0);
  const roomMax = base.reduce((m, e) => {
    if (e.type !== 'room') return m;
    const n = parseInt((e as RoomEntity).mark ?? '', 10);
    return Number.isFinite(n) && n > 100 ? Math.max(m, n - 100) : m;
  }, 0);
  const { entities, report } = buildPlanEntities(plan, { ...model, entities: base }, {
    levelId,
    origin,
    idPrefix,
    startMarks: { door: countMarks('door', 'D'), window: countMarks('window', 'W'), room: roomMax },
    ...extra,
  });
  return { model: { ...model, entities: [...base, ...entities] }, report, levelId };
}
