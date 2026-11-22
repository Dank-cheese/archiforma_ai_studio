import React, { useEffect, useMemo, useState } from 'react';
import { Check, MousePointerClick, Plus, RotateCw, Trash2, X, AlertTriangle } from 'lucide-react';
import type { UnitSystem, WallType } from '../types/model';
import { formatLength, parseLengthInput } from '../engine/geometry';
import {
  autoClose, closureGap, lShapeSpec, newFeature, newSide, rectangleSpec, sideCorners,
  type FeatureKind, type RoomSide, type RoomSpec, type SideFeature,
} from '../engine/roomBuilder';

interface Props {
  spec: RoomSpec;
  onChange: (spec: RoomSpec) => void;
  anchor: number;
  onAnchor: (i: number) => void;
  rotation: number;
  onRotate: () => void;
  wallTypes: WallType[];
  wallTypeId: string;
  onWallType: (id: string) => void;
  units: UnitSystem;
  darkMode: boolean;
  placing: boolean;
  onPlace: () => void;
  onError: (msg: string) => void;
  onClose: () => void;
}

const FEATURE_LABEL: Record<FeatureKind, string> = { window: 'Window', door: 'Door', opening: 'Opening', gap: 'Gap (no wall)' };
const FEATURE_COLOR: Record<FeatureKind, string> = { window: '#0284c7', door: '#b45309', opening: '#57534e', gap: '#dc2626' };
const TURNS: Array<{ v: number; label: string }> = [
  { v: 90, label: 'then turn right' },
  { v: -90, label: 'then turn left' },
  { v: 45, label: 'then right 45°' },
  { v: -45, label: 'then left 45°' },
  { v: 0, label: 'then straight on' },
];
const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];

/** Length text box: shows the formatted length, parses feet-inches / metric on Enter or blur. */
const LenInput: React.FC<{
  value: number | null;
  units: UnitSystem;
  placeholder?: string;
  className: string;
  label: string;
  onCommit: (v: number | null) => void;
  onError: (msg: string) => void;
  allowBlank?: boolean;
}> = ({ value, units, placeholder, className, label, onCommit, onError, allowBlank }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? '' : formatLength(value, units));
  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    if (!raw) {
      if (allowBlank) onCommit(null);
      return;
    }
    const v = parseLengthInput(raw, units);
    if (v === null || !(v > 0)) {
      onError(`"${raw}" is not a length. Try 12', 12'6", 150", 3.6m or 3600mm.`);
      return;
    }
    onCommit(Math.round(v * 100) / 100);
  };
  return (
    <input
      aria-label={label}
      value={shown}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
      className={className}
    />
  );
};

export const RoomBuilderPanel: React.FC<Props> = ({
  spec, onChange, anchor, onAnchor, rotation, onRotate, wallTypes, wallTypeId, onWallType, units, darkMode, placing, onPlace, onError, onClose,
}) => {
  const metric = units === 'metric';
  const [quick, setQuick] = useState<{ shape: 'rect' | 'l'; w: number; d: number; nw: number; nd: number }>(() =>
    metric ? { shape: 'rect', w: 3600 / 25.4, d: 3000 / 25.4, nw: 1500 / 25.4, nd: 1200 / 25.4 } : { shape: 'rect', w: 144, d: 120, nw: 60, nd: 48 }
  );
  const gap = closureGap(spec.sides);
  const closed = spec.sides.length >= 3 && gap < 0.5;
  const corners = useMemo(() => sideCorners(spec.sides), [spec.sides]);

  useEffect(() => {
    if (anchor >= spec.sides.length && spec.sides.length) onAnchor(0);
  }, [anchor, spec.sides.length, onAnchor]);

  const setSide = (i: number, patch: Partial<RoomSide>) => onChange({ ...spec, sides: spec.sides.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const setFeature = (i: number, fid: string, patch: Partial<SideFeature>) =>
    setSide(i, { features: spec.sides[i].features.map((f) => (f.id === fid ? { ...f, ...patch } : f)) });

  const headings = spec.sides.reduce<number[]>((acc, s, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + spec.sides[i - 1].turn);
    return acc;
  }, []);
  const arrow = (h: number) => ARROWS[((Math.round(h / 45) % 8) + 8) % 8];

  // preview geometry (local coordinates)
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 60);
  const pad = span * 0.14;
  const vb = `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`;
  const sw = span / 90;

  const shell = darkMode ? 'bg-stone-900/95 border-stone-700 text-stone-100' : 'bg-white/95 border-stone-200 text-stone-800';
  const sub = darkMode ? 'text-stone-400' : 'text-stone-500';
  const field = `px-1.5 py-1 rounded border text-[11px] min-w-0 ${darkMode ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`;
  const chip = `inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] font-medium cursor-pointer ${darkMode ? 'border-stone-700 hover:bg-stone-800' : 'border-stone-200 hover:bg-stone-100'}`;

  return (
    <div
      data-testid="room-builder"
      role="dialog"
      aria-label="Room builder"
      className={`absolute top-[76px] left-3 z-30 w-80 max-h-[calc(100%-13rem)] overflow-y-auto rounded-lg border shadow-lg text-xs ${shell}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className={`sticky top-0 z-10 flex items-center justify-between px-3 py-2 border-b ${darkMode ? 'bg-stone-900 border-stone-700' : 'bg-white border-stone-200'}`}>
        <div>
          <div className="font-semibold">Room builder</div>
          <div className={`text-[10px] ${sub}`}>Describe the sides, then drop it on the plan</div>
        </div>
        <button type="button" aria-label="Close room builder" onClick={onClose} className="p-1 rounded hover:bg-stone-500/15 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        <label className="block">
          <span className={`text-[10px] ${sub}`}>Room name</span>
          <input aria-label="Room name" value={spec.name} onChange={(e) => onChange({ ...spec, name: e.target.value.slice(0, 60) })} onKeyDown={(e) => e.stopPropagation()} className={`${field} w-full`} />
        </label>

        {/* quick start */}
        <div className={`rounded-md border p-2 space-y-1.5 ${darkMode ? 'border-stone-700' : 'border-stone-200'}`}>
          <div className="flex items-center gap-2">
            <span className="font-medium">Start from</span>
            <select aria-label="Starting shape" value={quick.shape} onChange={(e) => setQuick({ ...quick, shape: e.target.value as 'rect' | 'l' })} className={field}>
              <option value="rect">Rectangle</option>
              <option value="l">L-shape</option>
            </select>
          </div>
          <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1">
            <span className={sub}>W</span>
            <LenInput label="Quick width" value={quick.w} units={units} className={field} onCommit={(v) => v && setQuick({ ...quick, w: v })} onError={onError} />
            <span className={sub}>D</span>
            <LenInput label="Quick depth" value={quick.d} units={units} className={field} onCommit={(v) => v && setQuick({ ...quick, d: v })} onError={onError} />
            {quick.shape === 'l' && (
              <>
                <span className={sub} title="Notch width (cut from the bottom-right corner)">nW</span>
                <LenInput label="Notch width" value={quick.nw} units={units} className={field} onCommit={(v) => v && setQuick({ ...quick, nw: v })} onError={onError} />
                <span className={sub} title="Notch depth">nD</span>
                <LenInput label="Notch depth" value={quick.nd} units={units} className={field} onCommit={(v) => v && setQuick({ ...quick, nd: v })} onError={onError} />
              </>
            )}
          </div>
          <button
            type="button"
            className={`${chip} w-full justify-center py-1`}
            onClick={() => {
              if (quick.shape === 'l' && (quick.nw >= quick.w || quick.nd >= quick.d)) {
                onError('The notch must be smaller than the room.');
                return;
              }
              const next = quick.shape === 'rect' ? rectangleSpec(spec.name, quick.w, quick.d) : lShapeSpec(spec.name, quick.w, quick.d, quick.nw, quick.nd);
              onChange(next);
              onAnchor(0);
            }}
          >
            Set sides ({quick.shape === 'rect' ? '4' : '6'})
          </button>
        </div>

        {/* preview */}
        <div className={`rounded-md border ${darkMode ? 'border-stone-700 bg-stone-950' : 'border-stone-200 bg-stone-50'}`}>
          <svg viewBox={vb} className="w-full h-36" aria-label="Room shape preview">
            {closed && <polygon points={corners.slice(0, -1).map((c) => `${c.x},${c.y}`).join(' ')} fill="#d97706" fillOpacity={0.08} />}
            {spec.sides.map((s, i) => {
              const a = corners[i];
              const b = corners[i + 1];
              const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
              const ux = (b.x - a.x) / L;
              const uy = (b.y - a.y) / L;
              const mx = (a.x + b.x) / 2 - uy * sw * 5;
              const my = (a.y + b.y) / 2 + ux * sw * 5;
              return (
                <g key={s.id}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={darkMode ? '#e7e5e4' : '#292524'} strokeWidth={sw * 2} />
                  {s.features.map((f) => {
                    const w = Math.min(f.width, L);
                    const c = f.at === null ? L / 2 : Math.min(Math.max(f.at, w / 2), L - w / 2);
                    return (
                      <line key={f.id} x1={a.x + ux * (c - w / 2)} y1={a.y + uy * (c - w / 2)} x2={a.x + ux * (c + w / 2)} y2={a.y + uy * (c + w / 2)} stroke={FEATURE_COLOR[f.kind]} strokeWidth={sw * 4} />
                    );
                  })}
                  <text x={mx} y={my} fontSize={sw * 9} textAnchor="middle" dominantBaseline="middle" fill="#b45309" fontWeight={700}>{i + 1}</text>
                </g>
              );
            })}
            {!closed && corners.length > 1 && (
              <line x1={corners[corners.length - 1].x} y1={corners[corners.length - 1].y} x2={0} y2={0} stroke="#dc2626" strokeWidth={sw} strokeDasharray={`${sw * 3},${sw * 2}`} />
            )}
            {corners.slice(0, spec.sides.length).map((c, i) => (
              <circle
                key={i}
                cx={c.x}
                cy={c.y}
                r={sw * (i === anchor ? 5 : 3)}
                fill={i === anchor ? '#d97706' : '#fff'}
                stroke="#d97706"
                strokeWidth={sw}
                className="cursor-pointer"
                onClick={() => onAnchor(i)}
              >
                <title>{i === anchor ? 'Corner you hold when placing' : 'Hold this corner when placing'}</title>
              </circle>
            ))}
          </svg>
          <div className={`flex items-center justify-between px-2 pb-1.5 text-[10px] ${sub}`}>
            <span>Orange dot = corner you hold (click a dot to change)</span>
            <span className="inline-flex gap-2">
              {(['window', 'door', 'opening', 'gap'] as FeatureKind[]).map((k) => (
                <span key={k} className="inline-flex items-center gap-0.5"><span className="w-2 h-2 rounded-sm" style={{ background: FEATURE_COLOR[k] }} />{k === 'opening' ? 'open' : k}</span>
              ))}
            </span>
          </div>
        </div>

        {/* sides */}
        <div className="space-y-2">
          {spec.sides.map((s, i) => (
            <div key={s.id} data-testid="room-side" className={`rounded-md border p-2 space-y-1.5 ${darkMode ? 'border-stone-700' : 'border-stone-200'}`}>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold w-12 shrink-0">Side {i + 1}</span>
                <span className="text-amber-600 font-bold" title="Direction on the plan">{arrow(headings[i])}</span>
                <LenInput label={`Side ${i + 1} length`} value={s.length} units={units} className={`${field} w-20`} onCommit={(v) => v && setSide(i, { length: v })} onError={onError} />
                <select aria-label={`Side ${i + 1} turn`} value={s.turn} onChange={(e) => setSide(i, { turn: Number(e.target.value) })} className={`${field} flex-1`}>
                  {TURNS.map((t) => (
                    <option key={t.v} value={t.v}>{t.label}</option>
                  ))}
                </select>
                <button type="button" aria-label={`Remove side ${i + 1}`} title="Remove side" className="p-0.5 rounded hover:bg-stone-500/15 cursor-pointer" onClick={() => onChange({ ...spec, sides: spec.sides.filter((_, k) => k !== i) })}>
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </button>
              </div>
              {s.features.map((f) => (
                <div key={f.id} className="flex items-center gap-1 pl-3">
                  <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: FEATURE_COLOR[f.kind] }} />
                  <select aria-label="Feature type" value={f.kind} onChange={(e) => setFeature(i, f.id, { kind: e.target.value as FeatureKind })} className={`${field} w-[5.5rem]`}>
                    {(Object.keys(FEATURE_LABEL) as FeatureKind[]).map((k) => (
                      <option key={k} value={k}>{FEATURE_LABEL[k]}</option>
                    ))}
                  </select>
                  <LenInput label="Feature width" value={f.width} units={units} className={`${field} w-16`} onCommit={(v) => v && setFeature(i, f.id, { width: v })} onError={onError} />
                  <span className={sub}>at</span>
                  <LenInput label="Feature position" value={f.at} units={units} placeholder="centre" allowBlank className={`${field} w-16`} onCommit={(v) => setFeature(i, f.id, { at: v })} onError={onError} />
                  <button type="button" aria-label="Remove feature" className="p-0.5 rounded hover:bg-stone-500/15 cursor-pointer" onClick={() => setSide(i, { features: s.features.filter((x) => x.id !== f.id) })}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap gap-1 pl-3">
                {(['window', 'door', 'opening', 'gap'] as FeatureKind[]).map((k) => (
                  <button key={k} type="button" className={chip} onClick={() => setSide(i, { features: [...s.features, newFeature(k)] })}>
                    <Plus className="w-3 h-3" />
                    {k === 'gap' ? 'Gap' : FEATURE_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button type="button" className={`${chip} w-full justify-center py-1`} onClick={() => onChange({ ...spec, sides: [...spec.sides, newSide(spec.sides[spec.sides.length - 1]?.length ?? 120)] })}>
            <Plus className="w-3 h-3" /> Add side
          </button>
        </div>

        {/* closure */}
        <div className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${closed ? (darkMode ? 'bg-emerald-950/50 text-emerald-300' : 'bg-emerald-50 text-emerald-700') : darkMode ? 'bg-red-950/40 text-red-300' : 'bg-red-50 text-red-700'}`} data-testid="room-closure">
          {closed ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          <span className="flex-1">{spec.sides.length < 3 ? 'Needs at least 3 sides' : closed ? 'The sides close' : `Open by ${formatLength(gap, units)}`}</span>
          {!closed && spec.sides.length >= 2 && (
            <button
              type="button"
              className={chip}
              onClick={() => {
                const c = autoClose(spec);
                if (c) onChange(c);
                else onError('Could not close the room automatically — adjust the side lengths.');
              }}
            >
              Close room
            </button>
          )}
        </div>

        <label className="flex items-center gap-2">
          <span className={`text-[10px] ${sub} w-16`}>New walls</span>
          <select aria-label="Wall type for new walls" value={wallTypeId} onChange={(e) => onWallType(e.target.value)} className={`${field} flex-1`}>
            {wallTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>

        <div className="flex gap-1.5">
          <button
            type="button"
            data-testid="room-place"
            disabled={!closed}
            onClick={onPlace}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md font-semibold text-white cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${placing ? 'bg-emerald-600' : 'bg-amber-600 hover:bg-amber-700'}`}
          >
            <MousePointerClick className="w-4 h-4" />
            {placing ? 'Click on the plan…' : 'Place on plan'}
          </button>
          <button type="button" aria-label="Rotate room 90 degrees" title="Rotate 90° (R)" onClick={onRotate} className={`${chip} px-2.5`}>
            <RotateCw className="w-3.5 h-3.5" /> {rotation}°
          </button>
        </div>
        <p className={`text-[10px] leading-snug ${sub}`}>
          Lengths are along wall centrelines. While placing, a corner snaps to wall ends and room corners; sides along existing walls share them, and their doors / windows are cut into the existing wall.
        </p>
      </div>
    </div>
  );
};
