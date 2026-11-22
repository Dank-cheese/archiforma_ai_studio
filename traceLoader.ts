/**
 * Loads an image or one page of a PDF as a compressed JPEG data URL for a trace image.
 * pdf.js is loaded only when a PDF is opened, and runs on the main thread (no worker file),
 * so it also works in the single-file archiforma.html build.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

export const TRACE_MAX_PX = 2400;
const JPEG_QUALITY = 0.82;

export interface LoadedPlanImage {
  src: string;
  pixelWidth: number;
  pixelHeight: number;
}

function canvasToJpeg(canvas: HTMLCanvasElement): LoadedPlanImage {
  return { src: canvas.toDataURL('image/jpeg', JPEG_QUALITY), pixelWidth: canvas.width, pixelHeight: canvas.height };
}

function whiteCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw images (no canvas).');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

export const isPdfFile = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export async function loadImageFile(file: File): Promise<LoadedPlanImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Could not read "${file.name}" as an image. Use JPG, PNG, WebP, GIF or PDF.`));
      el.src = url;
    });
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error('That image is empty.');
    const k = Math.min(1, TRACE_MAX_PX / Math.max(w0, h0));
    const { canvas, ctx } = whiteCanvas(w0 * k, h0 * k);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvasToJpeg(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const g = globalThis as unknown as { pdfjsWorker?: unknown };
      if (!g.pdfjsWorker) g.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.min.mjs');
      return import('pdfjs-dist');
    })();
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(file: File): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return await lib.getDocument({ data, verbosity: lib.VerbosityLevel.ERRORS }).promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/password/i.test(msg) ? 'That PDF is password-protected. Save an unprotected copy and try again.' : `Could not open the PDF (${msg}).`);
  }
}

/** Renders one page (1-based). pageWidthPoints is the sheet width in PDF points (72 per inch). */
export async function renderPdfPage(doc: PDFDocumentProxy, pageNumber: number): Promise<LoadedPlanImage & { pageWidthPoints: number }> {
  const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(6, TRACE_MAX_PX / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const { canvas, ctx } = whiteCanvas(viewport.width, viewport.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const out = canvasToJpeg(canvas);
  page.cleanup();
  return { ...out, pageWidthPoints: base.width };
}
