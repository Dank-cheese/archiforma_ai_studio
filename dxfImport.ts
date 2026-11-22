/**
 * DXF import (uses the "dxf-parser" npm package).
 *
 * Converts LINE, LWPOLYLINE / POLYLINE (including arc segments from bulges), CIRCLE, ARC,
 * TEXT and MTEXT into editable ARCHIFORMA entities on the target level.
 * - Drawing units come from $INSUNITS (inches, feet, mm, cm, m, …) and are converted to the
 *   app's internal inches. Unitless files are read in the project's units (mm for metric
 *   projects, inches for imperial).
 * - Only the layers actually used by imported objects are added, keeping their colour and
 *   on/off state; layers that already exist (matched by id or name) are reused.
 * - Everything else (INSERT, DIMENSION, HATCH, SPLINE, …) is skipped and reported by type.
 */
import DxfParser from 'dxf-parser';
import {
  ArcEntity,
  ArchEntity,
  CircleEntity,
  Layer,
  LineEntity,
  LineTypeDef,
  Point,
  PolylineEntity,
  TextAlignment,
  TextEntity,
  UnitSystem,
} from '../types/model';
import { createDefaultLayers, dist } from './geometry';
import { aciToHex } from './dxfExport';
import { findLineType, isByLayer } from './lineStyles';

export interface DxfImportSummary {
  lines: number;
  polylines: number;
  circles: number;
  arcs: number;
  texts: number;
  /** Entities not converted, by DXF type (e.g. { INSERT: 3, HATCH: 1 }). */
  skipped: Record<string, number>;
  /** Human-readable source units, e.g. "millimeters". */
  sourceUnits: string;
  /** Multiplier applied to convert file units to inches. */
  toInches: number;
  newLayers: string[];
}

type StyleProps = Pick<LineEntity, 'color' | 'lineType' | 'lineWeight' | 'lineTypeScale'>;

export interface DxfImportResult {
  entities: ArchEntity[];
  layers: Layer[];
  summary: DxfImportSummary;
  /** linetypes used by the file that the project does not have yet (patterns in inches) */
  lineTypes: LineTypeDef[];
  /** the file's $LTSCALE */
  ltScale?: number;
}

/** Layer linetype / lineweight / plot flag straight from the LAYER table (dxf-parser skips them). */
export function scanDxfLayerStyles(dxf: string): Map<string, { lineType?: string; lineWeight?: number; plot?: boolean }> {
  const out = new Map<string, { lineType?: string; lineWeight?: number; plot?: boolean }>();
  const lines = dxf.split(/\r\n|\r|\n/);
  let inLayerTable = false;
  let cur: { name?: string; lineType?: string; lineWeight?: number; plot?: boolean } | null = null;
  const flush = () => {
    if (cur?.name) out.set(cur.name.toUpperCase(), { lineType: cur.lineType, lineWeight: cur.lineWeight, plot: cur.plot });
    cur = null;
  };
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const val = lines[i + 1].trim();
    if (code === 0) {
      if (cur) flush();
      if (val === 'LAYER' && inLayerTable) cur = {};
      else if (val === 'ENDTAB' || val === 'ENDSEC') inLayerTable = false;
      continue;
    }
    if (code === 2 && val === 'LAYER' && !cur) {
      inLayerTable = true;
      continue;
    }
    if (!cur) continue;
    if (code === 2) cur.name = val;
    else if (code === 6) cur.lineType = val;
    else if (code === 370) {
      const w = parseInt(val, 10);
      if (w >= 0) cur.lineWeight = w / 100;
    } else if (code === 290) cur.plot = val !== '0';
  }
  return out;
}

const INSUNITS: Record<number, [string, number]> = {
  1: ['inches', 1],
  2: ['feet', 12],
  3: ['miles', 63360],
  4: ['millimeters', 1 / 25.4],
  5: ['centimeters', 10 / 25.4],
  6: ['meters', 1000 / 25.4],
  7: ['kilometers', 1_000_000 / 25.4],
  8: ['microinches', 1e-6],
  9: ['mils', 0.001],
  10: ['yards', 36],
  11: ['angstroms', 1e-7 / 25.4],
  12: ['nanometers', 1e-6 / 25.4],
  13: ['microns', 1e-3 / 25.4],
  14: ['decimeters', 100 / 25.4],
  15: ['decameters', 10_000 / 25.4],
  16: ['hectometers', 100_000 / 25.4],
  21: ['US survey feet', 12.000024],
};

/** Removes MTEXT inline formatting codes and decodes %% / \U+ escapes. */
export function cleanDxfText(raw: string): string {
  let s = String(raw ?? '');
  s = s.replace(/\\U\+([0-9A-Fa-f]{4,5})/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)));
  s = s.replace(/\\[Pp]/g, ' ').replace(/\\~/g, ' ').replace(/\\\\/g, '\u0000');
  s = s.replace(/\\S([^;^#]*)[\^#]([^;]*);/g, '$1/$2'); // stacked fractions 1^2 / 1#2
  s = s.replace(/\\[ACcFfHhQTWpa][^;]*;/g, ''); // value codes ending in ';'
  s = s.replace(/\\[LlOoKkNX]/g, ''); // toggle codes
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\u0000/g, '\\');
  s = s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%');
  return s.replace(/\s+/g, ' ').trim();
}

const normDeg = (d: number) => ((d % 360) + 360) % 360;

export function importFromDXF(
  dxfContent: string,
  targetLevelId = 'level-1',
  existingLayers: Layer[] = createDefaultLayers(),
  projectUnits: UnitSystem = 'imperial',
  existingLineTypes: LineTypeDef[] = []
): DxfImportResult {
  const parser = new DxfParser();
  const parsed = parser.parseSync(dxfContent) as unknown as {
    header?: Record<string, unknown>;
    tables?: {
      layer?: { layers?: Record<string, { name?: string; color?: number; colorIndex?: number; visible?: boolean; frozen?: boolean }> };
      lineType?: { lineTypes?: Record<string, { name?: string; description?: string; pattern?: number[] }> };
    };
    entities?: Array<Record<string, any>>;
  } | null;
  if (!parsed) throw new Error('The file could not be read as DXF.');

  // ---- units ------------------------------------------------------------------------------
  const insunits = Number(parsed.header?.['$INSUNITS'] ?? 0);
  let [sourceUnits, k] = INSUNITS[insunits] || ['unitless', 0];
  if (!k) {
    if (projectUnits === 'metric') {
      sourceUnits = 'unitless (read as millimeters)';
      k = 1 / 25.4;
    } else {
      sourceUnits = 'unitless (read as inches)';
      k = 1;
    }
  }
  const P = (p: { x?: number; y?: number } | undefined): Point => ({ x: Number(p?.x || 0) * k, y: -Number(p?.y || 0) * k });

  // ---- linetypes --------------------------------------------------------------------------------
  const fileLineTypes = parsed.tables?.lineType?.lineTypes || {};
  const fileLtByUpper = new Map(Object.entries(fileLineTypes).map(([key, v]) => [(v.name || key).toUpperCase(), v] as const));
  const newLineTypes: LineTypeDef[] = [];
  /** name of a linetype the file uses; unknown ones are added from the file's LTYPE table */
  const useLineType = (name: string): string => {
    const known = findLineType({ lineTypes: [...existingLineTypes, ...newLineTypes] }, name);
    if (known) return known.name;
    const def = fileLtByUpper.get(name.toUpperCase());
    if (def?.pattern?.length) {
      newLineTypes.push({ name, description: def.description || name, pattern: def.pattern.map((v) => Math.round(v * k * 10000) / 10000) });
      return name;
    }
    return name; // undefined in the file: drawn solid, name kept
  };
  const styleOf = (raw: Record<string, any>): StyleProps => {
    const st: StyleProps = {};
    if (typeof raw.lineType === 'string' && !isByLayer(raw.lineType)) st.lineType = raw.lineType.toUpperCase() === 'CONTINUOUS' ? 'Continuous' : useLineType(raw.lineType);
    if (typeof raw.lineweight === 'number') {
      if (raw.lineweight >= 0) st.lineWeight = raw.lineweight / 100;
      else if (raw.lineweight === -3) st.lineWeight = -3;
    }
    const ci = raw.colorIndex;
    if (ci !== 256 && ci !== 0 && typeof raw.color === 'number' && (ci !== undefined || raw.color !== undefined)) {
      const hex = `#${raw.color.toString(16).padStart(6, '0')}`;
      st.color = hex === '#ffffff' ? '#1c1917' : hex;
    }
    if (typeof raw.lineTypeScale === 'number' && raw.lineTypeScale > 0 && Math.abs(raw.lineTypeScale - 1) > 1e-9) st.lineTypeScale = raw.lineTypeScale;
    return st;
  };
  const layerStyles = scanDxfLayerStyles(dxfContent);

  // ---- layers -------------------------------------------------------------------------------
  const out: Layer[] = existingLayers.map((l) => ({ ...l }));
  const byKey = new Map<string, Layer>();
  for (const l of out) {
    byKey.set(l.id.toUpperCase(), l);
    byKey.set(l.name.toUpperCase(), l);
  }
  const dxfLayers = parsed.tables?.layer?.layers || {};
  const dxfLayerByUpper = new Map(Object.entries(dxfLayers).map(([key, v]) => [(v.name || key).toUpperCase(), v] as const));
  const newLayers: string[] = [];
  const layerFor = (name?: string): string => {
    const clean = String(name ?? '0').trim() || '0';
    const hit = byKey.get(clean.toUpperCase());
    if (hit) return hit.id;
    const src = dxfLayerByUpper.get(clean.toUpperCase());
    const color =
      typeof src?.color === 'number' && src.color >= 0
        ? `#${src.color.toString(16).padStart(6, '0')}`
        : typeof src?.colorIndex === 'number'
          ? aciToHex(src.colorIndex)
          : '#334155';
    const extra = layerStyles.get(clean.toUpperCase());
    const layer: Layer = {
      id: clean,
      name: clean,
      color: color === '#ffffff' ? '#1c1917' : color, // white-on-black CAD colour -> ink on paper
      visible: src ? src.visible !== false && src.frozen !== true : true,
      locked: false,
      ...(extra?.lineType && !isByLayer(extra.lineType) && extra.lineType.toUpperCase() !== 'CONTINUOUS' ? { lineType: useLineType(extra.lineType) } : {}),
      ...(extra?.lineWeight !== undefined ? { lineWeight: extra.lineWeight } : {}),
      ...(extra?.plot === false ? { plot: false } : {}),
    };
    out.push(layer);
    byKey.set(clean.toUpperCase(), layer);
    newLayers.push(clean);
    return clean;
  };

  // ---- entities -----------------------------------------------------------------------------
  const entities: ArchEntity[] = [];
  const summary: DxfImportSummary = {
    lines: 0,
    polylines: 0,
    circles: 0,
    arcs: 0,
    texts: 0,
    skipped: {},
    sourceUnits,
    toInches: k,
    newLayers,
  };
  const skip = (t: string) => (summary.skipped[t] = (summary.skipped[t] || 0) + 1);
  const batch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let seq = 0;
  const nid = (kind: string) => `dxf-${kind}-${batch}-${seq++}`;

  const pushArcCad = (layer: string, cx: number, cy: number, r: number, cadStartDeg: number, cadEndDeg: number, style: StyleProps = {}) => {
    // CAD arcs run counter-clockwise (Y up). After flipping Y they become this app's arcs from -end to -start.
    const arc: ArcEntity = {
      id: nid('arc'),
      type: 'arc',
      layer,
      levelId: targetLevelId,
      center: { x: cx * k, y: -cy * k },
      radius: r * k,
      startAngle: normDeg(-cadEndDeg),
      endAngle: normDeg(-cadStartDeg),
      ...style,
    } as ArcEntity;
    entities.push(arc);
    summary.arcs++;
  };

  for (const raw of parsed.entities || []) {
    const type = String(raw.type || '').toUpperCase();
    if (raw.inPaperSpace) {
      skip(`${type} (paper space)`);
      continue;
    }

    if (type === 'LINE') {
      const v = raw.vertices as Array<{ x: number; y: number }> | undefined;
      if (!v || v.length < 2) {
        skip(type);
        continue;
      }
      const ln: LineEntity = { id: nid('line'), type: 'line', layer: layerFor(raw.layer), levelId: targetLevelId, start: P(v[0]), end: P(v[1]), ...styleOf(raw) };
      if (dist(ln.start, ln.end) > 1e-6) {
        entities.push(ln);
        summary.lines++;
      }
    } else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
      const verts = (raw.vertices || []) as Array<{ x: number; y: number; bulge?: number }>;
      if (verts.length < 2 || raw.is3dPolyline || raw.isPolyfaceMesh || raw.is3dPolygonMesh) {
        skip(raw.isPolyfaceMesh || raw.is3dPolygonMesh ? 'POLYLINE (mesh)' : type);
        continue;
      }
      const layer = layerFor(raw.layer);
      const closed = Boolean(raw.shape || raw.closed);
      const segCount = closed ? verts.length : verts.length - 1;
      const hasBulge = verts.slice(0, segCount).some((v) => Math.abs(Number(v.bulge || 0)) > 1e-9);
      if (!hasBulge) {
        const pl: PolylineEntity = { id: nid('pline'), type: 'polyline', layer, levelId: targetLevelId, points: verts.map(P), closed, ...styleOf(raw) };
        entities.push(pl);
        summary.polylines++;
        continue;
      }
      // Split into straight runs (polylines) and arc segments (true arcs)
      let run: Point[] = [P(verts[0])];
      const flush = () => {
        if (run.length >= 2) {
          entities.push({ id: nid('pline'), type: 'polyline', layer, levelId: targetLevelId, points: run, closed: false, ...styleOf(raw) });
          summary.polylines++;
        }
      };
      for (let i = 0; i < segCount; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        const bulge = Number(a.bulge || 0);
        if (Math.abs(bulge) < 1e-9) {
          run.push(P(b));
          continue;
        }
        flush();
        const theta = 4 * Math.atan(bulge); // included angle, + = counter-clockwise
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        if (chord < 1e-12) {
          run = [P(b)];
          continue;
        }
        const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        // Signed distance from chord midpoint to centre (negative for arcs over 180°)
        const h = r * Math.cos(Math.abs(theta) / 2);
        const ux = (b.x - a.x) / chord;
        const uy = (b.y - a.y) / chord;
        const side = bulge > 0 ? 1 : -1; // CCW arcs (< 180°) have their centre left of a->b
        const cx = mx - uy * h * side;
        const cy = my + ux * h * side;
        const angA = (Math.atan2(a.y - cy, a.x - cx) * 180) / Math.PI;
        const angB = (Math.atan2(b.y - cy, b.x - cx) * 180) / Math.PI;
        if (bulge > 0) pushArcCad(layer, cx, cy, r, angA, angB, styleOf(raw));
        else pushArcCad(layer, cx, cy, r, angB, angA, styleOf(raw));
        run = [P(b)];
      }
      flush();
    } else if (type === 'CIRCLE') {
      const r = Number(raw.radius || 0);
      if (!(r > 0)) {
        skip(type);
        continue;
      }
      const c: CircleEntity = { id: nid('circle'), type: 'circle', layer: layerFor(raw.layer), levelId: targetLevelId, center: P(raw.center), radius: r * k, ...styleOf(raw) };
      entities.push(c);
      summary.circles++;
    } else if (type === 'ARC') {
      const r = Number(raw.radius || 0);
      if (!(r > 0)) {
        skip(type);
        continue;
      }
      // dxf-parser converts group 50/51 to radians
      const s = (Number(raw.startAngle || 0) * 180) / Math.PI;
      const e = (Number(raw.endAngle || 0) * 180) / Math.PI;
      pushArcCad(layerFor(raw.layer), Number(raw.center?.x || 0), Number(raw.center?.y || 0), r, s, e, styleOf(raw));
    } else if (type === 'TEXT' || type === 'MTEXT') {
      const text = cleanDxfText(raw.text ?? raw.string ?? '');
      if (!text) {
        skip(type);
        continue;
      }
      let pos = raw.startPoint || raw.position || { x: 0, y: 0 };
      let alignment: TextAlignment = 'left';
      if (type === 'TEXT') {
        const h = Number(raw.halign || 0);
        const v = Number(raw.valign || 0);
        if ((h > 0 || v > 0) && raw.endPoint) pos = raw.endPoint;
        alignment = h === 1 || h === 4 ? 'center' : h === 2 ? 'right' : 'left';
      } else {
        const ap = Number(raw.attachmentPoint || 1);
        alignment = ap % 3 === 2 ? 'center' : ap % 3 === 0 ? 'right' : 'left';
      }
      const height = Number(raw.textHeight || raw.height || 0) * k;
      const t: TextEntity = {
        id: nid('text'),
        type: 'text',
        layer: layerFor(raw.layer),
        levelId: targetLevelId,
        position: P(pos),
        text,
        fontSize: height > 0 ? height : 8,
        rotation: -Number(raw.rotation || 0) || 0,
        alignment,
      };
      entities.push(t);
      summary.texts++;
    } else {
      skip(type || 'UNKNOWN');
    }
  }

  const lts = Number(parsed.header?.['$LTSCALE']);
  return { entities, layers: out, summary, lineTypes: newLineTypes, ...(lts > 0 ? { ltScale: lts } : {}) };
}
