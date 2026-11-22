/**
 * ROOM BUILDER (pure): describe a room as a run of sides — each a length with windows, doors,
 * openings or open gaps along it, turning left or right at the corners — then drop it onto the
 * plan. Sides that run along existing walls reuse those walls (no doubled walls), so rooms placed
 * against each other share their walls, and openings on a shared side are cut into the existing wall.
 * Lengths are measured along wall centrelines; plan y grows down; a right turn is clockwise on screen.
 */
import type { ArchEntity, ArchModel, DoorEntity, Point, RoomEntity, WallEntity, WallOpeningEntity, WindowEntity, WallType } from '../types/model';
import { floorMaterialFor, labelPointFor, pickDoorType, pickWindowType } from './aiPlan';
import { getWallTypeTotalThickness } from './geometry';
import { doorTypeFields, windowTypeFields } from './openings';

export type FeatureKind = 'window' | 'door' | 'opening' | 'gap';

export interface SideFeature {
  id: string;
  kind: FeatureKind;
  width: number;          // inches
  /** centre of the feature measured from the start of the side (inches); null = centred */
  at: number | null;
}

export interface RoomSide {
  id: string;
  length: number;         // inches, along the wall centreline
  /** turn at the END of this side, degrees: 90 = right, -90 = left, 45 / -45, 0 = straight on */
  turn: number;
  features: SideFeature[];
}

export interface RoomSpec {
  name: string;
  sides: RoomSide[];
}

let seq = 0;
export const rbId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function newSide(length: number, turn = 90, features: SideFeature[] = []): RoomSide {
  return { id: rbId('side'), length, turn, features };
}
export function newFeature(kind: FeatureKind, width?: number, at: number | null = null): SideFeature {
  const w = width ?? (kind === 'window' ? 48 : kind === 'door' ? 36 : kind === 'opening' ? 48 : 72);
  return { id: rbId('feat'), kind, width: w, at };
}

/** W × D rectangle, clockwise from the top-left corner: top, right, bottom, left. */
export function rectangleSpec(name: string, width: number, depth: number): RoomSpec {
  return { name, sides: [newSide(width), newSide(depth), newSide(width), newSide(depth)] };
}

/** L-shaped room: overall W × D with a notch of notchW × notchD cut from the bottom-right corner. */
export function lShapeSpec(name: string, width: number, depth: number, notchW: number, notchD: number): RoomSpec {
  const lens = [width, depth - notchD, notchW, notchD, width - notchW, depth];
  const turns = [90, 90, -90, 90, 90, 90];
  return { name, sides: lens.map((l, i) => newSide(l, turns[i])) };
}

/** Corner points of the run, starting at (0,0) heading east (+x). corners[i] is the start of side i;
 *  corners[n] is where the last side ends (equal to (0,0) when the room closes). */
export function sideCorners(sides: RoomSide[]): Point[] {
  const pts: Point[] = [{ x: 0, y: 0 }];
  let heading = 0;
  let p = { x: 0, y: 0 };
  for (const s of sides) {
    const r = (heading * Math.PI) / 180;
    p = { x: p.x + Math.cos(r) * s.length, y: p.y + Math.sin(r) * s.length };
    pts.push({ x: round3(p.x), y: round3(p.y) });
    heading += s.turn;
  }
  return pts;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** How far the end of the last side misses the start (0 = closed). */
export function closureGap(sides: RoomSide[]): number {
  const c = sideCorners(sides);
  const e = c[c.length - 1];
  return Math.hypot(e.x, e.y);
}

/**
 * Makes the run close: when the last side already points at the start it is resized, otherwise a
 * closing side is added. Returns null when it cannot be closed with a straight side.
 */
export function autoClose(spec: RoomSpec): RoomSpec | null {
  const sides = spec.sides;
  if (sides.length < 2) return null;
  if (closureGap(sides) < 0.5) return spec;
  const c = sideCorners(sides);
  const start = c[sides.length - 1];
  const end = c[sides.length];
  const lastDir = { x: end.x - start.x, y: end.y - start.y };
  const toOrigin = { x: -start.x, y: -start.y };
  const len = Math.hypot(toOrigin.x, toOrigin.y);
  const L = Math.hypot(lastDir.x, lastDir.y);
  if (L > 1e-6 && len > 1e-6) {
    const cross = lastDir.x * toOrigin.y - lastDir.y * toOrigin.x;
    const dot = lastDir.x * toOrigin.x + lastDir.y * toOrigin.y;
    if (Math.abs(cross) / (L * len) < 1e-3 && dot > 0) {
      const next = sides.map((s, i) => (i === sides.length - 1 ? { ...s, length: Math.round(len * 100) / 100 } : s));
      return { ...spec, sides: next };
    }
  }
  // add a closing side from the current end straight back to the start
  const gapVec = { x: -end.x, y: -end.y };
  const gapLen = Math.hypot(gapVec.x, gapVec.y);
  const lastHeading = sides.reduce((h, s) => h + s.turn, 0) - sides[sides.length - 1].turn;
  const want = (Math.atan2(gapVec.y, gapVec.x) * 180) / Math.PI;
  const turn = ((((want - lastHeading) % 360) + 540) % 360) - 180;
  const next = sides.map((s, i) => (i === sides.length - 1 ? { ...s, turn: Math.round(turn * 100) / 100 } : s));
  return { ...spec, sides: [...next, newSide(Math.round(gapLen * 100) / 100, 0)] };
}

/** Signed area (>0 = clockwise on screen, y down). */
function signedArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export interface Placement {
  at: Point;            // world point where the anchor corner goes
  anchor: number;       // corner index 0..n-1
  rotation: number;     // degrees, clockwise on screen
}

/** World corners of the room for a placement (n corners, closed polygon). */
export function placedCorners(spec: RoomSpec, pl: Placement): Point[] {
  const local = sideCorners(spec.sides).slice(0, spec.sides.length);
  if (!local.length) return [];
  const a = local[Math.min(Math.max(0, pl.anchor), local.length - 1)];
  const r = (pl.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return local.map((p) => {
    const x = p.x - a.x;
    const y = p.y - a.y;
    return { x: round3(pl.at.x + x * cos - y * sin), y: round3(pl.at.y + x * sin + y * cos) };
  });
}

// ---------------------------------------------------------------------------------------------
// Building the entities
// ---------------------------------------------------------------------------------------------

export interface BuildRoomOptions {
  levelId: string;
  wallType?: WallType;
  idPrefix: string;
  /** height for new walls; defaults to the level's floor-to-floor or 108" */
  wallHeight?: number;
}

export interface BuildRoomResult {
  entities: ArchEntity[];        // new walls, openings, room
  /** openings counts only the ones the user asked for; cutGaps = gaps cut into existing walls */
  report: { newWalls: number; sharedSides: number; doors: number; windows: number; openings: number; gaps: number; cutGaps: number; skipped: string[] };
}

const PAR_TOL = 1.0;     // inches off the line still counts as the same wall line
const OPEN_MARGIN = 2;   // inches kept clear at wall ends

type Interval = [number, number];
const subtract = (ivs: Interval[], cut: Interval): Interval[] =>
  ivs.flatMap(([a, b]) => {
    const [c, d] = cut;
    if (d <= a || c >= b) return [[a, b] as Interval];
    const out: Interval[] = [];
    if (c > a) out.push([a, c]);
    if (d < b) out.push([d, b]);
    return out;
  });

/** Existing walls lying along the segment a→b: their [t0, t1] range along it (inches). */
function collinearCover(walls: WallEntity[], a: Point, b: Point): Array<{ wall: WallEntity; range: Interval }> {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 1e-6) return [];
  const ux = (b.x - a.x) / L;
  const uy = (b.y - a.y) / L;
  const out: Array<{ wall: WallEntity; range: Interval }> = [];
  for (const w of walls) {
    const wl = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    if (wl < 1e-6) continue;
    const wx = (w.end.x - w.start.x) / wl;
    const wy = (w.end.y - w.start.y) / wl;
    if (Math.abs(ux * wy - uy * wx) > 0.002) continue; // not parallel
    const off = (p: Point) => Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
    if (off(w.start) > PAR_TOL || off(w.end) > PAR_TOL) continue;
    const t0 = (w.start.x - a.x) * ux + (w.start.y - a.y) * uy;
    const t1 = (w.end.x - a.x) * ux + (w.end.y - a.y) * uy;
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(L, Math.max(t0, t1));
    if (hi - lo > 0.5) out.push({ wall: w, range: [lo, hi] });
  }
  return out;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Builds the walls, openings and room for a placed room spec. Pure: returns new entities only. */
export function buildRoom(model: ArchModel, spec: RoomSpec, pl: Placement, opts: BuildRoomOptions): BuildRoomResult {
  const skipped: string[] = [];
  const n = spec.sides.length;
  const corners = placedCorners(spec, pl);
  if (n < 3 || corners.length < 3) throw new Error('A room needs at least 3 sides.');
  if (closureGap(spec.sides) > 0.5) throw new Error('The sides do not close — use "Close room" first.');
  const cw = signedArea(corners) > 0;
  if (Math.abs(signedArea(corners)) < 144) throw new Error('That room has no floor area.');

  const levelWalls = model.entities.filter((e): e is WallEntity => e.type === 'wall' && (e.levelId ?? 'level-1') === opts.levelId);
  const level = (model.levels ?? []).find((l) => l.id === opts.levelId);
  const wt = opts.wallType ?? (model.wallTypes ?? [])[0];
  const thickness = wt ? getWallTypeTotalThickness(wt) || 4.5 : 4.5;
  const height = opts.wallHeight ?? level?.floorToFloorHeight ?? wt?.defaultHeight ?? 108;
  const p = opts.idPrefix;

  const newWalls: WallEntity[] = [];
  const openings: ArchEntity[] = [];
  let sharedSides = 0;
  let doorN = 0, winN = 0, openN = 0, gapN = 0, cutGaps = 0;
  // continue marks after the existing ones (D3 → D4)
  const maxMark = (type: string, prefix: string) =>
    model.entities.reduce((m, e) => {
      if (e.type !== type) return m;
      const mk = (e as { mark?: string }).mark ?? '';
      const k = mk.startsWith(prefix) ? parseInt(mk.slice(prefix.length), 10) : NaN;
      return Number.isFinite(k) ? Math.max(m, k) : m;
    }, 0);
  let dMark = maxMark('door', 'D');
  let wMark = maxMark('window', 'W');
  let oMark = maxMark('wallopening', 'O');

  for (let i = 0; i < n; i++) {
    const side = spec.sides[i];
    const a = corners[i];
    const b = corners[(i + 1) % n];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1) continue;
    const ux = (b.x - a.x) / L;
    const uy = (b.y - a.y) / L;
    const at = (t: number): Point => ({ x: r1(a.x + ux * t), y: r1(a.y + uy * t) });
    // room interior side of this wall line
    const inN = cw ? { x: -uy, y: ux } : { x: uy, y: -ux };

    // features with resolved centres, clamped onto the side
    const feats = side.features.map((f) => {
      const w = Math.min(f.width, Math.max(0, L - 2 * OPEN_MARGIN));
      const c = f.at === null ? L / 2 : Math.min(Math.max(f.at, w / 2 + OPEN_MARGIN), L - w / 2 - OPEN_MARGIN);
      return { f, w, c, lo: c - w / 2, hi: c + w / 2 };
    });

    // 1) solid wall intervals: the side minus gaps
    let solid: Interval[] = [[0, L]];
    for (const g of feats.filter((x) => x.f.kind === 'gap')) {
      solid = subtract(solid, [Math.max(0, g.lo), Math.min(L, g.hi)]);
      gapN++;
    }
    // 2) minus stretches already covered by existing walls on the same line
    const cover = collinearCover(levelWalls, a, b);
    let fresh = solid;
    for (const cv of cover) fresh = subtract(fresh, cv.range);
    if (cover.length) sharedSides++;
    const sideNew: Array<{ wall: WallEntity; range: Interval }> = [];
    fresh
      .filter(([s, e]) => e - s >= 1)
      .forEach(([s, e], k) => {
        const wall: WallEntity = {
          id: `${p}-w${i + 1}${k ? `-${k}` : ''}`,
          type: 'wall',
          layer: 'A-WALL',
          levelId: opts.levelId,
          wallTypeId: wt?.id,
          start: at(s),
          end: at(e),
          thickness,
          height,
          baseOffset: 0,
          justification: 'center',
        };
        newWalls.push(wall);
        sideNew.push({ wall, range: [s, e] });
      });

    // openings already in the existing walls along this side (in this side's coordinates)
    const coverIds = new Set(cover.map((cv) => cv.wall.id));
    const taken: Array<{ range: Interval; mark: string }> = model.entities
      .filter((e) => (e.type === 'door' || e.type === 'window' || e.type === 'wallopening') && coverIds.has((e as { wallId: string }).wallId))
      .map((e) => {
        const o = e as unknown as { wallId: string; offset: number; width: number; mark?: string };
        const w = cover.find((cv) => cv.wall.id === o.wallId)!.wall;
        const cx = w.start.x + (w.end.x - w.start.x) * o.offset;
        const cy = w.start.y + (w.end.y - w.start.y) * o.offset;
        const t = (cx - a.x) * ux + (cy - a.y) * uy;
        return { range: [t - o.width / 2, t + o.width / 2] as Interval, mark: o.mark || 'an opening' };
      });
    const clashWith = (lo: number, hi: number) => taken.find((o) => lo < o.range[1] + 2 && hi > o.range[0] - 2);

    // 2b) a gap along an existing wall opens it up: a full-height opening is cut into that wall
    for (const g of feats.filter((x) => x.f.kind === 'gap')) {
      let narrow = false;
      let cutHere = 0;
      for (const cv of cover) {
        const lo = Math.max(g.lo, cv.range[0] + OPEN_MARGIN);
        const hi = Math.min(g.hi, cv.range[1] - OPEN_MARGIN);
        if (hi - lo <= 0) continue;
        if (hi - lo < 18) {
          narrow = true; // a sliver past a wall junction — fine if the rest of the gap was cut
          continue;
        }
        const clash = clashWith(lo, hi);
        if (clash) {
          skipped.push(`the gap on side ${i + 1} would cut through ${clash.mark} in the existing wall`);
          continue;
        }
        const hw = cv.wall;
        const hl = Math.hypot(hw.end.x - hw.start.x, hw.end.y - hw.start.y);
        const centre = at((lo + hi) / 2);
        const offset = Math.round((((centre.x - hw.start.x) * (hw.end.x - hw.start.x) + (centre.y - hw.start.y) * (hw.end.y - hw.start.y)) / (hl * hl)) * 10000) / 10000;
        openN++;
        oMark++;
        cutGaps++;
        cutHere++;
        openings.push({
          id: `${p}-o${openN}`, type: 'wallopening', layer: 'A-WALL', levelId: opts.levelId, mark: `O${oMark}`,
          wallId: hw.id, offset, width: Math.round(hi - lo), height: hw.height, sillHeight: 0, shape: 'rect',
        } as WallOpeningEntity);
      }
      if (narrow && !cutHere) skipped.push(`the gap on side ${i + 1} was too narrow to cut into the existing wall`);
    }

    // 3) host windows / doors / openings on whichever wall (new or existing) holds them
    const hosts = [...sideNew, ...cover];
    for (const x of feats) {
      if (x.f.kind === 'gap') continue;
      const label = x.f.kind === 'window' ? 'A window' : x.f.kind === 'door' ? 'A door' : 'An opening';
      if (x.w < 18) {
        skipped.push(`${label} on side ${i + 1} did not fit`);
        continue;
      }
      const host = hosts.find((hh) => x.lo >= hh.range[0] - 0.5 && x.hi <= hh.range[1] + 0.5);
      if (!host) {
        skipped.push(`${label} on side ${i + 1} straddles a wall end or a gap`);
        continue;
      }
      const clash = cover.includes(host as { wall: WallEntity; range: Interval }) ? clashWith(x.lo, x.hi) : undefined;
      if (clash) {
        skipped.push(`${label.toLowerCase()} on side ${i + 1} overlaps ${clash.mark} in the existing wall`);
        continue;
      }
      const hw = host.wall;
      const hl = Math.hypot(hw.end.x - hw.start.x, hw.end.y - hw.start.y);
      const centre = at(x.c);
      const offset = Math.round((((centre.x - hw.start.x) * (hw.end.x - hw.start.x) + (centre.y - hw.start.y) * (hw.end.y - hw.start.y)) / (hl * hl)) * 10000) / 10000;
      // does the host's left normal point into this room? (door swing / window inside face)
      const hn = { x: -(hw.end.y - hw.start.y) / hl, y: (hw.end.x - hw.start.x) / hl };
      const inward = hn.x * inN.x + hn.y * inN.y > 0;
      if (x.f.kind === 'door') {
        const dt = pickDoorType(model.doorTypes ?? [], 'single', x.w, false);
        doorN++;
        dMark++;
        const fields = dt ? doorTypeFields(dt) : {};
        const d: DoorEntity = {
          id: `${p}-d${doorN}`, type: 'door', layer: 'A-DOOR', levelId: opts.levelId, mark: `D${dMark}`,
          wallId: hw.id, offset, swing: inward ? 'left-in' : 'left-out', depthPosition: 'center',
          width: Math.round(x.w), height: 80,
          ...(fields as Partial<DoorEntity>),
        };
        d.width = Math.round(x.w); // the size the user typed wins over the catalogue size
        openings.push(d);
      } else if (x.f.kind === 'window') {
        const wtp = pickWindowType(model.windowTypes ?? [], x.w);
        winN++;
        wMark++;
        const fields = wtp ? windowTypeFields(wtp) : {};
        const w: WindowEntity = {
          id: `${p}-win${winN}`, type: 'window', layer: 'A-GLAZ', levelId: opts.levelId, mark: `W${wMark}`,
          wallId: hw.id, offset, sillHeight: wtp?.sillHeight ?? 36, depthPosition: 'center',
          width: Math.round(x.w), height: 48,
          ...(fields as Partial<WindowEntity>),
        };
        w.width = Math.round(x.w);
        openings.push(w);
      } else {
        openN++;
        oMark++;
        const o: WallOpeningEntity = {
          id: `${p}-o${openN}`, type: 'wallopening', layer: 'A-WALL', levelId: opts.levelId, mark: `O${oMark}`,
          wallId: hw.id, offset, width: Math.round(x.w), height: 84, sillHeight: 0, shape: 'rect',
        };
        openings.push(o);
      }
    }
  }

  const roomMarks = model.entities.reduce((m, e) => {
    if (e.type !== 'room') return m;
    const k = parseInt((e as RoomEntity).mark ?? '', 10);
    return Number.isFinite(k) ? Math.max(m, k) : m;
  }, 100);
  const polygon = corners.map((c) => ({ x: r1(c.x), y: r1(c.y) }));
  const room: RoomEntity = {
    id: `${p}-room`, type: 'room', layer: 'A-AREA', levelId: opts.levelId, mark: String(roomMarks + 1),
    name: spec.name.trim() || 'Room', wallIds: [], polygon, labelPos: labelPointFor(polygon), floorMaterial: floorMaterialFor(spec.name),
  };

  return {
    entities: [...newWalls, ...openings, room],
    report: {
      newWalls: newWalls.length,
      sharedSides,
      doors: doorN,
      windows: winN,
      openings: openN - cutGaps,
      gaps: gapN,
      cutGaps,
      skipped,
    },
  };
}

/** Room corners and wall ends on the level: the "connection points" a room snaps to. */
export function connectionPoints(model: ArchModel, levelId: string): Point[] {
  const pts: Point[] = [];
  for (const e of model.entities) {
    if ((e.levelId ?? 'level-1') !== levelId) continue;
    if (e.type === 'wall') pts.push(e.start, e.end);
    else if (e.type === 'room') pts.push(...e.polygon);
  }
  const seen = new Set<string>();
  return pts.filter((q) => {
    const k = `${Math.round(q.x * 2)},${Math.round(q.y * 2)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Snaps the anchor (or, failing that, any corner of the room) onto the nearest connection point. */
export function snapPlacement(spec: RoomSpec, pl: Placement, points: Point[], tol: number): { placement: Placement; snapped: boolean } {
  if (!points.length) return { placement: pl, snapped: false };
  const corners = placedCorners(spec, pl);
  let best: { d: number; dx: number; dy: number } | null = null;
  corners.forEach((c, i) => {
    for (const q of points) {
      const d = Math.hypot(q.x - c.x, q.y - c.y) * (i === pl.anchor ? 0.6 : 1); // prefer the anchor corner
      if (d <= tol && (!best || d < best.d)) best = { d, dx: q.x - c.x, dy: q.y - c.y };
    }
  });
  const b = best as { d: number; dx: number; dy: number } | null;
  if (!b) return { placement: pl, snapped: false };
  return { placement: { ...pl, at: { x: pl.at.x + b.dx, y: pl.at.y + b.dy } }, snapped: true };
}
