import React, { useMemo, useRef, useState } from 'react';
import { Copy, Download, Eye, EyeOff, Lock, Plus, Printer, Trash2, Unlock, Upload, X } from 'lucide-react';
import type { ArchModel, Layer, LineTypeDef, PlotStylePen, PlotStyleTable, ProjectSettings } from '../types/model';
import { allLineTypes, DEFAULT_LTSCALE, parseLinFile, STANDARD_LINETYPES, writeLinFile } from '../engine/lineStyles';
import { aciToHex, allPlotStyleTables, BUILTIN_PLOT_STYLES, ctbToText, packCtb, parseCtbText, penFor, plotColor, unpackCtb, usedAci } from '../engine/plotStyles';
import { LineTypePreview, LineTypeSelect, LineWeightSelect } from './LineStyleControls';

// ---------------------------------------------------------------------------------------------
// shared shell
// ---------------------------------------------------------------------------------------------
const Shell: React.FC<{ title: string; subtitle?: string; dark: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean; testId: string }> = ({ title, subtitle, dark, onClose, children, wide, testId }) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
    <div
      role="dialog"
      aria-label={title}
      data-testid={testId}
      onMouseDown={(e) => e.stopPropagation()}
      className={`w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'} max-h-[88vh] flex flex-col rounded-xl border shadow-2xl text-sm ${dark ? 'bg-stone-950 border-stone-800 text-stone-100' : 'bg-white border-stone-200 text-stone-800'}`}
    >
      <div className={`flex items-center gap-3 px-5 py-3 border-b ${dark ? 'border-stone-800' : 'border-stone-200'}`}>
        <div className="flex-1">
          <div className="font-semibold">{title}</div>
          {subtitle && <div className={`text-xs ${dark ? 'text-stone-400' : 'text-stone-500'}`}>{subtitle}</div>}
        </div>
        <button type="button" aria-label={`Close ${title}`} onClick={onClose} className="p-1.5 rounded hover:bg-stone-500/15 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  </div>
);

const btn = (dark: boolean) =>
  `inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
    dark ? 'border-stone-700 hover:bg-stone-800' : 'border-stone-300 hover:bg-stone-100'
  }`;
const input = (dark: boolean) => `px-2 py-1 text-xs rounded border focus:outline-none focus:border-amber-600 ${dark ? 'bg-stone-900 border-stone-700' : 'bg-white border-stone-300'}`;

const download = (data: BlobPart, name: string, type: string) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

// ---------------------------------------------------------------------------------------------
// LINETYPES & LINEWEIGHTS (LT, LTSCALE, LWEIGHT)
// ---------------------------------------------------------------------------------------------
export const LineStylesModal: React.FC<{
  model: ArchModel;
  tab: 'linetypes' | 'lineweights';
  onTab: (t: 'linetypes' | 'lineweights') => void;
  dark: boolean;
  onUpdateSettings: (patch: Partial<ProjectSettings>, label: string) => void;
  onSetLineTypes: (defs: LineTypeDef[], label: string) => void;
  onLog: (msg: string, kind?: 'info' | 'error' | 'result') => void;
  onClose: () => void;
}> = ({ model, tab, onTab, dark, onUpdateSettings, onSetLineTypes, onLog, onClose }) => {
  const st = model.settings;
  const all = allLineTypes(model);
  const custom = model.lineTypes ?? [];
  const fileRef = useRef<HTMLInputElement | null>(null);
  const ltScale = st.ltScale ?? DEFAULT_LTSCALE;
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    const bump = (n?: string) => n && m.set(n.toUpperCase(), (m.get(n.toUpperCase()) ?? 0) + 1);
    for (const l of model.layers) bump(l.lineType);
    for (const e of model.entities) bump(e.lineType);
    return m;
  }, [model.layers, model.entities]);
  const [scaleDraft, setScaleDraft] = useState<string | null>(null);

  const loadLin = async (file: File) => {
    const { lineTypes, skipped } = parseLinFile(await file.text());
    if (!lineTypes.length) {
      onLog(`No simple linetypes found in "${file.name}"${skipped.length ? ` (complex ones with text or shapes are not supported: ${skipped.join(', ')})` : ''}.`, 'error');
      return;
    }
    const names = new Set(lineTypes.map((l) => l.name.toUpperCase()));
    onSetLineTypes([...custom.filter((l) => !names.has(l.name.toUpperCase())), ...lineTypes], `Load Linetypes (${file.name})`);
    onLog(`Loaded ${lineTypes.length} linetype(s) from "${file.name}": ${lineTypes.map((l) => l.name).join(', ')}.${skipped.length ? ` Skipped complex: ${skipped.join(', ')}.` : ''}`, 'result');
  };

  return (
    <Shell title="Linetypes & Lineweights" subtitle="LT · LTSCALE · LWEIGHT — like AutoCAD's Linetype Manager and Lineweight Settings" dark={dark} onClose={onClose} testId="line-styles-modal">
      <div className={`flex gap-1 px-5 pt-3 border-b ${dark ? 'border-stone-800' : 'border-stone-200'}`}>
        {(['linetypes', 'lineweights'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTab(t)}
            aria-pressed={tab === t}
            className={`px-3 py-1.5 text-xs font-semibold rounded-t-md border border-b-0 cursor-pointer ${tab === t ? (dark ? 'bg-stone-900 border-stone-700' : 'bg-stone-50 border-stone-300') : 'border-transparent opacity-70 hover:opacity-100'}`}
          >
            {t === 'linetypes' ? 'Linetypes' : 'Lineweights'}
          </button>
        ))}
      </div>

      {tab === 'linetypes' ? (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <label className="space-y-1">
              <div className="font-medium">Global scale (LTSCALE)</div>
              <input
                aria-label="Global linetype scale"
                className={`${input(dark)} w-full`}
                value={scaleDraft ?? String(ltScale)}
                onChange={(e) => setScaleDraft(e.target.value)}
                onBlur={() => {
                  if (scaleDraft === null) return;
                  const v = Number(scaleDraft);
                  setScaleDraft(null);
                  if (v > 0 && v !== ltScale) onUpdateSettings({ ltScale: v }, `LTSCALE ${v}`);
                  else if (!(v > 0)) onLog('LTSCALE must be a number above 0.', 'error');
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <div className={dark ? 'text-stone-400' : 'text-stone-500'}>Dash length = pattern × this. 12 suits 1/4" = 1'-0" plots.</div>
            </label>
            <label className="space-y-1">
              <div className="font-medium">Current linetype (CELTYPE)</div>
              <LineTypeSelect label="Current linetype" className="w-full" value={st.currentLineType} lineTypes={all} dark={dark} onChange={(v) => onUpdateSettings({ currentLineType: v }, 'Current Linetype')} />
              <div className={dark ? 'text-stone-400' : 'text-stone-500'}>Given to new lines, polylines, rectangles, circles and arcs.</div>
            </label>
            <label className="space-y-1">
              <div className="font-medium">Current object scale (CELTSCALE)</div>
              <input
                type="number"
                min={0.01}
                step={0.25}
                aria-label="Current object linetype scale"
                className={`${input(dark)} w-full`}
                value={st.currentLineTypeScale ?? 1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0) onUpdateSettings({ currentLineTypeScale: v }, 'Current Linetype Scale');
                }}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".lin,text/plain" className="hidden" data-testid="lin-file-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadLin(f); }} />
            <button type="button" className={btn(dark)} onClick={() => fileRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> Load .lin file…
            </button>
            <button type="button" className={btn(dark)} onClick={() => download(writeLinFile(all.filter((l) => l.pattern.length)), 'archiforma.lin', 'text/plain')}>
              <Download className="w-3.5 h-3.5" /> Save all as .lin
            </button>
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className={`text-left ${dark ? 'text-stone-400' : 'text-stone-500'}`}>
                <th className="py-1 pr-2 font-medium">Linetype</th>
                <th className="py-1 pr-2 font-medium">Appearance (at LTSCALE)</th>
                <th className="py-1 pr-2 font-medium">Description</th>
                <th className="py-1 pr-2 font-medium text-right">Used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {all.map((l) => {
                const isCustom = custom.some((c) => c.name.toUpperCase() === l.name.toUpperCase());
                const used = usage.get(l.name.toUpperCase()) ?? 0;
                return (
                  <tr key={l.name} className={`border-t ${dark ? 'border-stone-800' : 'border-stone-100'}`}>
                    <td className="py-1 pr-2 font-mono font-medium">
                      {l.name}
                      {isCustom && <span className="ml-1 text-[10px] text-amber-600 font-sans">loaded</span>}
                    </td>
                    <td className="py-1 pr-2">
                      <LineTypePreview def={l} width={140} />
                    </td>
                    <td className={`py-1 pr-2 font-mono truncate max-w-[16rem] ${dark ? 'text-stone-400' : 'text-stone-500'}`}>{l.description}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{used || ''}</td>
                    <td className="py-1 text-right">
                      {isCustom && (
                        <button
                          type="button"
                          aria-label={`Delete linetype ${l.name}`}
                          disabled={used > 0}
                          title={used > 0 ? 'In use — change those layers / objects first' : 'Delete'}
                          className="p-1 rounded hover:bg-stone-500/15 cursor-pointer disabled:opacity-30"
                          onClick={() => onSetLineTypes(custom.filter((c) => c !== l), `Delete Linetype ${l.name}`)}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-500" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={`text-xs ${dark ? 'text-stone-400' : 'text-stone-500'}`}>
            {STANDARD_LINETYPES.length} standard linetypes from acad.lin are always available. Set a layer's linetype in Layer Properties, or an object's in its Properties.
          </p>
        </div>
      ) : (
        <div className="p-5 space-y-4 text-xs">
          <label className="flex items-center gap-3">
            <span className="w-48 font-medium">Current lineweight (CELWEIGHT)</span>
            <LineWeightSelect label="Current lineweight" value={st.currentLineWeight} dark={dark} onChange={(v) => onUpdateSettings({ currentLineWeight: v }, 'Current Lineweight')} />
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <span className="w-48 font-medium">Display lineweight (LWDISPLAY)</span>
            <input type="checkbox" aria-label="Display lineweights" checked={!!st.showLineweights} onChange={(e) => onUpdateSettings({ showLineweights: e.target.checked }, e.target.checked ? 'Show Lineweights' : 'Hide Lineweights')} />
            <span className={dark ? 'text-stone-400' : 'text-stone-500'}>also the LWT button in the status bar</span>
          </label>
          <div className={dark ? 'text-stone-400' : 'text-stone-500'}>
            Default lineweight: 0.25 mm. Lineweights always plot at their true width; on screen they are shown in pixels when LWT is on.
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {[0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2].map((w) => (
              <div key={w} className="flex items-center gap-2">
                <svg width="60" height="10" aria-hidden="true">
                  <line x1="2" y1="5" x2="58" y2="5" stroke="currentColor" strokeWidth={Math.max(1, (w * 96) / 25.4)} />
                </svg>
                <span className="tabular-nums">{w.toFixed(2)} mm</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
};

// ---------------------------------------------------------------------------------------------
// LAYER PROPERTIES MANAGER (LAYERPROPERTIES / LP)
// ---------------------------------------------------------------------------------------------
export const LayerPropertiesModal: React.FC<{
  model: ArchModel;
  activeLayer: string;
  dark: boolean;
  onSetActiveLayer: (id: string) => void;
  onChangeLayers: (layers: Layer[], label: string) => void;
  onClose: () => void;
}> = ({ model, activeLayer, dark, onSetActiveLayer, onChangeLayers, onClose }) => {
  const lts = allLineTypes(model);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of model.entities) m.set(e.layer, (m.get(e.layer) ?? 0) + 1);
    return m;
  }, [model.entities]);
  const set = (id: string, patch: Partial<Layer>, label: string) => onChangeLayers(model.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)), label);
  const [newName, setNewName] = useState('');
  const icon = (on: boolean) => `p-1 rounded cursor-pointer hover:bg-stone-500/15 ${on ? '' : 'opacity-40'}`;

  return (
    <Shell title="Layer Properties Manager" subtitle="Current layer, on / off, lock, plot, color, linetype and lineweight" dark={dark} onClose={onClose} wide testId="layer-manager">
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <input aria-label="New layer name" placeholder="New layer name, e.g. A-ANNO-NOTE" value={newName} onChange={(e) => setNewName(e.target.value.toUpperCase())} className={`${input(dark)} w-64 font-mono`} />
          <button
            type="button"
            className={btn(dark)}
            disabled={!newName.trim() || model.layers.some((l) => l.name.toUpperCase() === newName.trim().toUpperCase())}
            onClick={() => {
              const name = newName.trim();
              onChangeLayers([...model.layers, { id: name, name, color: '#1c1917', visible: true, locked: false }], `New Layer ${name}`);
              setNewName('');
            }}
          >
            <Plus className="w-3.5 h-3.5" /> New layer
          </button>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className={`text-left ${dark ? 'text-stone-400' : 'text-stone-500'}`}>
              <th className="py-1 px-1 font-medium">Cur.</th>
              <th className="py-1 px-1 font-medium">Name</th>
              <th className="py-1 px-1 font-medium text-center">On</th>
              <th className="py-1 px-1 font-medium text-center">Lock</th>
              <th className="py-1 px-1 font-medium text-center">Plot</th>
              <th className="py-1 px-1 font-medium">Color</th>
              <th className="py-1 px-1 font-medium">Linetype</th>
              <th className="py-1 px-1 font-medium">Lineweight</th>
              <th className="py-1 px-1 font-medium text-right">Objects</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.layers.map((l) => {
              const n = counts.get(l.id) ?? 0;
              const cur = l.id === activeLayer;
              return (
                <tr key={l.id} data-layer={l.name} className={`border-t ${dark ? 'border-stone-800' : 'border-stone-100'} ${cur ? (dark ? 'bg-amber-950/30' : 'bg-amber-50') : ''}`}>
                  <td className="py-1 px-1">
                    <input type="radio" name="current-layer" aria-label={`Make ${l.name} current`} checked={cur} onChange={() => onSetActiveLayer(l.id)} />
                  </td>
                  <td className="py-1 px-1 font-mono font-medium">{l.name}</td>
                  <td className="py-1 px-1 text-center">
                    <button type="button" aria-label={`Turn ${l.name} ${l.visible ? 'off' : 'on'}`} className={icon(l.visible)} onClick={() => set(l.id, { visible: !l.visible }, `Layer ${l.name} ${l.visible ? 'Off' : 'On'}`)}>
                      {l.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                  </td>
                  <td className="py-1 px-1 text-center">
                    <button type="button" aria-label={`${l.locked ? 'Unlock' : 'Lock'} ${l.name}`} className={icon(true)} onClick={() => set(l.id, { locked: !l.locked }, `Layer ${l.name} ${l.locked ? 'Unlock' : 'Lock'}`)}>
                      {l.locked ? <Lock className="w-3.5 h-3.5 text-amber-600" /> : <Unlock className="w-3.5 h-3.5 opacity-50" />}
                    </button>
                  </td>
                  <td className="py-1 px-1 text-center">
                    <button type="button" aria-label={`${l.plot === false ? 'Plot' : "Don't plot"} ${l.name}`} title={l.plot === false ? 'Not plotted' : 'Plotted'} className={icon(l.plot !== false)} onClick={() => set(l.id, { plot: l.plot === false ? undefined : false }, `Layer ${l.name} ${l.plot === false ? 'Plot' : 'No Plot'}`)}>
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  </td>
                  <td className="py-1 px-1">
                    <input type="color" aria-label={`${l.name} color`} value={l.color} onChange={(e) => set(l.id, { color: e.target.value }, `Layer ${l.name} Color`)} className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent p-0" />
                  </td>
                  <td className="py-1 px-1">
                    <div className="flex items-center gap-1.5">
                      <LineTypeSelect label={`${l.name} linetype`} allowByLayer={false} className="w-28" value={l.lineType ?? 'Continuous'} lineTypes={lts} dark={dark} onChange={(v) => set(l.id, { lineType: !v || v === 'Continuous' ? undefined : v }, `Layer ${l.name} Linetype`)} />
                      <LineTypePreview def={lts.find((x) => x.name.toUpperCase() === (l.lineType ?? 'Continuous').toUpperCase()) ?? null} width={48} />
                    </div>
                  </td>
                  <td className="py-1 px-1">
                    <LineWeightSelect label={`${l.name} lineweight`} allowByLayer={false} className="w-24" value={l.lineWeight ?? -3} dark={dark} onChange={(v) => set(l.id, { lineWeight: v === undefined || v < 0 ? undefined : v }, `Layer ${l.name} Lineweight`)} />
                  </td>
                  <td className="py-1 px-1 text-right tabular-nums">{n || ''}</td>
                  <td className="py-1 px-1 text-right">
                    <button
                      type="button"
                      aria-label={`Delete layer ${l.name}`}
                      disabled={n > 0 || cur || l.id === '0' || l.name === '0'}
                      title={n > 0 ? 'Layer has objects' : cur ? 'Current layer' : 'Delete layer'}
                      className="p-1 rounded hover:bg-stone-500/15 cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed"
                      onClick={() => onChangeLayers(model.layers.filter((x) => x.id !== l.id), `Delete Layer ${l.name}`)}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
};

// ---------------------------------------------------------------------------------------------
// PLOT STYLE TABLES (PLOTSTYLE / STYLESMANAGER)
// ---------------------------------------------------------------------------------------------
async function zlibCompress(text: string): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot write .ctb files (no CompressionStream).');
  const stream = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function zlibDecompress(data: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read .ctb files (no DecompressionStream).');
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

export async function ctbFileBytes(table: PlotStyleTable): Promise<Uint8Array> {
  const text = ctbToText(table) + '\0';
  return packCtb(await zlibCompress(text), new TextEncoder().encode(text).length);
}

export async function readCtbFile(file: File): Promise<PlotStyleTable> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const text = await zlibDecompress(unpackCtb(bytes));
  return parseCtbText(text, file.name);
}

const uniqueTableName = (base: string, tables: PlotStyleTable[]) => {
  const stem = base.replace(/\.ctb$/i, '');
  const names = new Set(tables.map((t) => t.name.toLowerCase()));
  if (!names.has(`${stem}.ctb`.toLowerCase())) return `${stem}.ctb`;
  for (let i = 2; i < 999; i++) if (!names.has(`${stem} (${i}).ctb`.toLowerCase())) return `${stem} (${i}).ctb`;
  return `${stem} ${Date.now()}.ctb`;
};

export const PlotStyleModal: React.FC<{
  model: ArchModel;
  dark: boolean;
  onSetCurrent: (name: string | undefined) => void;
  onSetTables: (tables: PlotStyleTable[], label: string) => void;
  onLog: (msg: string, kind?: 'info' | 'error' | 'result') => void;
  onClose: () => void;
}> = ({ model, dark, onSetCurrent, onSetTables, onLog, onClose }) => {
  const tables = allPlotStyleTables(model);
  const custom = model.plotStyleTables ?? [];
  const current = model.settings.plotStyleTable;
  const [sel, setSel] = useState<string>(current || 'monochrome.ctb');
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const table = tables.find((t) => t.name === sel) ?? tables[0];
  const editable = !!custom.find((t) => t.name === table.name);
  const used = useMemo(() => usedAci(model as Pick<ArchModel, 'layers' | 'entities'>), [model]);
  const rows = showAll ? Array.from({ length: 255 }, (_, i) => i + 1) : used;

  const saveTable = (next: PlotStyleTable, label: string) => onSetTables(custom.map((t) => (t.name === table.name ? next : t)), label);
  const setPen = (aci: number, patch: Partial<PlotStylePen>) => {
    const pen = { ...penFor(table, aci), ...patch };
    const pens = { ...table.pens };
    const isDefault = pen.color === 'object' && pen.screening === 100 && pen.lineWeight === 'object' && pen.lineType === 'object' && !pen.grayscale;
    if (isDefault) delete pens[aci];
    else pens[aci] = pen;
    saveTable({ ...table, pens }, `Plot Style ${table.name}: Color ${aci}`);
  };

  return (
    <Shell title="Plot Style Tables" subtitle="Color-dependent plot styles (.ctb): what each color plots as in sheets and PDFs" dark={dark} onClose={onClose} wide testId="plot-style-modal">
      <div className="flex flex-col md:flex-row min-h-0">
        <div className={`md:w-64 shrink-0 p-4 space-y-1 border-b md:border-b-0 md:border-r ${dark ? 'border-stone-800' : 'border-stone-200'}`}>
          <div className="text-xs font-semibold mb-1">Plot with</div>
          <label className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
            <input type="radio" name="plot-style-current" checked={!current} onChange={() => onSetCurrent(undefined)} aria-label="Plot with ARCHIFORMA look" />
            <span>None — ARCHIFORMA's own look</span>
          </label>
          {tables.map((t) => (
            <div key={t.name} className={`flex items-center gap-2 text-xs rounded px-1 py-0.5 ${t.name === table.name ? (dark ? 'bg-stone-800' : 'bg-amber-50') : ''}`}>
              <input type="radio" name="plot-style-current" checked={current === t.name} onChange={() => onSetCurrent(t.name)} aria-label={`Plot with ${t.name}`} />
              <button type="button" className="flex-1 text-left truncate cursor-pointer" onClick={() => setSel(t.name)} title="Show / edit">
                {t.name}
                {!t.builtIn && <span className="ml-1 text-[10px] text-amber-600">custom</span>}
              </button>
            </div>
          ))}
          <div className="pt-3 flex flex-wrap gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept=".ctb"
              className="hidden"
              data-testid="ctb-file-input"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  const t = await readCtbFile(f);
                  const named = { ...t, name: uniqueTableName(f.name, tables) };
                  onSetTables([...custom, named], `Import Plot Style ${named.name}`);
                  setSel(named.name);
                  onLog(`Imported plot style table "${named.name}" (${Object.keys(named.pens).length} colors changed).`, 'result');
                } catch (err) {
                  onLog(err instanceof Error ? err.message : String(err), 'error');
                }
              }}
            />
            <button type="button" className={btn(dark)} onClick={() => fileRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" /> Import .ctb
            </button>
          </div>
        </div>

        <div className="flex-1 min-w-0 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-semibold">{table.name}</div>
            <div className="flex-1" />
            <button
              type="button"
              className={btn(dark)}
              onClick={() => {
                const copy: PlotStyleTable = { ...table, name: uniqueTableName(`${table.name.replace(/\.ctb$/i, '')} copy`, tables), builtIn: undefined, pens: { ...table.pens } };
                onSetTables([...custom, copy], `Copy Plot Style ${table.name}`);
                setSel(copy.name);
              }}
            >
              <Copy className="w-3.5 h-3.5" /> Copy to edit
            </button>
            <button
              type="button"
              className={btn(dark)}
              onClick={async () => {
                try {
                  download((await ctbFileBytes(table)) as Uint8Array<ArrayBuffer>, table.name.endsWith('.ctb') ? table.name : `${table.name}.ctb`, 'application/octet-stream');
                } catch (err) {
                  onLog(err instanceof Error ? err.message : String(err), 'error');
                }
              }}
            >
              <Download className="w-3.5 h-3.5" /> Export .ctb
            </button>
            {editable && (
              <button
                type="button"
                className={btn(dark)}
                onClick={() => {
                  onSetTables(custom.filter((t) => t.name !== table.name), `Delete Plot Style ${table.name}`);
                  if (current === table.name) onSetCurrent(undefined);
                  setSel(BUILTIN_PLOT_STYLES[1].name);
                }}
              >
                <Trash2 className="w-3.5 h-3.5 text-red-500" /> Delete
              </button>
            )}
          </div>
          {editable ? (
            <input aria-label="Plot style description" className={`${input(dark)} w-full`} value={table.description} onChange={(e) => saveTable({ ...table, description: e.target.value }, 'Plot Style Description')} />
          ) : (
            <div className={`text-xs ${dark ? 'text-stone-400' : 'text-stone-500'}`}>{table.description} {table.builtIn && '— built in; use "Copy to edit" to change it.'}</div>
          )}

          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} aria-label="Show all 255 colors" />
              Show all 255 colors
            </label>
            {!showAll && <span className={dark ? 'text-stone-400' : 'text-stone-500'}>Showing the {used.length} colors this drawing uses.</span>}
          </div>

          <div className="overflow-auto max-h-[46vh]">
            <table className="w-full text-xs">
              <thead className={`sticky top-0 ${dark ? 'bg-stone-950' : 'bg-white'}`}>
                <tr className={`text-left ${dark ? 'text-stone-400' : 'text-stone-500'}`}>
                  <th className="py-1 px-1 font-medium">Object color</th>
                  <th className="py-1 px-1 font-medium">Plots as</th>
                  <th className="py-1 px-1 font-medium">Plot color</th>
                  <th className="py-1 px-1 font-medium">Screening</th>
                  <th className="py-1 px-1 font-medium">Gray</th>
                  <th className="py-1 px-1 font-medium">Lineweight</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((aci) => {
                  const pen = penFor(table, aci);
                  const objHex = aciToHex(aci);
                  return (
                    <tr key={aci} data-aci={aci} className={`border-t ${dark ? 'border-stone-800' : 'border-stone-100'}`}>
                      <td className="py-1 px-1">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-sm border border-stone-400/50" style={{ background: objHex }} />
                          <span className="tabular-nums">Color {aci}</span>
                        </span>
                      </td>
                      <td className="py-1 px-1">
                        <svg width="56" height="10" aria-hidden="true">
                          <line x1="2" y1="5" x2="54" y2="5" stroke={plotColor(pen, objHex)} strokeWidth={pen.lineWeight === 'object' ? 1.5 : Math.max(1, (pen.lineWeight * 96) / 25.4)} />
                        </svg>
                      </td>
                      <td className="py-1 px-1">
                        <div className="flex items-center gap-1">
                          <select
                            aria-label={`Color ${aci} plot color`}
                            disabled={!editable}
                            value={pen.color === 'object' ? 'object' : 'custom'}
                            onChange={(e) => setPen(aci, { color: e.target.value === 'object' ? 'object' : '#000000' })}
                            className={input(dark)}
                          >
                            <option value="object">Use object color</option>
                            <option value="custom">Specific color</option>
                          </select>
                          {pen.color !== 'object' && (
                            <input type="color" aria-label={`Color ${aci} plotted color`} disabled={!editable} value={pen.color} onChange={(e) => setPen(aci, { color: e.target.value })} className="w-6 h-5 rounded cursor-pointer border-0 bg-transparent p-0" />
                          )}
                        </div>
                      </td>
                      <td className="py-1 px-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          aria-label={`Color ${aci} screening`}
                          disabled={!editable}
                          value={pen.screening}
                          onChange={(e) => setPen(aci, { screening: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                          className={`${input(dark)} w-16`}
                        />
                      </td>
                      <td className="py-1 px-1">
                        <input type="checkbox" aria-label={`Color ${aci} grayscale`} disabled={!editable} checked={!!pen.grayscale} onChange={(e) => setPen(aci, { grayscale: e.target.checked || undefined })} />
                      </td>
                      <td className="py-1 px-1">
                        <select
                          aria-label={`Color ${aci} lineweight`}
                          disabled={!editable}
                          value={pen.lineWeight === 'object' ? 'object' : String(pen.lineWeight)}
                          onChange={(e) => setPen(aci, { lineWeight: e.target.value === 'object' ? 'object' : Number(e.target.value) })}
                          className={input(dark)}
                        >
                          <option value="object">Use object lineweight</option>
                          {pen.lineWeight !== 'object' && ![0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11].includes(pen.lineWeight) && (
                            <option value={String(pen.lineWeight)}>{pen.lineWeight.toFixed(2)} mm</option>
                          )}
                          {[0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11].map((w) => (
                            <option key={w} value={String(w)}>{w.toFixed(2)} mm</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={`text-xs ${dark ? 'text-stone-400' : 'text-stone-500'}`}>
            Used for Sheets and PDF plots. Lines and text take the plot color and lineweight; area fills keep their shade (gray when the color is fixed).
            Linetype settings inside imported .ctb files are kept but not applied.
          </p>
        </div>
      </div>
    </Shell>
  );
};

