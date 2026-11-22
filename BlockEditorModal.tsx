/**
 * BLOCK EDITOR (BE / BEDIT)
 * Edit a block's name, size, color and 2D symbol: move / resize shapes, copy and mirror them,
 * and create, duplicate or delete blocks. Every placed copy updates when you save.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Plus, Trash2, Check, Boxes, Copy, FlipHorizontal2, FlipVertical2, Square, Circle as CircleIcon, Minus,
  Crosshair, Maximize2, Spline,
} from 'lucide-react';
import type { ArchEntity, BlockCategory, BlockDefinition, UnitSystem } from '../types/model';
import { describeSvgArc, formatLength, parseLengthInput } from '../engine/geometry';
import {
  BLOCK_CATEGORIES, centerShapes, copyShape, duplicateBlock, moveShape, newCustomBlock, newId,
  removeShape, shapeBounds, shapesExtent,
} from '../engine/blockLibrary';

interface BlockEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  blocks: BlockDefinition[];
  initialBlockId?: string | null;
  units: UnitSystem;
  onSaveBlock: (updatedBlock: BlockDefinition) => void;
  darkMode: boolean;
  /** adds a new block definition (New / Duplicate) */
  onCreateBlock?: (block: BlockDefinition) => void;
  /** deletes a block definition and its placed copies */
  onDeleteBlock?: (blockId: string) => void;
  /** how many placed copies use the block */
  usageCount?: (blockId: string) => number;
  /** bumped by the Library's "New block" button: start a new custom block on open */
  newBlockSignal?: number;
}

const COLOR_SWATCHES = ['#0d9488', '#6366f1', '#b45309', '#8a5a33', '#5b3a22', '#0284c7', '#78716c', '#334155', '#15803d', '#dc2626', '#f8fafc', '#1f1f1f'];

/** Length text box in project units; commits on Enter / blur. */
function LenField({ label, value, units, onChange, min, darkMode, ariaLabel }: { label: string; value: number; units: UnitSystem; onChange: (v: number) => void; min?: number; darkMode: boolean; ariaLabel?: string }) {
  const [text, setText] = useState(formatLength(value, units));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(formatLength(value, units));
  }, [value, units, focused]);
  const commit = () => {
    const v = parseLengthInput(text, units);
    if (v === null || !Number.isFinite(v)) {
      setText(formatLength(value, units));
      return;
    }
    const clamped = min !== undefined ? Math.max(min, v) : v;
    if (Math.abs(clamped - value) > 1e-6) onChange(clamped);
    setText(formatLength(clamped, units));
  };
  return (
    <label className="block min-w-0">
      <span className="block text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-400 mb-0.5">{label}</span>
      <input
        type="text"
        value={text}
        aria-label={ariaLabel ?? label}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`w-full px-2 py-1 text-xs font-mono rounded-md border focus:outline-none focus:border-amber-600 ${darkMode ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-white border-stone-300 text-stone-900'}`}
      />
    </label>
  );
}

const shapeLabel = (e: ArchEntity) =>
  e.type === 'rectangle' ? 'Rectangle' : e.type === 'circle' ? 'Circle' : e.type === 'line' ? 'Line' : e.type === 'arc' ? 'Arc' : e.type === 'polyline' ? (e.closed ? 'Polygon' : 'Polyline') : e.type;

export const BlockEditorModal: React.FC<BlockEditorModalProps> = ({
  isOpen, onClose, blocks, initialBlockId, units, onSaveBlock, darkMode, onCreateBlock, onDeleteBlock, usageCount, newBlockSignal,
}) => {
  const [draft, setDraft] = useState<BlockDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scaleShapes, setScaleShapes] = useState(true);

  const load = (b: BlockDefinition) => {
    setDraft(JSON.parse(JSON.stringify(b)) as BlockDefinition);
    setDirty(false);
    setSelId(null);
    setConfirmDelete(false);
  };

  useEffect(() => {
    if (!isOpen || blocks.length === 0) return;
    if (pendingId && !blocks.some((b) => b.id === pendingId)) return; // new block not committed yet
    const want = pendingId ?? initialBlockId;
    const target = blocks.find((b) => b.id === want) || blocks.find((b) => b.id === draft?.id) || blocks[0];
    if (pendingId && blocks.some((b) => b.id === pendingId)) setPendingId(null);
    if (target && (!draft || target.id !== draft.id || pendingId)) load(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialBlockId, blocks.length, pendingId]);

  useEffect(() => {
    if (!isOpen) {
      setDraft(null);
      setDirty(false);
    }
  }, [isOpen]);

  const lastSignal = React.useRef(newBlockSignal ?? 0);
  useEffect(() => {
    if (!isOpen || !onCreateBlock || !newBlockSignal || newBlockSignal === lastSignal.current) return;
    lastSignal.current = newBlockSignal;
    const b = newCustomBlock('New Block');
    const names = new Set(blocks.map((x) => x.name));
    let n = 1;
    while (names.has(b.name)) b.name = `New Block ${++n}`;
    onCreateBlock(b);
    setPendingId(b.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newBlockSignal, isOpen]);

  const isCustom = draft?.kind === 'custom' && !draft?.libKind;
  const sel = draft?.entities.find((e) => e.id === selId) ?? null;
  const used = draft && usageCount ? usageCount(draft.id) : 0;

  const viewBox = useMemo(() => {
    if (!draft) return '-30 -30 60 60';
    const bs = draft.entities.map(shapeBounds).filter(Boolean) as Array<NonNullable<ReturnType<typeof shapeBounds>>>;
    const minX = Math.min(-draft.width / 2, ...bs.map((b) => b.minX));
    const maxX = Math.max(draft.width / 2, ...bs.map((b) => b.maxX));
    const minY = Math.min(-draft.depth / 2, ...bs.map((b) => b.minY));
    const maxY = Math.max(draft.depth / 2, ...bs.map((b) => b.maxY));
    const span = Math.max(maxX - minX, maxY - minY, 24) * 1.15;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return `${cx - span / 2} ${cy - span / 2} ${span} ${span}`;
  }, [draft]);

  if (!isOpen || blocks.length === 0 || !draft) return null;
  const span = parseFloat(viewBox.split(' ')[2]) || 60;

  const update = (next: BlockDefinition) => {
    setDraft(next);
    setDirty(true);
  };
  const updateShape = (id: string, fn: (e: ArchEntity) => ArchEntity) => update({ ...draft, entities: draft.entities.map((e) => (e.id === id ? fn(e) : e)) });

  const setSize = (key: 'width' | 'depth' | 'height', v: number) => {
    let next = { ...draft, [key]: v };
    if (key !== 'height' && scaleShapes) {
      const sx = key === 'width' ? v / draft.width : 1;
      const sy = key === 'depth' ? v / draft.depth : 1;
      next = {
        ...next,
        entities: draft.entities.map((e) => {
          if (e.type === 'rectangle') return { ...e, p1: { x: e.p1.x * sx, y: e.p1.y * sy }, p2: { x: e.p2.x * sx, y: e.p2.y * sy } };
          if (e.type === 'line') return { ...e, start: { x: e.start.x * sx, y: e.start.y * sy }, end: { x: e.end.x * sx, y: e.end.y * sy } };
          if (e.type === 'polyline') return { ...e, points: e.points.map((p) => ({ x: p.x * sx, y: p.y * sy })) };
          if (e.type === 'circle' || e.type === 'arc') return { ...e, center: { x: e.center.x * sx, y: e.center.y * sy }, radius: e.radius * Math.sqrt(sx * sy) };
          return e;
        }),
      };
    }
    update(next);
  };

  const addShape = (kind: 'rectangle' | 'circle' | 'line') => {
    const id = newId('shape');
    const hw = Math.round(draft.width * 0.3);
    const hd = Math.round(draft.depth * 0.3);
    const ent: ArchEntity =
      kind === 'rectangle'
        ? { id, type: 'rectangle', layer: '0', p1: { x: -hw, y: -hd }, p2: { x: hw, y: hd } }
        : kind === 'circle'
          ? { id, type: 'circle', layer: '0', center: { x: 0, y: 0 }, radius: Math.max(2, Math.round(Math.min(draft.width, draft.depth) * 0.2)) }
          : { id, type: 'line', layer: '0', start: { x: -hw, y: 0 }, end: { x: hw, y: 0 } };
    update({ ...draft, entities: [...draft.entities, ent] });
    setSelId(id);
  };

  const save = (close: boolean) => {
    onSaveBlock(draft);
    setDirty(false);
    if (close) onClose();
  };

  const createNew = () => {
    if (!onCreateBlock) return;
    const b = newCustomBlock('New Block');
    const names = new Set(blocks.map((x) => x.name));
    let n = 1;
    while (names.has(b.name)) b.name = `New Block ${++n}`;
    onCreateBlock(b);
    setPendingId(b.id);
  };
  const duplicate = () => {
    if (!onCreateBlock) return;
    const b = duplicateBlock(draft, blocks);
    onCreateBlock(b);
    setPendingId(b.id);
  };

  const inputCls = `w-full px-2 py-1 text-xs rounded-md border focus:outline-none focus:border-amber-600 ${darkMode ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-white border-stone-300 text-stone-900'}`;
  const btn = `inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${darkMode ? 'border-stone-700 hover:bg-stone-800 text-stone-200' : 'border-stone-300 hover:bg-stone-100 text-stone-700'}`;
  const card = `rounded-lg border ${darkMode ? 'border-stone-800 bg-stone-950/40' : 'border-stone-200 bg-stone-50/60'}`;
  const muted = 'text-stone-500 dark:text-stone-400';

  const strokeW = span * 0.008;
  const renderShape = (ent: ArchEntity) => {
    const selected = ent.id === selId;
    const col = selected ? '#f59e0b' : draft.color;
    const common = {
      stroke: col,
      strokeWidth: selected ? strokeW * 2.4 : strokeW * 1.4,
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        setSelId(ent.id);
      },
      style: { cursor: 'pointer' },
    };
    const fill = selected ? `${col}22` : 'transparent';
    if (ent.type === 'rectangle') {
      const x = Math.min(ent.p1.x, ent.p2.x);
      const y = Math.min(ent.p1.y, ent.p2.y);
      return <rect key={ent.id} x={x} y={y} width={Math.abs(ent.p2.x - ent.p1.x)} height={Math.abs(ent.p2.y - ent.p1.y)} fill={fill} {...common} />;
    }
    if (ent.type === 'circle') return <circle key={ent.id} cx={ent.center.x} cy={ent.center.y} r={ent.radius} fill={fill} {...common} />;
    if (ent.type === 'line') return <line key={ent.id} x1={ent.start.x} y1={ent.start.y} x2={ent.end.x} y2={ent.end.y} {...common} />;
    if (ent.type === 'arc') return <path key={ent.id} d={describeSvgArc(ent.center, ent.radius, ent.startAngle, ent.endAngle)} fill="none" {...common} />;
    if (ent.type === 'polyline')
      return ent.closed ? (
        <polygon key={ent.id} points={ent.points.map((p) => `${p.x},${p.y}`).join(' ')} fill={fill} {...common} />
      ) : (
        <polyline key={ent.id} points={ent.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" {...common} />
      );
    return null;
  };

  // ---- selected shape editor
  const shapeEditor = (ent: ArchEntity) => {
    const b = shapeBounds(ent)!;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const L = (label: string, value: number, onChange: (v: number) => void, min?: number) => (
      <LenField key={`${ent.id}-${label}`} label={label} value={value} units={units} onChange={onChange} min={min} darkMode={darkMode} ariaLabel={`${shapeLabel(ent)} ${label}`} />
    );
    const geo: React.ReactNode[] = [];
    if (ent.type === 'rectangle') {
      const w = b.maxX - b.minX;
      const d = b.maxY - b.minY;
      const setRect = (ncx: number, ncy: number, nw: number, nd: number) =>
        updateShape(ent.id, (e) => ({ ...(e as typeof ent), p1: { x: ncx - nw / 2, y: ncy - nd / 2 }, p2: { x: ncx + nw / 2, y: ncy + nd / 2 } }));
      geo.push(L('Center X', cx, (v) => setRect(v, cy, w, d)), L('Center Y', cy, (v) => setRect(cx, v, w, d)), L('Width', w, (v) => setRect(cx, cy, v, d), 0.25), L('Depth', d, (v) => setRect(cx, cy, w, v), 0.25));
    } else if (ent.type === 'circle' || ent.type === 'arc') {
      geo.push(
        L('Center X', ent.center.x, (v) => updateShape(ent.id, (e) => ({ ...(e as typeof ent), center: { x: v, y: ent.center.y } }))),
        L('Center Y', ent.center.y, (v) => updateShape(ent.id, (e) => ({ ...(e as typeof ent), center: { x: ent.center.x, y: v } }))),
        L('Radius', ent.radius, (v) => updateShape(ent.id, (e) => ({ ...(e as typeof ent), radius: v })), 0.25),
      );
    } else if (ent.type === 'line') {
      const set = (k: 'start' | 'end', axis: 'x' | 'y', v: number) => updateShape(ent.id, (e) => ({ ...(e as typeof ent), [k]: { ...(e as typeof ent)[k], [axis]: v } }));
      geo.push(L('Start X', ent.start.x, (v) => set('start', 'x', v)), L('Start Y', ent.start.y, (v) => set('start', 'y', v)), L('End X', ent.end.x, (v) => set('end', 'x', v)), L('End Y', ent.end.y, (v) => set('end', 'y', v)));
    } else if (ent.type === 'polyline') {
      geo.push(L('Center X', cx, (v) => updateShape(ent.id, (e) => moveShape(e, v - cx, 0))), L('Center Y', cy, (v) => updateShape(ent.id, (e) => moveShape(e, 0, v - cy))));
    }
    return (
      <div className={`${card} p-3 space-y-3`} aria-label="Selected shape">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold mr-auto">{shapeLabel(ent)}</span>
          <button type="button" className={btn} onClick={() => { const r = copyShape(draft, ent.id); update(r.block); setSelId(r.newId); }} title="Copy this shape"><Copy className="w-3 h-3" /> Copy</button>
          <button type="button" className={btn} onClick={() => { const r = copyShape(draft, ent.id, 'x'); update(r.block); setSelId(r.newId); }} title="Mirrored copy, left ↔ right"><FlipHorizontal2 className="w-3 h-3" /> Mirror ↔</button>
          <button type="button" className={btn} onClick={() => { const r = copyShape(draft, ent.id, 'y'); update(r.block); setSelId(r.newId); }} title="Mirrored copy, front ↔ back"><FlipVertical2 className="w-3 h-3" /> Mirror ↕</button>
          <button type="button" className={`${btn} hover:!text-red-600`} disabled={draft.entities.length <= 1} onClick={() => { update(removeShape(draft, ent.id)); setSelId(null); }} title="Delete this shape"><Trash2 className="w-3 h-3" /> Delete</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{geo}</div>
        {isCustom ? (
          <p className={`text-[11px] ${muted}`}>In 3D, rectangles and circles become full-height solids in the block color; lines and arcs stay 2D.</p>
        ) : (
          <p className={`text-[11px] ${muted}`}>This block has a built-in 3D model; shapes here only change its 2D plan symbol.</p>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-xs" role="dialog" aria-modal="true" aria-labelledby="bedit-modal-title">
      <div className={`w-full max-w-5xl rounded-xl border shadow-2xl overflow-hidden flex flex-col max-h-[94vh] ${darkMode ? 'bg-stone-900 border-stone-700 text-stone-100' : 'bg-white border-stone-200 text-stone-900'}`}>
        {/* Header */}
        <div className={`px-5 py-3 border-b flex items-start gap-2 ${darkMode ? 'border-stone-800' : 'border-stone-200'}`}>
          <Boxes className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="flex-1 flex flex-wrap items-center gap-2 min-w-0">
          <div className="mr-auto min-w-0">
            <h2 id="bedit-modal-title" className="text-sm font-bold">Block Editor (BE / BEDIT)</h2>
            <p className={`text-[11px] ${muted}`}>2D symbol · placed copies update on save</p>
          </div>
          <select
            value={draft.id}
            aria-label="Block to edit"
            onChange={(e) => {
              const found = blocks.find((b) => b.id === e.target.value);
              if (found) load(found);
            }}
            className={`${inputCls} !w-auto max-w-[240px] font-medium`}
          >
            {blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.category})
              </option>
            ))}
          </select>
          {onCreateBlock && (
            <>
              <button type="button" className={btn} onClick={createNew} title="Start a new custom block"><Plus className="w-3.5 h-3.5" /> New</button>
              <button type="button" className={btn} onClick={duplicate} title="Duplicate this block"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
            </>
          )}
          {onDeleteBlock && (
            <button type="button" className={`${btn} hover:!text-red-600`} onClick={() => setConfirmDelete(true)} title="Delete this block" disabled={blocks.length <= 1}><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          )}
          </div>
          <button type="button" onClick={onClose} className={`p-1.5 rounded-lg shrink-0 ${muted} hover:bg-stone-500/10`} aria-label="Close Block Editor"><X className="w-4 h-4" /></button>
        </div>

        {confirmDelete && onDeleteBlock && (
          <div className="px-5 py-2.5 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-900 text-xs flex flex-wrap items-center gap-2" role="alert">
            <span className="mr-auto">
              Delete <b>{draft.name}</b>{used ? <> and its <b>{used}</b> placed {used === 1 ? 'copy' : 'copies'}</> : ''}? You can undo with Ctrl+Z.
            </span>
            <button type="button" className={btn} onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button type="button" className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold" onClick={() => { onDeleteBlock(draft.id); setConfirmDelete(false); setDraft(null); }}>
              Delete block
            </button>
          </div>
        )}

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* properties */}
          <div className="grid grid-cols-2 md:grid-cols-[2fr_1.3fr_1fr_1fr_1fr_1.6fr] gap-3 items-end">
            <label className="block col-span-2 md:col-span-1">
              <span className={`block text-[10px] uppercase tracking-wide mb-0.5 ${muted}`}>Name</span>
              <input type="text" aria-label="Block name" value={draft.name} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => update({ ...draft, name: e.target.value })} className={inputCls} />
            </label>
            <label className="block">
              <span className={`block text-[10px] uppercase tracking-wide mb-0.5 ${muted}`}>Category</span>
              <select aria-label="Block category" value={draft.category} onChange={(e) => update({ ...draft, category: e.target.value as BlockCategory })} className={inputCls}>
                {[...new Set([draft.category, ...BLOCK_CATEGORIES])].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <LenField label="Width (X)" value={draft.width} units={units} min={1} onChange={(v) => setSize('width', v)} darkMode={darkMode} />
            <LenField label="Depth (Y)" value={draft.depth} units={units} min={1} onChange={(v) => setSize('depth', v)} darkMode={darkMode} />
            <LenField label="Height (Z)" value={draft.height} units={units} min={1} onChange={(v) => setSize('height', v)} darkMode={darkMode} />
            <label className="block">
              <span className={`block text-[10px] uppercase tracking-wide mb-0.5 ${muted}`}>Block color</span>
              <div className="flex items-center gap-1 flex-wrap">
                <input type="color" aria-label="Block color" value={draft.color} onChange={(e) => update({ ...draft, color: e.target.value })} className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0 shrink-0" />
                {COLOR_SWATCHES.slice(0, 6).map((sw) => (
                  <button key={sw} type="button" onClick={() => update({ ...draft, color: sw })} style={{ backgroundColor: sw }} className={`w-4 h-4 rounded-sm border cursor-pointer ${draft.color.toLowerCase() === sw ? 'ring-2 ring-amber-500 border-white' : 'border-black/20'}`} title={`Color ${sw}`} aria-label={`Block color ${sw}`} />
                ))}
              </div>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={scaleShapes} onChange={(e) => setScaleShapes(e.target.checked)} className="accent-amber-600" />
              Stretch shapes when width / depth change
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <span className={muted}>Description:</span>
              <input type="text" aria-label="Block description" value={draft.description ?? ''} placeholder="maker, model no., notes" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => update({ ...draft, description: e.target.value || undefined })} className={`${inputCls} !w-72 !py-0.5`} />
            </label>
          </div>

          {/* 2D symbol + shapes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${muted}`}>2D plan symbol <span className="font-normal">(click a shape to edit it)</span></span>
                <div className="flex gap-1">
                  <button type="button" className={btn} title="Move all shapes so they are centered on the insertion point" onClick={() => update(centerShapes(draft))}><Crosshair className="w-3 h-3" /> Center</button>
                  <button
                    type="button"
                    className={btn}
                    title="Set width and depth to wrap the shapes"
                    onClick={() => {
                      const ex = shapesExtent(draft);
                      if (ex) update({ ...draft, width: Math.round(ex.width * 100) / 100, depth: Math.round(ex.depth * 100) / 100 });
                    }}
                  >
                    <Maximize2 className="w-3 h-3" /> Fit size
                  </button>
                </div>
              </div>
              <div className={`${card} aspect-[4/3] flex items-center justify-center overflow-hidden`} onClick={() => setSelId(null)}>
                <svg viewBox={viewBox} className="w-full h-full" aria-label="2D symbol preview">
                  <line x1={-span} y1={0} x2={span} y2={0} stroke={darkMode ? '#44403c' : '#d6d3d1'} strokeWidth={strokeW * 0.8} />
                  <line x1={0} y1={-span} x2={0} y2={span} stroke={darkMode ? '#44403c' : '#d6d3d1'} strokeWidth={strokeW * 0.8} />
                  <rect x={-draft.width / 2} y={-draft.depth / 2} width={draft.width} height={draft.depth} fill="none" stroke="#d97706" strokeDasharray={`${span * 0.02} ${span * 0.012}`} strokeWidth={strokeW} opacity={0.6} />
                  {draft.entities.filter((e) => e.id !== selId).map(renderShape)}
                  {sel && renderShape(sel)}
                  <text x={0} y={draft.depth / 2 + span * 0.06} textAnchor="middle" fontSize={span * 0.035} fill={darkMode ? '#a8a29e' : '#78716c'}>front</text>
                </svg>
              </div>
            </div>
            {/* shapes */}
            <div className="flex flex-col gap-2 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold mr-2">Shapes ({draft.entities.length})</span>
              <button type="button" className={btn} onClick={() => addShape('rectangle')}><Square className="w-3 h-3" /> Rectangle</button>
              <button type="button" className={btn} onClick={() => addShape('circle')}><CircleIcon className="w-3 h-3" /> Circle</button>
              <button type="button" className={btn} onClick={() => addShape('line')}><Minus className="w-3 h-3" /> Line</button>
            </div>
            <div className="flex flex-col gap-3">
              <ul className={`${card} max-h-64 overflow-y-auto divide-y ${darkMode ? 'divide-stone-800' : 'divide-stone-200'}`} aria-label="Shapes">
                {draft.entities.map((ent, i) => {
                  const b = shapeBounds(ent);
                  return (
                    <li key={ent.id}>
                      <button type="button" onClick={() => setSelId(ent.id)} aria-current={ent.id === selId} className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs ${ent.id === selId ? 'bg-amber-100/70 dark:bg-amber-900/30' : 'hover:bg-stone-500/5'}`}>
                        <span className="font-medium">{i + 1}. {shapeLabel(ent)}</span>
                        {b && <span className={`font-mono text-[10px] ${muted}`}>{formatLength(b.maxX - b.minX, units)} × {formatLength(b.maxY - b.minY, units)}</span>}
                        <span className={`ml-auto text-[10px] ${muted}`}>
                          {ent.type === 'polyline' || ent.type === 'line' || ent.type === 'arc' ? <Spline className="w-3 h-3 inline" /> : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {sel ? shapeEditor(sel) : (
                <div className={`${card} p-4 text-xs ${muted} flex items-center`}>
                  {isCustom
                    ? 'Pick a shape (in the list or the drawing) to move, resize, copy or mirror it.'
                    : 'Pick a shape to move or resize it. This block has a built-in 3D model, so shapes only change its 2D symbol.'}
                </div>
              )}
            </div>
          </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`px-5 py-3 border-t flex items-center gap-2 ${darkMode ? 'border-stone-800 bg-stone-950/40' : 'border-stone-200 bg-stone-50'}`}>
          <span className={`text-[11px] mr-auto ${dirty ? 'text-amber-600 font-medium' : muted}`}>
            {dirty ? '● Unsaved changes' : used ? `${used} placed ${used === 1 ? 'copy' : 'copies'} in this project` : 'Not placed yet'}
          </span>
          <button type="button" onClick={onClose} className={btn}>Cancel</button>
          <button type="button" onClick={() => save(false)} disabled={!dirty} className={btn}>Apply</button>
          <button type="button" onClick={() => save(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold">
            <Check className="w-3.5 h-3.5" /> Save &amp; close
          </button>
        </div>
      </div>
    </div>
  );
};
