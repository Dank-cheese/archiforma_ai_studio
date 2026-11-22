import React from 'react';
import type { LineTypeDef } from '../types/model';
import { BYLAYER, dashArray, hasDots, LINEWEIGHTS_MM, lineWeightLabel, patternLength } from '../engine/lineStyles';

/** A short swatch of a linetype, dashes scaled so one or two repeats fit. */
export const LineTypePreview: React.FC<{ def: LineTypeDef | null; width?: number; color?: string; strokeWidth?: number }> = ({ def, width = 72, color = 'currentColor', strokeWidth = 1.5 }) => {
  const len = def ? patternLength(def) : 0;
  const scale = len > 0 ? Math.min(40, (width * 0.45) / len) : 1;
  const dash = def ? dashArray(def, scale, 0.01) : null;
  return (
    <svg width={width} height={10} viewBox={`0 0 ${width} 10`} aria-hidden="true" className="shrink-0">
      <line
        x1={2}
        y1={5}
        x2={width - 2}
        y2={5}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={dash ? dash.join(' ') : undefined}
        strokeLinecap={def && hasDots(def) ? 'round' : 'butt'}
      />
    </svg>
  );
};

const fieldCls = (dark: boolean) =>
  `px-1.5 py-1 text-xs rounded border focus:outline-none focus:border-amber-600 min-w-0 ${
    dark ? 'bg-stone-950 border-stone-700 text-stone-100' : 'bg-white border-stone-300 text-stone-900'
  }`;

export const LineTypeSelect: React.FC<{
  value: string | undefined;
  lineTypes: LineTypeDef[];
  onChange: (v: string | undefined) => void;
  allowByLayer?: boolean;
  dark: boolean;
  className?: string;
  label: string;
}> = ({ value, lineTypes, onChange, allowByLayer = true, dark, className = '', label }) => {
  const v = !value || value.toUpperCase() === 'BYLAYER' ? (allowByLayer ? BYLAYER : 'Continuous') : value;
  const known = lineTypes.some((l) => l.name.toUpperCase() === v.toUpperCase()) || v === BYLAYER;
  return (
    <select aria-label={label} value={known ? lineTypes.find((l) => l.name.toUpperCase() === v.toUpperCase())?.name ?? v : v} onChange={(e) => onChange(e.target.value === BYLAYER ? undefined : e.target.value)} className={`${fieldCls(dark)} ${className}`}>
      {allowByLayer && <option value={BYLAYER}>ByLayer</option>}
      {!known && <option value={v}>{v} (not loaded)</option>}
      {lineTypes.map((l) => (
        <option key={l.name} value={l.name} title={l.description}>
          {l.name}
        </option>
      ))}
    </select>
  );
};

export const LineWeightSelect: React.FC<{
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  allowByLayer?: boolean;
  dark: boolean;
  className?: string;
  label: string;
}> = ({ value, onChange, allowByLayer = true, dark, className = '', label }) => {
  const v = value === undefined || value === -1 ? (allowByLayer ? 'bylayer' : 'default') : value < 0 ? 'default' : String(value);
  return (
    <select
      aria-label={label}
      value={LINEWEIGHTS_MM.some((w) => String(w) === v) || v === 'bylayer' || v === 'default' ? v : String(value)}
      onChange={(e) => {
        const s = e.target.value;
        onChange(s === 'bylayer' ? undefined : s === 'default' ? -3 : Number(s));
      }}
      className={`${fieldCls(dark)} ${className}`}
    >
      {allowByLayer && <option value="bylayer">ByLayer</option>}
      <option value="default">Default</option>
      {value !== undefined && value >= 0 && !LINEWEIGHTS_MM.includes(value) && <option value={String(value)}>{lineWeightLabel(value)}</option>}
      {LINEWEIGHTS_MM.map((w) => (
        <option key={w} value={String(w)}>
          {lineWeightLabel(w)}
        </option>
      ))}
    </select>
  );
};

/** ByLayer or a specific color. */
export const ObjectColorField: React.FC<{ value: string | undefined; layerColor: string; onChange: (v: string | undefined) => void; dark: boolean; label: string }> = ({ value, layerColor, onChange, dark, label }) => (
  <div className="flex items-center gap-1.5">
    <select aria-label={`${label} mode`} value={value ? 'custom' : 'bylayer'} onChange={(e) => onChange(e.target.value === 'bylayer' ? undefined : value ?? layerColor)} className={fieldCls(dark)}>
      <option value="bylayer">ByLayer</option>
      <option value="custom">Color…</option>
    </select>
    <input
      type="color"
      aria-label={label}
      value={value ?? layerColor}
      onChange={(e) => onChange(e.target.value)}
      title={value ? value : `ByLayer (${layerColor})`}
      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
    />
  </div>
);
