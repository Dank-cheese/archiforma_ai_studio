/**
 * TRACE IMAGES (pure helpers): placement, scale calibration and moving of PDF / image plans that
 * sit under the drawing for tracing. Units are model inches; y grows down like the plan.
 */
import type { ArchModel, Point, TraceImage } from '../types/model';

let seq = 0;
const newId = () => `trace-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const traceHeight = (t: Pick<TraceImage, 'width' | 'pixelWidth' | 'pixelHeight'>) => (t.width * t.pixelHeight) / Math.max(1, t.pixelWidth);

export function traceBounds(t: TraceImage) {
  return { minX: t.x, minY: t.y, maxX: t.x + t.width, maxY: t.y + traceHeight(t) };
}

/** Paper scales for PDFs drawn to scale: model inches per paper inch. */
export const PDF_SCALES: Array<{ id: string; label: string; ratio: number }> = [
  { id: '1/8', label: '1/8" = 1\'-0"', ratio: 96 },
  { id: '3/16', label: '3/16" = 1\'-0"', ratio: 64 },
  { id: '1/4', label: '1/4" = 1\'-0"', ratio: 48 },
  { id: '3/8', label: '3/8" = 1\'-0"', ratio: 32 },
  { id: '1/2', label: '1/2" = 1\'-0"', ratio: 24 },
  { id: '1:50', label: '1:50', ratio: 50 },
  { id: '1:100', label: '1:100', ratio: 100 },
  { id: '1:200', label: '1:200', ratio: 200 },
];

/** World width of a PDF page drawn at a paper scale (page width in PDF points, 72 per inch). */
export function pdfWorldWidth(pageWidthPoints: number, ratio: number): number {
  return (pageWidthPoints / 72) * ratio;
}

export function createTraceImage(args: {
  name: string;
  src: string;
  pixelWidth: number;
  pixelHeight: number;
  levelId: string;
  width?: number; // inches; default 40'-0"
  at?: Point;     // top-left; default (0,0)
}): TraceImage {
  return {
    id: newId(),
    name: args.name.slice(0, 80) || 'Plan',
    levelId: args.levelId,
    src: args.src,
    pixelWidth: Math.max(1, Math.round(args.pixelWidth)),
    pixelHeight: Math.max(1, Math.round(args.pixelHeight)),
    x: args.at?.x ?? 0,
    y: args.at?.y ?? 0,
    width: Math.max(1, args.width ?? 480),
    opacity: 0.5,
    visible: true,
    locked: false,
  };
}

/**
 * Two-point calibration: the user clicked `a` and `b` on the image and says the real distance
 * between them is `realLength`. The image scales about `a` so that `a` stays put.
 */
export function calibrateTraceImage(t: TraceImage, a: Point, b: Point, realLength: number): TraceImage {
  const measured = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(measured > 1e-6) || !(realLength > 0)) return t;
  const k = realLength / measured;
  return { ...t, x: a.x + (t.x - a.x) * k, y: a.y + (t.y - a.y) * k, width: t.width * k, calibrated: true };
}

export function moveTraceImage(t: TraceImage, dx: number, dy: number): TraceImage {
  return { ...t, x: t.x + dx, y: t.y + dy };
}

/** Guards against hand-edited / corrupt project files. */
export function isValidTraceImage(t: unknown): t is TraceImage {
  const o = t as TraceImage;
  return !!o && typeof o.id === 'string' && typeof o.src === 'string' && o.src.startsWith('data:image/') &&
    [o.x, o.y, o.width, o.pixelWidth, o.pixelHeight].every((v) => typeof v === 'number' && Number.isFinite(v)) && o.width > 0;
}

export function traceImagesOnLevel(model: ArchModel, levelId: string): TraceImage[] {
  return (Array.isArray(model.traceImages) ? model.traceImages : []).filter((t) => isValidTraceImage(t) && t.levelId === levelId);
}

/** Immutable update of one trace image in the model. */
export function updateTraceImage(model: ArchModel, id: string, fn: (t: TraceImage) => TraceImage | null): ArchModel {
  const list: TraceImage[] = [];
  for (const t of model.traceImages ?? []) {
    if (t.id !== id) list.push(t);
    else {
      const next = fn(t);
      if (next) list.push(next);
    }
  }
  return { ...model, traceImages: list };
}

/** Approximate size of the stored image data (bytes), for storage warnings. */
export function traceImageBytes(t: Pick<TraceImage, 'src'>): number {
  const i = t.src.indexOf(',');
  return Math.round(((t.src.length - (i + 1)) * 3) / 4);
}
