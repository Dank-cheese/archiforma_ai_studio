/**
 * LINETYPES & LINEWEIGHTS (pure): the standard AutoCAD acad.lin set, ByLayer resolution of an
 * object's color / linetype / lineweight, dash patterns for drawing and plotting, and a .lin parser.
 */
import type { ArchEntity, ArchModel, Layer, LineTypeDef } from '../types/model';

export const CONTINUOUS = 'Continuous';
export const BYLAYER = 'ByLayer';
export const DEFAULT_LTSCALE = 12;
/** "Default" lineweight in mm (AutoCAD LWDEFAULT) */
export const DEFAULT_LINEWEIGHT = 0.25;
/** AutoCAD's standard lineweights (mm) */
export const LINEWEIGHTS_MM = [0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11];

const lt = (name: string, description: string, pattern: number[]): LineTypeDef => ({ name, description, pattern });

/** The standard simple linetypes of acad.lin (inches). */
export const STANDARD_LINETYPES: LineTypeDef[] = [
  lt(CONTINUOUS, 'Solid line ________________________', []),
  lt('BORDER', 'Border __ __ . __ __ . __ __ . __ __ .', [0.5, -0.25, 0.5, -0.25, 0, -0.25]),
  lt('BORDER2', 'Border (.5x) __.__.__.__.__.__.__.', [0.25, -0.125, 0.25, -0.125, 0, -0.125]),
  lt('BORDERX2', 'Border (2x) ____  ____  .  ____  ____  .', [1, -0.5, 1, -0.5, 0, -0.5]),
  lt('CENTER', 'Center ____ _ ____ _ ____ _ ____', [1.25, -0.25, 0.25, -0.25]),
  lt('CENTER2', 'Center (.5x) ___ _ ___ _ ___ _ ___', [0.75, -0.125, 0.125, -0.125]),
  lt('CENTERX2', 'Center (2x) ________  __  ________', [2.5, -0.5, 0.5, -0.5]),
  lt('DASHDOT', 'Dash dot __ . __ . __ . __ . __ .', [0.5, -0.25, 0, -0.25]),
  lt('DASHDOT2', 'Dash dot (.5x) _._._._._._._._._.', [0.25, -0.125, 0, -0.125]),
  lt('DASHDOTX2', 'Dash dot (2x) ____  .  ____  .  ____', [1, -0.5, 0, -0.5]),
  lt('DASHED', 'Dashed __ __ __ __ __ __ __ __ __', [0.5, -0.25]),
  lt('DASHED2', 'Dashed (.5x) _ _ _ _ _ _ _ _ _ _ _', [0.25, -0.125]),
  lt('DASHEDX2', 'Dashed (2x) ____  ____  ____  ____', [1, -0.5]),
  lt('DIVIDE', 'Divide ____ . . ____ . . ____ . .', [0.5, -0.25, 0, -0.25, 0, -0.25]),
  lt('DIVIDE2', 'Divide (.5x) __..__..__..__..__..', [0.25, -0.125, 0, -0.125, 0, -0.125]),
  lt('DIVIDEX2', 'Divide (2x) ________  .  .  ________', [1, -0.5, 0, -0.5, 0, -0.5]),
  lt('DOT', 'Dot . . . . . . . . . . . . . . . .', [0, -0.25]),
  lt('DOT2', 'Dot (.5x) ...............................', [0, -0.125]),
  lt('DOTX2', 'Dot (2x) .  .  .  .  .  .  .  .', [0, -0.5]),
  lt('HIDDEN', 'Hidden __ __ __ __ __ __ __ __', [0.25, -0.125]),
  lt('HIDDEN2', 'Hidden (.5x) _ _ _ _ _ _ _ _ _ _ _ _', [0.125, -0.0625]),
  lt('HIDDENX2', 'Hidden (2x) ____ ____ ____ ____', [0.5, -0.25]),
  lt('PHANTOM', 'Phantom ______  __  __  ______  __  __', [1.25, -0.25, 0.25, -0.25, 0.25, -0.25]),
  lt('PHANTOM2', 'Phantom (.5x) ___ _ _ ___ _ _ ___', [0.625, -0.125, 0.125, -0.125, 0.125, -0.125]),
  lt('PHANTOMX2', 'Phantom (2x) ____________    ____    ____', [2.5, -0.5, 0.5, -0.5, 0.5, -0.5]),
];

const norm = (n: string) => n.trim().toUpperCase();

/** Standard + project linetypes (project ones override a standard one with the same name). */
export function allLineTypes(model: Pick<ArchModel, 'lineTypes'>): LineTypeDef[] {
  const custom = model.lineTypes ?? [];
  const names = new Set(custom.map((l) => norm(l.name)));
  return [...STANDARD_LINETYPES.filter((l) => !names.has(norm(l.name))), ...custom];
}

export function findLineType(model: Pick<ArchModel, 'lineTypes'>, name: string | undefined): LineTypeDef | null {
  if (!name) return null;
  const n = norm(name);
  return allLineTypes(model).find((l) => norm(l.name) === n) ?? null;
}

export const isByLayer = (v: string | undefined) => !v || norm(v) === 'BYLAYER' || norm(v) === 'BYBLOCK';

function layerOf(model: Pick<ArchModel, 'layers'>, ref: string): Layer | undefined {
  return model.layers.find((l) => l.id === ref) ?? model.layers.find((l) => l.name === ref);
}

/** The linetype an object is drawn with (object → layer → Continuous). */
export function effectiveLineType(model: Pick<ArchModel, 'layers' | 'lineTypes'>, e: Pick<ArchEntity, 'layer' | 'lineType'>): LineTypeDef {
  const name = isByLayer(e.lineType) ? layerOf(model, e.layer)?.lineType : e.lineType;
  return findLineType(model, name) ?? STANDARD_LINETYPES[0];
}

/** Lineweight in mm an object plots with (object → layer → Default 0.25 mm). */
export function effectiveLineWeight(model: Pick<ArchModel, 'layers'>, e: Pick<ArchEntity, 'layer' | 'lineWeight'>): number {
  let w = e.lineWeight;
  if (w === undefined || w === -1) w = layerOf(model, e.layer)?.lineWeight;
  if (w === undefined || w < 0) return DEFAULT_LINEWEIGHT;
  return w;
}

/** True when the object or its layer sets a lineweight (not Default). */
export function hasExplicitLineWeight(model: Pick<ArchModel, 'layers'>, e: Pick<ArchEntity, 'layer' | 'lineWeight'>): boolean {
  if (e.lineWeight !== undefined && e.lineWeight >= 0) return true;
  if (e.lineWeight === -3) return false;
  const lw = layerOf(model, e.layer)?.lineWeight;
  return lw !== undefined && lw >= 0;
}

/** Color an object is drawn with (object → layer). */
export function effectiveColor(model: Pick<ArchModel, 'layers'>, e: Pick<ArchEntity, 'layer' | 'color'>, fallback = '#1c1917'): string {
  if (e.color && !isByLayer(e.color)) return e.color;
  return layerOf(model, e.layer)?.color ?? fallback;
}

/**
 * Dash array for a linetype at a scale (output units = pattern units × scale). Dots become a tiny
 * dash (`dot` length) so they show with butt caps too. Returns null for a solid line.
 */
export function dashArray(def: LineTypeDef, scale: number, dot = 0): number[] | null {
  if (!def.pattern.length || !(scale > 0)) return null;
  const out: number[] = [];
  // SVG / PDF dash arrays alternate dash, gap — merge same-kind neighbours, start with a dash
  for (const v of def.pattern) {
    const isGap = v < 0;
    const len = isGap ? -v * scale : v === 0 ? dot : v * scale;
    const wantGap = out.length % 2 === 1;
    if (isGap === wantGap) out.push(len);
    else if (out.length) out[out.length - 1] += len;
    else out.push(0, len); // pattern starting with a gap
  }
  if (out.length % 2 === 1) out.push(0);
  return out.map((v) => Math.round(v * 10000) / 10000);
}

/** Whether a linetype contains dots (needs round caps to show when dot length is 0). */
export const hasDots = (def: LineTypeDef) => def.pattern.includes(0);

/** Scale for an object: LTSCALE × object linetype scale. */
export function lineTypeScaleFor(model: Pick<ArchModel, 'settings'>, e: Pick<ArchEntity, 'lineTypeScale'>): number {
  const g = model.settings.ltScale ?? DEFAULT_LTSCALE;
  return Math.max(1e-6, g) * Math.max(1e-6, e.lineTypeScale ?? 1);
}

/** Object types that carry color / linetype / lineweight overrides. */
export const STYLED_TYPES = new Set<ArchEntity['type']>(['line', 'polyline', 'rectangle', 'circle', 'arc']);

/** Total pattern length (inches, unscaled). */
export const patternLength = (def: LineTypeDef) => def.pattern.reduce((s, v) => s + Math.abs(v), 0);

/**
 * Parses an AutoCAD .lin file. Simple linetypes only; complex ones (with [text] or [shape]
 * elements) are reported in `skipped`.
 */
export function parseLinFile(text: string): { lineTypes: LineTypeDef[]; skipped: string[] } {
  const lineTypes: LineTypeDef[] = [];
  const skipped: string[] = [];
  let cur: { name: string; description: string } | null = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/;;.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('*')) {
      const comma = line.indexOf(',');
      cur = { name: (comma < 0 ? line.slice(1) : line.slice(1, comma)).trim(), description: comma < 0 ? '' : line.slice(comma + 1).trim() };
      continue;
    }
    if (cur && /^A\s*,/i.test(line)) {
      const body = line.replace(/^A\s*,/i, '');
      if (body.includes('[')) {
        skipped.push(cur.name);
      } else {
        const nums = body.split(',').map((s) => parseFloat(s.trim())).filter((v) => Number.isFinite(v));
        if (cur.name) lineTypes.push({ name: cur.name, description: cur.description, pattern: nums });
      }
      cur = null;
    }
  }
  return { lineTypes, skipped };
}

/** Writes linetypes as a .lin file. */
export function writeLinFile(defs: LineTypeDef[]): string {
  return defs
    .filter((d) => d.pattern.length)
    .map((d) => `*${d.name},${d.description}\nA,${d.pattern.map((v) => String(Math.round(v * 10000) / 10000)).join(',')}`)
    .join('\n') + '\n';
}

/** Label for a lineweight value. */
export function lineWeightLabel(w: number | undefined): string {
  if (w === undefined || w === -1) return 'ByLayer';
  if (w === -2) return 'ByBlock';
  if (w < 0) return 'Default';
  return `${w.toFixed(2)} mm`;
}
