/**
 * AUTOMATIC TRACING: the AI reads a placed (and scaled) trace image and returns walls, openings
 * and rooms in image coordinates (0–1000 across and down). Walls are then snapped onto the dark
 * lines of the image itself, and everything is converted to drawing inches through the trace
 * image's placement, so the result lands exactly on top of the scan at true size.
 */
import type { Point, TraceImage } from '../types/model';
import type { AiPlan } from './aiPlan';
import { traceHeight } from './traceImage';

export interface TraceWall { x1: number; y1: number; x2: number; y2: number; exterior?: boolean }
export interface TraceOpening { kind: 'door' | 'window' | 'opening'; x1: number; y1: number; x2: number; y2: number; double?: boolean }
export interface TraceRoom { name: string; polygon: Point[] }
export interface TraceDimension { x1: number; y1: number; x2: number; y2: number; text: string }

export interface TraceResult {
  walls: TraceWall[];
  openings: TraceOpening[];
  rooms: TraceRoom[];
  /** one dimension the AI could read, for setting the scale of an uncalibrated image */
  dimension?: TraceDimension | null;
  notes?: string[];
}

const N = { type: 'number', minimum: 0, maximum: 1000 } as const;
const PT = { type: 'object', properties: { x: N, y: N }, required: ['x', 'y'] } as const;

export const TRACE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    walls: {
      type: 'array',
      items: { type: 'object', properties: { x1: N, y1: N, x2: N, y2: N, exterior: { type: 'boolean' } }, required: ['x1', 'y1', 'x2', 'y2'] },
    },
    openings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['door', 'window', 'opening'] }, x1: N, y1: N, x2: N, y2: N, double: { type: 'boolean' } },
        required: ['kind', 'x1', 'y1', 'x2', 'y2'],
      },
    },
    rooms: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, polygon: { type: 'array', items: PT } }, required: ['name', 'polygon'] },
    },
    dimension: {
      type: 'object',
      properties: { x1: N, y1: N, x2: N, y2: N, text: { type: 'string' } },
      required: ['x1', 'y1', 'x2', 'y2', 'text'],
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['walls', 'openings', 'rooms'],
};

export const TRACE_INSTRUCTIONS = [
  'You trace architectural floor plans from images into vector data for a CAD program.',
  'Coordinates: x = 0 at the left edge of the image to 1000 at the right edge; y = 0 at the top edge to 1000 at the bottom edge (each axis scaled to its own side).',
  'WALLS: one straight segment per wall run along the CENTRE of the drawn wall (the middle of the thick / filled band). Continue a wall through door and window openings (do not break it at openings). Join walls at corners exactly (same end point). Mark walls on the outside of the building exterior: true. Ignore furniture, fixtures, dimension lines, grid lines, text, hatching and title blocks.',
  'OPENINGS: for every door, window and open passage give its two jamb points ON the wall centre line (x1,y1 = one side of the opening, x2,y2 = the other side). kind: door (has a swing arc or door leaf), window (thin parallel lines in the wall), opening (gap without door). double: true for double / French doors.',
  'ROOMS: each enclosed space with its name from the label in the image (or a sensible name), polygon along the wall centre lines.',
  'DIMENSION: if a dimension with a readable value is visible (e.g. 12\'-6", 3600, 3.6 m), give its two end points and its text exactly as written; else omit it.',
  'Be precise: measure positions carefully against the image edges. Straight walls should be exactly horizontal or vertical when they look so.',
].join('\n');

/** Parses and cleans the AI's answer (drops degenerate items, clamps to the image). */
export function parseTraceResult(raw: unknown): TraceResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1000, Math.max(0, v)) : NaN);
  const seg = (v: Record<string, unknown>) => ({ x1: num(v.x1), y1: num(v.y1), x2: num(v.x2), y2: num(v.y2) });
  const ok = (s: { x1: number; y1: number; x2: number; y2: number }) => [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite) && Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 2;
  const walls = (Array.isArray(o.walls) ? o.walls : [])
    .map((w) => ({ ...seg(w as Record<string, unknown>), exterior: !!(w as Record<string, unknown>).exterior }))
    .filter(ok);
  const openings = (Array.isArray(o.openings) ? o.openings : [])
    .map((w) => {
      const r = w as Record<string, unknown>;
      const kind = r.kind === 'window' || r.kind === 'opening' ? r.kind : 'door';
      return { kind, ...seg(r), double: !!r.double } as TraceOpening;
    })
    .filter(ok);
  const rooms = (Array.isArray(o.rooms) ? o.rooms : [])
    .map((r) => {
      const rr = r as Record<string, unknown>;
      const polygon = (Array.isArray(rr.polygon) ? rr.polygon : [])
        .map((p) => ({ x: num((p as Record<string, unknown>).x), y: num((p as Record<string, unknown>).y) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      return { name: String(rr.name ?? 'Room').slice(0, 60) || 'Room', polygon };
    })
    .filter((r) => r.polygon.length >= 3);
  const d = o.dimension as Record<string, unknown> | undefined;
  const dimension = d && typeof d.text === 'string' && ok(seg(d)) ? { ...seg(d), text: d.text } : null;
  const notes = Array.isArray(o.notes) ? o.notes.filter((n): n is string => typeof n === 'string').slice(0, 8) : [];
  return { walls, openings, rooms, dimension, notes };
}

// ---------------------------------------------------------------------------------------------
// Snap walls onto the image's dark lines
// ---------------------------------------------------------------------------------------------
export interface GrayImage {
  width: number;
  height: number;
  /** darkness 0 (white) … 255 (black), row-major */
  dark: Uint8Array;
}

const sampleDark = (img: GrayImage, x: number, y: number) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return 0;
  return img.dark[yi * img.width + xi];
};

/** Mean darkness along a pixel segment (middle 80 %, skipping corners). */
function lineDarkness(img: GrayImage, a: Point, b: Point): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(8, Math.min(200, Math.round(len / 2)));
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const t = 0.1 + (0.8 * i) / n;
    sum += sampleDark(img, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }
  return sum / (n + 1);
}

export interface RefinedWall extends TraceWall {
  /** drawn wall thickness found in the image, in 0–1000 units across the image (0 = not found) */
  thickness: number;
  moved: number;
}

/**
 * Straightens near-horizontal / near-vertical walls, then slides each wall sideways (up to
 * `searchPct` of the image) to the centre of the darkest band under it and measures its width.
 */
export function refineWallsToImage(walls: TraceWall[], img: GrayImage, searchPct = 2.5): RefinedWall[] {
  const sx = img.width / 1000;
  const sy = img.height / 1000;
  const R = Math.max(3, Math.round((Math.max(img.width, img.height) * searchPct) / 100));
  return walls.map((w) => {
    let a = { x: w.x1 * sx, y: w.y1 * sy };
    let b = { x: w.x2 * sx, y: w.y2 * sy };
    const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const near = (t: number) => Math.abs(((ang - t + 540) % 360) - 180) < 4;
    if (near(0) || near(180)) {
      const y = (a.y + b.y) / 2;
      a = { x: a.x, y };
      b = { x: b.x, y };
    } else if (near(90) || near(-90)) {
      const x = (a.x + b.x) / 2;
      a = { x, y: a.y };
      b = { x, y: b.y };
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const profile: number[] = [];
    for (let d = -R; d <= R; d++) profile.push(lineDarkness(img, { x: a.x + nx * d, y: a.y + ny * d }, { x: b.x + nx * d, y: b.y + ny * d }));
    // strongest dark line, preferring ones close to where the AI put the wall (0.6 darkness per px)
    let iPeak = R;
    for (let i = 0; i < profile.length; i++) if (profile[i] - 0.6 * Math.abs(i - R) > profile[iPeak] - 0.6 * Math.abs(iPeak - R)) iPeak = i;
    const peak = profile[iPeak];
    const base = profile[R];
    let best = R;
    let thickness = 0;
    if (peak > 60 && peak > base + 8) {
      // the dark band = consecutive offsets above 60 % of the peak around the strongest one
      let lo = iPeak;
      let hi = iPeak;
      while (lo > 0 && profile[lo - 1] >= peak * 0.6) lo--;
      while (hi < profile.length - 1 && profile[hi + 1] >= peak * 0.6) hi++;
      best = Math.round((lo + hi) / 2);
      thickness = hi - lo + 1;
    } else if (base > 60) {
      let lo = R;
      let hi = R;
      while (lo > 0 && profile[lo - 1] >= base * 0.6) lo--;
      while (hi < profile.length - 1 && profile[hi + 1] >= base * 0.6) hi++;
      thickness = hi - lo + 1;
    }
    const d = best - R;
    return {
      x1: (a.x + nx * d) / sx,
      y1: (a.y + ny * d) / sy,
      x2: (b.x + nx * d) / sx,
      y2: (b.y + ny * d) / sy,
      exterior: w.exterior,
      thickness: (thickness / Math.max(img.width, img.height)) * 1000,
      moved: Math.abs(d),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Image coordinates → drawing inches
// ---------------------------------------------------------------------------------------------
export function imageToWorld(t: TraceImage, x: number, y: number): Point {
  return { x: t.x + (x / 1000) * t.width, y: t.y + (y / 1000) * traceHeight(t) };
}

/** Builds an AI plan (inches, absolute drawing coordinates) from a traced result. */
export function traceToPlan(res: { walls: TraceWall[]; openings: TraceOpening[]; rooms: TraceRoom[] }, t: TraceImage): AiPlan {
  const W = (x: number, y: number) => imageToWorld(t, x, y);
  const walls = res.walls.map((w) => {
    const a = W(w.x1, w.y1);
    const b = W(w.x2, w.y2);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, exterior: !!w.exterior };
  });
  const doors: NonNullable<AiPlan['doors']> = [];
  const windows: NonNullable<AiPlan['windows']> = [];
  for (const o of res.openings) {
    const a = W(o.x1, o.y1);
    const b = W(o.x2, o.y2);
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const width = Math.hypot(b.x - a.x, b.y - a.y);
    if (width < 12) continue;
    if (o.kind === 'window') windows.push({ x: c.x, y: c.y, width });
    else doors.push({ x: c.x, y: c.y, width, kind: o.kind === 'opening' ? 'opening' : o.double ? 'double' : 'single' });
  }
  const rooms = res.rooms.map((r) => ({ name: r.name, polygon: r.polygon.map((p) => W(p.x, p.y)) }));
  return { unit: 'in', walls, doors, windows, rooms, summary: 'Traced from image' };
}

/** Parses a dimension string like 12'-6", 12' 6", 150", 3600, 3600 mm, 3.6 m, 3,600. Returns inches. */
export function parseDimensionText(text: string, units: 'imperial' | 'metric'): number | null {
  const s = text.trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"').replace(/,/g, '');
  let m = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:(\d+)\/(\d+))?\s*"?$/.exec(s);
  if (m) return parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0) + (m[3] && m[4] ? parseInt(m[3], 10) / parseInt(m[4], 10) : 0);
  m = /^(\d+(?:\.\d+)?)\s*"$/.exec(s);
  if (m) return parseFloat(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*(mm|cm|m)?$/i.exec(s);
  if (m) {
    const v = parseFloat(m[1]);
    const u = (m[2] || '').toLowerCase();
    if (u === 'm') return (v * 1000) / 25.4;
    if (u === 'cm') return (v * 10) / 25.4;
    if (u === 'mm') return v / 25.4;
    // bare number: metric drawings are dimensioned in mm; imperial in inches
    return units === 'metric' ? v / 25.4 : v;
  }
  return null;
}

/** Decodes a data URL into a darkness map (max 1600 px on the long side, for speed). */
export async function loadGrayImage(src: string, maxPx = 1600): Promise<GrayImage> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Could not read the trace image.'));
    el.src = src;
  });
  const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot read images (no canvas).');
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dark[i] = 255 - Math.round(0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]);
  return { width: w, height: h, dark };
}
