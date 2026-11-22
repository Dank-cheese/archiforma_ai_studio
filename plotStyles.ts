/**
 * PLOT STYLES (pure): AutoCAD-style color-dependent plot style tables (.ctb). A table maps each
 * AutoCAD Color Index (1–255) to a plotted color, screening and lineweight. Applied to the plan
 * primitives of sheets and PDF plots; .ctb files are read and written (zlib done by the caller).
 */
import type { ArchModel, PlotStylePen, PlotStyleTable } from '../types/model';
import type { PlanPrim } from './planPrimitives';
import { aciToHex, hexToNearestAci } from './dxfExport';

export const OBJECT_PEN: PlotStylePen = { color: 'object', screening: 100, lineWeight: 'object', lineType: 'object' };
/** AutoCAD's default custom lineweight table (index → mm); index 0 = "use object lineweight" */
export const CTB_LINEWEIGHTS = [0, 0.05, 0.09, 0.1, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.53, 0.6, 0.65, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11];

const allPens = (fn: (aci: number) => Partial<PlotStylePen>): Record<number, PlotStylePen> => {
  const pens: Record<number, PlotStylePen> = {};
  for (let i = 1; i <= 255; i++) pens[i] = { ...OBJECT_PEN, ...fn(i) };
  return pens;
};

/** Classic pen weights by color, plotted black (common office standard). */
const PEN_WEIGHTS: Record<number, number> = { 1: 0.18, 2: 0.25, 3: 0.35, 4: 0.5, 5: 0.7, 6: 0.25, 7: 0.35, 8: 0.18, 9: 0.13 };

export const BUILTIN_PLOT_STYLES: PlotStyleTable[] = [
  { name: 'acad.ctb', description: 'Plots objects in their own colors and lineweights.', pens: {}, builtIn: true },
  { name: 'monochrome.ctb', description: 'Plots every color as black.', pens: allPens(() => ({ color: '#000000' })), builtIn: true },
  { name: 'grayscale.ctb', description: 'Plots every color as a shade of gray.', pens: allPens(() => ({ grayscale: true })), builtIn: true },
  {
    name: 'ARCHIFORMA Pens.ctb',
    description: 'Black ink; lineweight by color (1 red .18 · 2 yellow .25 · 3 green .35 · 4 cyan .50 · 5 blue .70 · 6 magenta .25 · 7 black .35), 8 / 9 screened gray.',
    pens: allPens((i) => ({
      color: '#000000',
      ...(PEN_WEIGHTS[i] !== undefined ? { lineWeight: PEN_WEIGHTS[i] } : {}),
      ...(i === 8 ? { screening: 60 } : i === 9 ? { screening: 40 } : {}),
      ...(i >= 250 ? { screening: Math.round(30 + ((i - 250) / 5) * 50) } : {}),
    })),
    builtIn: true,
  },
  ...[25, 50, 75].map((pct) => ({ name: `Screening ${pct}%.ctb`, description: `Plots objects in their own colors at ${pct}% ink.`, pens: allPens(() => ({ screening: pct })), builtIn: true })),
];

export const NO_PLOT_STYLE = ''; // ARCHIFORMA's own black-and-gray drawing look

export function allPlotStyleTables(model: Pick<ArchModel, 'plotStyleTables'>): PlotStyleTable[] {
  const custom = model.plotStyleTables ?? [];
  const names = new Set(custom.map((t) => t.name.toLowerCase()));
  return [...BUILTIN_PLOT_STYLES.filter((t) => !names.has(t.name.toLowerCase())), ...custom];
}

export function findPlotStyleTable(model: Pick<ArchModel, 'plotStyleTables'>, name: string | undefined): PlotStyleTable | null {
  if (!name) return null;
  return allPlotStyleTables(model).find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? null;
}

export const penFor = (table: PlotStyleTable, aci: number): PlotStylePen => table.pens[aci] ?? OBJECT_PEN;

// ---------------------------------------------------------------------------------------------
// color helpers
// ---------------------------------------------------------------------------------------------
function rgb(hex: string): [number, number, number] | null {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(h)) return null;
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(f, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = ([r, g, b]: [number, number, number]) => `#${((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1)}`;
const gray = (c: [number, number, number]): [number, number, number] => {
  const y = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return [y, y, y];
};
/** screening: 100 = full ink, 0 = white */
const screen = (c: [number, number, number], pct: number): [number, number, number] => {
  const k = Math.max(0, Math.min(100, pct)) / 100;
  return [255 - (255 - c[0]) * k, 255 - (255 - c[1]) * k, 255 - (255 - c[2]) * k];
};

/** Plotted color of a line / text drawn in `hex` for an object whose own color is `objColor`. */
export function plotColor(pen: PlotStylePen, objColor: string): string {
  const base = rgb(pen.color === 'object' ? objColor : pen.color) ?? [0, 0, 0];
  let c = pen.grayscale ? gray(base) : base;
  if (pen.screening < 100) c = screen(c, pen.screening);
  return toHex(c);
}

/** Area fills keep their shade; a pen with a fixed color (or grayscale) shows them in gray. */
function plotFill(pen: PlotStylePen, fill: string): string {
  const base = rgb(fill);
  if (!base) return fill;
  let c = pen.color !== 'object' || pen.grayscale ? gray(base) : base;
  if (pen.screening < 100) c = screen(c, pen.screening);
  return toHex(c);
}

/**
 * Applies a plot style table to plan primitives. Lines and text take the pen's color / lineweight;
 * fills keep their shade (gray when the pen has a fixed color). `src` = the object's own color.
 */
export function applyPlotStyle(prims: PlanPrim[], table: PlotStyleTable | null): PlanPrim[] {
  if (!table) return prims;
  return prims.map((p) => {
    const obj = p.src ?? (p.k === 'text' ? p.color : p.stroke) ?? '#000000';
    const pen = penFor(table, hexToNearestAci(obj));
    if (p.k === 'text') return { ...p, color: plotColor(pen, obj) };
    const fillLike = !!p.fill && p.stroke === p.fill; // seam strokes painted in the fill color
    const out = { ...p };
    if (p.fill) out.fill = plotFill(pen, p.fill);
    if (p.stroke) {
      out.stroke = fillLike ? out.fill : plotColor(pen, obj);
      if (!fillLike && pen.lineWeight !== 'object') out.w = pen.lineWeight;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------------------------
// .ctb files: binary header + zlib(text). The (de)compression is done by the caller.
// ---------------------------------------------------------------------------------------------
export const CTB_MAGIC = 'PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec';
export const CTB_HEADER_BYTES = 60;
const OBJECT_COLOR = -1;
const OBJECT_COLOR2 = -1006632961;
const OBJECT_LINETYPE = 31;

const int32 = (u: number) => (u | 0);
const colorInt = (hex: string, type = 0xc2) => {
  const c = rgb(hex) ?? [0, 0, 0];
  return int32(((type << 24) >>> 0) + (c[0] << 16) + (c[1] << 8) + c[2]);
};
const colorName = (i: number) => `Color_${i + 1}`;

/** The text inside a .ctb (before zlib). */
export function ctbToText(table: PlotStyleTable): string {
  const lws = [...CTB_LINEWEIGHTS];
  const lwIndex = (w: number) => {
    let i = lws.findIndex((v) => Math.abs(v - w) < 0.001 && v > 0);
    if (i < 0) {
      lws.push(w);
      i = lws.length - 1;
    }
    return i;
  };
  const out: string[] = [];
  out.push(`description="${table.description.replace(/\n/g, ' ')}`);
  out.push('aci_table_available=TRUE', 'scale_factor=1.0', 'apply_factor=FALSE', 'custom_lineweight_display_units=0');
  out.push('aci_table{');
  for (let i = 0; i < 255; i++) out.push(` ${i}="${colorName(i)}`);
  out.push('}', 'plot_style{');
  for (let i = 0; i < 255; i++) {
    const pen = penFor(table, i + 1);
    out.push(` ${i}{`, `  name="${colorName(i)}`, `  localized_name="${colorName(i)}`, '  description="');
    if (pen.color === 'object') out.push(`  color=${OBJECT_COLOR}`);
    else {
      const c = colorInt(pen.color);
      out.push(`  color=${c}`, `  mode_color=${c}`);
    }
    out.push(`  color_policy=${1 | (pen.grayscale ? 2 : 0)}`, '  physical_pen_number=0', '  virtual_pen_number=0', `  screen=${Math.round(pen.screening)}`);
    out.push('  linepattern_size=0.5', `  linetype=${pen.lineType === 'object' ? OBJECT_LINETYPE : pen.lineType}`, '  adaptive_linetype=TRUE');
    out.push(`  lineweight=${pen.lineWeight === 'object' ? 0 : lwIndex(pen.lineWeight)}`);
    out.push('  fill_style=73', '  end_style=4', '  join_style=5', ' }');
  }
  out.push('}', 'custom_lineweight_table{');
  lws.forEach((w, i) => out.push(` ${i}=${w.toFixed(2)}`));
  out.push('}');
  return out.join('\n') + '\n';
}

type Tree = { [k: string]: string | Tree };

/** Minimal parser for the .ctb / .stb text format (nested name{ … } blocks and name=value lines). */
function parseTree(text: string): Tree {
  const lines = text.replace(/\r/g, '').split('\n');
  let i = 0;
  const block = (): Tree => {
    const t: Tree = {};
    while (i < lines.length) {
      const line = lines[i].trim();
      i++;
      if (!line) continue;
      if (line === '}') return t;
      if (line.endsWith('{')) {
        t[line.slice(0, -1).trim()] = block();
        continue;
      }
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      let v = line.slice(eq + 1).trim();
      if (v.startsWith('"')) v = v.slice(1).replace(/"$/, '');
      else if (v.endsWith(')')) v = v.split(' ')[0];
      t[line.slice(0, eq).trim()] = v;
    }
    return t;
  };
  return block();
}

/** Reads the text of a .ctb into a table. Throws for named (.stb) tables. */
export function parseCtbText(text: string, name: string): PlotStyleTable {
  const t = parseTree(text.replace(/\0+$/, ''));
  if (String(t.aci_table_available).toUpperCase() !== 'TRUE' || typeof t.plot_style !== 'object') {
    throw new Error('That is a named plot style table (.stb). Only color-dependent tables (.ctb) are supported.');
  }
  const lwt = (t.custom_lineweight_table ?? {}) as Tree;
  const lwOf = (idx: number) => {
    const v = parseFloat(String(lwt[String(idx)] ?? CTB_LINEWEIGHTS[idx] ?? 0));
    return Number.isFinite(v) ? v : 0;
  };
  const pens: Record<number, PlotStylePen> = {};
  for (const [k, raw] of Object.entries(t.plot_style as Tree)) {
    if (typeof raw !== 'object') continue;
    const idx = parseInt(k, 10);
    if (!(idx >= 0 && idx < 255)) continue;
    const st = raw as Record<string, string>;
    const col = parseInt(st.color ?? '-1', 10);
    const mode = st.mode_color !== undefined ? parseInt(st.mode_color, 10) : col;
    const objectColor = col === OBJECT_COLOR || col === OBJECT_COLOR2 || mode === OBJECT_COLOR || mode === OBJECT_COLOR2;
    const u = mode >>> 0;
    const lw = lwOf(parseInt(st.lineweight ?? '0', 10));
    const ltIdx = parseInt(st.linetype ?? String(OBJECT_LINETYPE), 10);
    const pen: PlotStylePen = {
      color: objectColor ? 'object' : `#${(u & 0xffffff).toString(16).padStart(6, '0')}`,
      screening: Math.max(0, Math.min(100, parseInt(st.screen ?? '100', 10) || 0)),
      lineWeight: lw > 0 ? Math.round(lw * 1000) / 1000 : 'object',
      lineType: ltIdx === OBJECT_LINETYPE || !Number.isFinite(ltIdx) ? 'object' : ltIdx,
      ...(parseInt(st.color_policy ?? '1', 10) & 2 ? { grayscale: true } : {}),
    };
    const isDefault = pen.color === 'object' && pen.screening === 100 && pen.lineWeight === 'object' && pen.lineType === 'object' && !pen.grayscale;
    if (!isDefault) pens[idx + 1] = pen;
  }
  return { name, description: String(t.description ?? ''), pens };
}

/** Adler-32 (the checksum AutoCAD stores in the .ctb header). */
export function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wraps zlib-compressed text into a .ctb file. `rawLength` = length of the uncompressed text. */
export function packCtb(compressed: Uint8Array, rawLength: number): Uint8Array {
  const out = new Uint8Array(CTB_HEADER_BYTES + compressed.length);
  for (let i = 0; i < CTB_MAGIC.length; i++) out[i] = CTB_MAGIC.charCodeAt(i);
  const dv = new DataView(out.buffer);
  dv.setUint32(48, adler32(compressed), true);
  dv.setUint32(52, rawLength, true);
  dv.setUint32(56, compressed.length, true);
  out.set(compressed, CTB_HEADER_BYTES);
  return out;
}

/** The zlib part of a .ctb file (throws when the header is wrong). */
export function unpackCtb(file: Uint8Array): Uint8Array {
  const head = String.fromCharCode(...file.slice(0, 14));
  if (head !== 'PIAFILEVERSION') throw new Error('That is not an AutoCAD plot style file (.ctb).');
  // AutoCAD writes a 60-byte header; some tools write 8-byte size fields (72) — find the zlib header
  const isZlib = (i: number) => file[i] === 0x78 && ((file[i] << 8) | file[i + 1]) % 31 === 0;
  if (isZlib(CTB_HEADER_BYTES)) return file.slice(CTB_HEADER_BYTES);
  for (let i = 48; i < Math.min(file.length - 1, 120); i++) if (isZlib(i)) return file.slice(i);
  throw new Error('That .ctb file is damaged (no compressed data found).');
}

/** Colors (ACI) used by the drawing, for the editor's "used in this drawing" list. */
export function usedAci(model: Pick<ArchModel, 'layers' | 'entities'>): number[] {
  const set = new Set<number>();
  for (const l of model.layers) set.add(hexToNearestAci(l.color));
  for (const e of model.entities) if (e.color) set.add(hexToNearestAci(e.color));
  return [...set].sort((a, b) => a - b);
}

export { aciToHex };
