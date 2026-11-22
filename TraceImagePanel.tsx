import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, FileUp, Lock, LockOpen, Move, Ruler, Trash2, X, ZoomIn, Loader2, Sparkles, Square } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { TraceImage, UnitSystem } from '../types/model';
import { formatLength, parseLengthInput } from '../engine/geometry';
import { PDF_SCALES, pdfWorldWidth, traceImageBytes } from '../engine/traceImage';
import { isPdfFile, loadImageFile, openPdf, renderPdfPage } from './traceLoader';

export interface PlaceTraceArgs {
  name: string;
  src: string;
  pixelWidth: number;
  pixelHeight: number;
  /** placed width in inches when the drawing scale is known (PDF drawn to scale) */
  worldWidth?: number;
}

interface Props {
  images: TraceImage[];
  units: UnitSystem;
  darkMode: boolean;
  levelName: string;
  /** bump to open the file chooser (TRACE command / menu) */
  importSignal: number;
  busyTool: 'tracescale' | 'tracemove' | null;
  targetId: string | null;
  onPlace: (args: PlaceTraceArgs) => void;
  onUpdate: (id: string, patch: Partial<TraceImage>, label: string) => void;
  onDelete: (id: string) => void;
  onStartScale: (id: string) => void;
  onStartMove: (id: string) => void;
  onZoomTo: (id: string) => void;
  /** live opacity while the slider is dragged (null = done) */
  onPreviewOpacity?: (id: string, v: number | null) => void;
  onError: (msg: string) => void;
  /** AUTOMATIC TRACING */
  onAutoTrace?: (id: string) => void;
  onCancelAutoTrace?: () => void;
  autoTracing?: { id: string; engine: string } | null;
  onClose: () => void;
}

interface PendingPdf {
  file: File;
  doc: PDFDocumentProxy;
  page: number;
  scaleId: string; // '' = not to scale
}

export const TraceImagePanel: React.FC<Props> = ({
  images, units, darkMode, levelName, importSignal, busyTool, targetId,
  onPlace, onUpdate, onDelete, onStartScale, onStartMove, onZoomTo, onPreviewOpacity, onError, onClose, onAutoTrace, onCancelAutoTrace, autoTracing,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPdf | null>(null);
  const [opacityDraft, setOpacityDraft] = useState<Record<string, number>>({});
  const [widthDraft, setWidthDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (importSignal > 0) fileRef.current?.click();
  }, [importSignal]);

  // free the PDF when it is placed / cancelled / replaced (not when only the page or scale changes)
  const pendingDoc = pending?.doc;
  useEffect(() => () => void (pendingDoc as unknown as { destroy?: () => Promise<void> } | undefined)?.destroy?.(), [pendingDoc]);

  const handleFile = async (file: File) => {
    try {
      if (isPdfFile(file)) {
        setLoading('Opening PDF…');
        const doc = await openPdf(file);
        setPending({ file, doc, page: 1, scaleId: '' });
      } else {
        setLoading('Reading image…');
        const img = await loadImageFile(file);
        onPlace({ name: file.name.replace(/\.[a-z0-9]+$/i, ''), ...img });
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  };

  const placePdf = async () => {
    if (!pending) return;
    try {
      setLoading(`Rendering page ${pending.page}…`);
      const r = await renderPdfPage(pending.doc, pending.page);
      const ratio = PDF_SCALES.find((s) => s.id === pending.scaleId)?.ratio;
      const base = pending.file.name.replace(/\.pdf$/i, '');
      onPlace({
        name: pending.doc.numPages > 1 ? `${base} p${pending.page}` : base,
        src: r.src,
        pixelWidth: r.pixelWidth,
        pixelHeight: r.pixelHeight,
        worldWidth: ratio ? pdfWorldWidth(r.pageWidthPoints, ratio) : undefined,
      });
      setPending(null);
    } catch (e) {
      onError(`Could not draw that PDF page (${e instanceof Error ? e.message : String(e)}).`);
    } finally {
      setLoading(null);
    }
  };

  const commitWidth = (t: TraceImage) => {
    const raw = widthDraft[t.id];
    if (raw === undefined) return;
    setWidthDraft(({ [t.id]: _, ...rest }) => rest);
    const v = parseLengthInput(raw, units);
    if (v === null || !(v > 0)) {
      if (raw.trim()) onError(`"${raw}" is not a length. Try 40' or 12'6" or 12000mm.`);
      return;
    }
    if (Math.abs(v - t.width) > 1e-6) onUpdate(t.id, { width: v, calibrated: true }, 'Trace Image Width');
  };

  const commitOpacity = (t: TraceImage) => {
    const v = opacityDraft[t.id];
    if (v === undefined) return;
    setOpacityDraft(({ [t.id]: _, ...rest }) => rest);
    onPreviewOpacity?.(t.id, null);
    if (Math.abs(v - t.opacity) > 1e-3) onUpdate(t.id, { opacity: v }, 'Trace Image Opacity');
  };

  const shell = darkMode ? 'bg-stone-900/95 border-stone-700 text-stone-100' : 'bg-white/95 border-stone-200 text-stone-800';
  const sub = darkMode ? 'text-stone-400' : 'text-stone-500';
  const btn = `inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
    darkMode ? 'border-stone-700 hover:bg-stone-800' : 'border-stone-200 hover:bg-stone-100'
  }`;
  const field = `w-full px-2 py-1 rounded border text-[11px] ${darkMode ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`;
  const totalKb = Math.round(images.reduce((s, t) => s + traceImageBytes(t), 0) / 1024);

  return (
    <div
      data-testid="trace-panel"
      role="dialog"
      aria-label="Trace a plan"
      className={`absolute top-[76px] left-3 z-30 w-72 max-h-[calc(100%-13rem)] overflow-y-auto rounded-lg border shadow-lg text-xs ${shell}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-inherit">
        <div>
          <div className="font-semibold">Trace a plan</div>
          <div className={`text-[10px] ${sub}`}>PDF or image under {levelName}</div>
        </div>
        <button type="button" aria-label="Close trace panel" onClick={onClose} className="p-1 rounded hover:bg-stone-500/15 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.pdf,application/pdf"
          className="hidden"
          data-testid="trace-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void handleFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!!loading}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
          {loading ?? 'Import PDF or image…'}
        </button>

        {pending && (
          <div className={`rounded-md border p-2 space-y-2 ${darkMode ? 'border-amber-700/60' : 'border-amber-300 bg-amber-50/60'}`} data-testid="trace-pdf-options">
            <div className="font-medium truncate" title={pending.file.name}>{pending.file.name}</div>
            <label className="block">
              <span className={`text-[10px] ${sub}`}>Page (of {pending.doc.numPages})</span>
              <input
                type="number"
                min={1}
                max={pending.doc.numPages}
                value={pending.page}
                onChange={(e) => setPending({ ...pending, page: Math.min(pending.doc.numPages, Math.max(1, Number(e.target.value) || 1)) })}
                className={field}
              />
            </label>
            <label className="block">
              <span className={`text-[10px] ${sub}`}>Drawing scale printed on the sheet</span>
              <select value={pending.scaleId} onChange={(e) => setPending({ ...pending, scaleId: e.target.value })} className={field} aria-label="PDF drawing scale">
                <option value="">Not sure / not to scale — I'll set it by clicking</option>
                {PDF_SCALES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => void placePdf()} disabled={!!loading} className="flex-1 px-2 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-60">
                Place page
              </button>
              <button type="button" onClick={() => setPending(null)} className={btn}>Cancel</button>
            </div>
          </div>
        )}

        {!images.length && !pending && (
          <ol className={`list-decimal pl-4 space-y-1 text-[11px] ${sub}`}>
            <li>Import a scan, photo or PDF of the plan.</li>
            <li><b>Set scale</b>: click both ends of a dimension you know, then type its real length.</li>
            <li><b>Move</b> it so a corner lands where you want, then draw walls over it.</li>
          </ol>
        )}

        {images.map((t) => {
          const op = opacityDraft[t.id] ?? t.opacity;
          const active = targetId === t.id && busyTool;
          return (
            <div key={t.id} data-testid="trace-item" className={`rounded-md border p-2 space-y-2 ${active ? 'border-amber-500 ring-1 ring-amber-500/50' : darkMode ? 'border-stone-700' : 'border-stone-200'}`}>
              <div className="flex items-center gap-2">
                <img src={t.src} alt="" className="w-10 h-10 object-cover rounded border border-stone-300/50 bg-white" />
                <input
                  value={t.name}
                  aria-label="Trace image name"
                  onChange={(e) => onUpdate(t.id, { name: e.target.value.slice(0, 80) }, 'Rename Trace Image')}
                  className={`${field} font-medium`}
                />
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className={btn} aria-label={t.visible ? 'Hide trace image' : 'Show trace image'} title={t.visible ? 'Hide' : 'Show'} onClick={() => onUpdate(t.id, { visible: !t.visible }, t.visible ? 'Hide Trace Image' : 'Show Trace Image')}>
                  {t.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                <button type="button" className={btn} aria-label={t.locked ? 'Unlock trace image' : 'Lock trace image'} title={t.locked ? 'Locked — click to unlock' : 'Lock so it cannot be moved or scaled'} onClick={() => onUpdate(t.id, { locked: !t.locked }, t.locked ? 'Unlock Trace Image' : 'Lock Trace Image')}>
                  {t.locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                </button>
                <button type="button" className={btn} aria-label="Zoom to trace image" title="Zoom to it" onClick={() => onZoomTo(t.id)}>
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <div className="flex-1" />
                <button type="button" className={btn} aria-label="Delete trace image" title="Delete" onClick={() => onDelete(t.id)}>
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </button>
              </div>
              <div className="flex gap-1">
                <button type="button" className={`${btn} flex-1 justify-center`} disabled={t.locked} onClick={() => onStartScale(t.id)} data-testid="trace-set-scale">
                  <Ruler className="w-3.5 h-3.5" /> Set scale
                </button>
                <button type="button" className={`${btn} flex-1 justify-center`} disabled={t.locked} onClick={() => onStartMove(t.id)} data-testid="trace-move">
                  <Move className="w-3.5 h-3.5" /> Move
                </button>
              </div>
              {onAutoTrace &&
                (autoTracing?.id === t.id ? (
                  <div className="flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/40 px-2 py-1.5 text-[11px]" role="status" data-testid="auto-trace-busy">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                    <span className="flex-1">{autoTracing.engine} is reading the plan… (20–90 s)</span>
                    <button type="button" className={btn} onClick={onCancelAutoTrace} aria-label="Stop automatic tracing">
                      <Square className="w-3 h-3" /> Stop
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="auto-trace"
                    disabled={!!autoTracing}
                    onClick={() => onAutoTrace(t.id)}
                    title="AI draws the walls, doors, windows and rooms on top of this image, at its scale"
                    className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-stone-900 hover:bg-stone-800 dark:bg-amber-600 dark:hover:bg-amber-700 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Auto-trace walls, doors & rooms
                  </button>
                ))}
              {onAutoTrace && !t.calibrated && autoTracing?.id !== t.id && (
                <p className={`text-[10px] leading-snug ${sub}`}>Scale not set yet: set it first, or Auto-trace uses a dimension it can read on the plan.</p>
              )}
              <label className="flex items-center gap-2">
                <span className={`w-14 text-[10px] ${sub}`}>Width</span>
                <input
                  aria-label="Trace image width"
                  disabled={t.locked}
                  value={widthDraft[t.id] ?? formatLength(t.width, units)}
                  onChange={(e) => setWidthDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                  onBlur={() => commitWidth(t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitWidth(t);
                    if (e.key === 'Escape') setWidthDraft(({ [t.id]: _, ...rest }) => rest);
                    e.stopPropagation();
                  }}
                  className={field}
                />
              </label>
              <label className="flex items-center gap-2">
                <span className={`w-14 text-[10px] ${sub}`}>Fade</span>
                <input
                  type="range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  aria-label="Trace image opacity"
                  value={op}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setOpacityDraft((d) => ({ ...d, [t.id]: v }));
                    onPreviewOpacity?.(t.id, v);
                  }}
                  onPointerUp={() => commitOpacity(t)}
                  onKeyUp={() => commitOpacity(t)}
                  onBlur={() => commitOpacity(t)}
                  className="flex-1 accent-amber-600"
                />
                <span className="w-8 text-right tabular-nums">{Math.round(op * 100)}%</span>
              </label>
            </div>
          );
        })}

        {images.length > 0 && (
          <p className={`text-[10px] leading-snug ${sub}`}>
            Trace images are saved with the project ({totalKb.toLocaleString()} KB) and never print or export. Large scans may be too big for the browser's
            autosave — use <b>Save Project (.json)</b> to keep them.
          </p>
        )}
      </div>
    </div>
  );
};
