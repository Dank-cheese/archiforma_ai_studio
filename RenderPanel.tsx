/**
 * AI RENDER panel: one-click looks (sky, sun, materials) applied live to the 3D model, an AI
 * "restyle from a brief" (Claude in claude.ai, Gemini elsewhere), high-resolution stills and a
 * Gemini photoreal pass that repaints the still while keeping the geometry.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Download, ImageIcon, Loader2, Palette, Save, Sparkles, Square, Sun, Trash2, Wand2, X } from 'lucide-react';
import {
  DEFAULT_LOOK,
  LOOK_CATEGORIES,
  LOOK_INSTRUCTIONS,
  LOOK_PRESETS,
  LOOK_SCHEMA,
  compass,
  describeLook,
  loadSavedLooks,
  normalizeLook,
  saveLooks,
  type LookCategory,
  type RenderLook,
} from '../engine/renderLook';
import { askJson, claudeAvailable, dataUrlToImage, geminiPhotoreal, pickEngine } from '../engine/aiEngine';
import { resolveApiKey, setStoredKey } from '../engine/aiClient';

export const RENDER_SIZES = [
  { id: 'hd', label: 'HD 1280 × 720', w: 1280, h: 720 },
  { id: 'fhd', label: 'Full HD 1920 × 1080', w: 1920, h: 1080 },
  { id: 'qhd', label: '2.5K 2560 × 1440', w: 2560, h: 1440 },
  { id: 'uhd', label: '4K 3840 × 2160', w: 3840, h: 2160 },
  { id: 'sq', label: 'Square 2048 × 2048', w: 2048, h: 2048 },
  { id: 'a3', label: 'A3 landscape 3508 × 2480', w: 3508, h: 2480 },
];

interface Props {
  darkMode: boolean;
  look: RenderLook | null;
  onLookChange: (look: RenderLook | null) => void;
  /** current 3D view as an image at an exact size (null when the 3D view is not ready) */
  renderStill: (w: number, h: number, mime?: string) => string | null;
  onDownload: (dataUrl: string, filename: string) => void;
  onLog: (msg: string, kind: 'info' | 'result' | 'error') => void;
  projectName: string;
  onClose: () => void;
}

type Busy = { kind: 'look' | 'photo'; engine: string } | null;

export const RenderPanel: React.FC<Props> = ({ darkMode, look, onLookChange, renderStill, onDownload, onLog, projectName, onClose }) => {
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [sizeId, setSizeId] = useState('fhd');
  const [still, setStill] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [showing, setShowing] = useState<'still' | 'photo'>('still');
  const [saved, setSaved] = useState<RenderLook[]>(() => loadSavedLooks());
  const [matsOpen, setMatsOpen] = useState(false);
  const [claudeHere, setClaudeHere] = useState(false);
  const [geminiKey, setGeminiKey] = useState(() => !!resolveApiKey());
  const [keyDraft, setKeyDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    void claudeAvailable().then((v) => live && setClaudeHere(v));
    return () => {
      live = false;
      abortRef.current?.abort();
    };
  }, []);

  const cur = look ?? DEFAULT_LOOK;
  const size = RENDER_SIZES.find((s) => s.id === sizeId) ?? RENDER_SIZES[1];
  const safe = (projectName || 'archiforma').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'archiforma';
  const set = (patch: Partial<RenderLook>) => onLookChange({ ...cur, ...patch });
  const setMat = (cat: LookCategory, patch: { color?: string; roughness?: number; metalness?: number }) =>
    onLookChange({ ...cur, materials: { ...cur.materials, [cat]: { ...(cur.materials[cat] ?? {}), ...patch } } });

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) {
      onLog('RENDER: cancelled.', 'info');
      return;
    }
    setError(msg);
    onLog(`RENDER: ${msg}`, 'error');
  };

  const aiLook = async () => {
    setError(null);
    const { engine, reason } = await pickEngine();
    if (!engine) {
      setError(reason ?? 'No AI engine available.');
      return;
    }
    const name = engine === 'claude' ? 'Claude' : 'Gemini';
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy({ kind: 'look', engine: name });
    try {
      if (!look) onLookChange(DEFAULT_LOOK); // let the AI see a lit model, not the grey workspace
      await new Promise((r) => setTimeout(r, 60));
      const shot = renderStill(1024, 640, 'image/jpeg');
      const { data } = await askJson({
        instructions: LOOK_INSTRUCTIONS,
        request:
          `Brief: ${brief.trim() || 'a believable, attractive daylight render for a client presentation'}\n\n` +
          `Current look (JSON, change what the brief asks for):\n${JSON.stringify(cur)}`,
        schema: LOOK_SCHEMA as unknown as Record<string, unknown>,
        image: shot ? dataUrlToImage(shot) : null,
        signal: ctrl.signal,
        tier: 'default',
        temperature: 0.6,
      });
      if (ctrl.signal.aborted) return;
      const next = normalizeLook(data, cur);
      onLookChange(next);
      onLog(`RENDER (${name}): ${describeLook(next)} Press Render still or Photoreal next.`, 'result');
    } catch (e) {
      if (!ctrl.signal.aborted) fail(e);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(null);
    }
  };

  const doStill = () => {
    setError(null);
    if (!look) onLookChange(cur);
    // let the look apply before reading pixels
    setTimeout(() => {
      const url = renderStill(size.w, size.h, 'image/png');
      if (!url) {
        setError('The 3D view is not ready yet. Open the 3D view and try again.');
        return;
      }
      setStill(url);
      setShowing('still');
      onLog(`RENDER: ${size.w} × ${size.h} still of the current 3D view (${cur.name}).`, 'result');
    }, look ? 0 : 80);
  };

  const doPhoto = async () => {
    setError(null);
    if (!resolveApiKey()) {
      setError('Photoreal uses Gemini’s image model (Claude does not make images). Add a Gemini API key below.');
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy({ kind: 'photo', engine: 'Gemini' });
    try {
      if (!look) onLookChange(cur);
      await new Promise((r) => setTimeout(r, 80));
      // the image model works best around 1–1.5 MP
      const k = Math.min(1, 1536 / Math.max(size.w, size.h));
      const src = renderStill(Math.round(size.w * k), Math.round(size.h * k), 'image/jpeg');
      if (!src) throw new Error('The 3D view is not ready yet. Open the 3D view and try again.');
      if (!still) setStill(renderStill(size.w, size.h, 'image/png'));
      const prompt = [brief.trim(), cur.photoPrompt].filter(Boolean).join('. ');
      const url = await geminiPhotoreal({ image: dataUrlToImage(src), prompt, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setPhoto(url);
      setShowing('photo');
      onLog('RENDER (Gemini): photoreal image ready — AI images can drift from the model, so check details before sharing.', 'result');
    } catch (e) {
      if (!ctrl.signal.aborted) fail(e);
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(null);
    }
  };

  const saveCurrent = () => {
    const name = cur.name || 'My look';
    const next = [{ ...cur, name }, ...saved.filter((l) => l.name !== name)].slice(0, 24);
    setSaved(next);
    saveLooks(next);
    onLog(`RENDER: saved the look "${name}".`, 'info');
  };

  const shown = showing === 'photo' && photo ? photo : still;
  const shell = darkMode ? 'bg-stone-900/95 border-stone-700 text-stone-100' : 'bg-white/95 border-stone-200 text-stone-800';
  const sub = darkMode ? 'text-stone-400' : 'text-stone-500';
  const btn = `inline-flex items-center justify-center gap-1 px-2 py-1 rounded border text-[11px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
    darkMode ? 'border-stone-700 hover:bg-stone-800' : 'border-stone-200 hover:bg-stone-100'
  }`;
  const primary = 'inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed bg-amber-600 hover:bg-amber-500 text-white';
  const field = `w-full px-2 py-1 rounded border text-[11px] ${darkMode ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`;
  const allLooks = useMemo(() => [...LOOK_PRESETS, ...saved.filter((s) => !LOOK_PRESETS.some((p) => p.name === s.name))], [saved]);

  const slider = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, onChange: (v: number) => void, testId?: string) => (
    <label className="block">
      <div className="flex justify-between text-[10px]">
        <span className={sub}>{label}</span>
        <span className="tabular-nums">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} data-testid={testId} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-amber-600" />
    </label>
  );

  return (
    <div
      data-testid="render-panel"
      role="dialog"
      aria-label="AI render"
      className={`absolute top-3 right-3 z-30 w-80 max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border shadow-lg text-xs ${shell}`}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-inherit sticky top-0 bg-inherit z-10">
        <div>
          <div className="font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" /> AI Render
          </div>
          <div className={`text-[10px] ${sub}`}>{look ? describeLook(look) : 'Pick a look or describe one'}</div>
        </div>
        <button type="button" aria-label="Close render panel" onClick={onClose} className="p-1 rounded hover:bg-stone-500/15 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* LOOKS */}
        <div>
          <div className={`text-[10px] uppercase tracking-wide mb-1 ${sub}`}>Looks</div>
          <div className="grid grid-cols-3 gap-1">
            {allLooks.map((l) => (
              <button
                key={l.name}
                type="button"
                data-testid={`look-${l.name}`}
                title={describeLook(l)}
                onClick={() => onLookChange(l)}
                className={`rounded border overflow-hidden text-left cursor-pointer ${look?.name === l.name ? 'ring-2 ring-amber-500 border-transparent' : darkMode ? 'border-stone-700' : 'border-stone-200'}`}
              >
                <div className="h-6" style={{ background: `linear-gradient(${l.skyTop}, ${l.skyBottom} 70%, ${l.groundColor} 70%)` }} />
                <div className="px-1 py-0.5 text-[10px] truncate">{l.name}</div>
              </button>
            ))}
          </div>
          <div className="flex gap-1 mt-1.5">
            <button type="button" className={btn} onClick={saveCurrent} disabled={!look} title="Keep this look in the list (this browser)">
              <Save className="w-3 h-3" /> Save look
            </button>
            {saved.some((s) => s.name === look?.name) && (
              <button
                type="button"
                className={btn}
                onClick={() => {
                  const next = saved.filter((s) => s.name !== look?.name);
                  setSaved(next);
                  saveLooks(next);
                }}
              >
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            )}
            <button type="button" className={`${btn} ml-auto`} onClick={() => onLookChange(null)} disabled={!look} data-testid="look-off">
              Model view
            </button>
          </div>
        </div>

        {/* AI BRIEF */}
        <div className={`rounded-md border p-2 space-y-1.5 ${darkMode ? 'border-stone-700' : 'border-stone-200'}`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold flex items-center gap-1"><Wand2 className="w-3 h-3" /> Restyle with AI</span>
            <span className={`text-[10px] ${sub}`}>{claudeHere ? 'Claude' : geminiKey ? 'Gemini' : 'needs AI'}</span>
          </div>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            data-testid="render-brief"
            placeholder="e.g. Mediterranean villa at sunset, white lime render, terracotta roof, olive trees"
            className={`${field} resize-y`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void aiLook();
              e.stopPropagation();
            }}
          />
          {busy?.kind === 'look' ? (
            <div className="flex items-center gap-2" data-testid="render-busy">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {busy.engine} is setting up the look…
              <button type="button" className={`${btn} ml-auto`} onClick={() => abortRef.current?.abort()}>
                <Square className="w-3 h-3" /> Stop
              </button>
            </div>
          ) : (
            <button type="button" className={`${primary} w-full`} disabled={!!busy} onClick={() => void aiLook()} data-testid="render-ai-look">
              <Sparkles className="w-3 h-3" /> Generate look
            </button>
          )}
          <div className={`text-[10px] ${sub}`}>The AI sees the current 3D view and sets sky, sun and materials. Your model is not changed.</div>
        </div>

        {/* LIGHT */}
        <div className="space-y-1.5">
          <div className={`text-[10px] uppercase tracking-wide flex items-center gap-1 ${sub}`}><Sun className="w-3 h-3" /> Light</div>
          {slider('Sun direction', cur.sunAzimuth, 0, 359, 1, (v) => `${Math.round(v)}° ${compass(v)}`, (v) => set({ sunAzimuth: v }), 'sun-azimuth')}
          {slider('Sun height', cur.sunAltitude, 0, 90, 1, (v) => `${Math.round(v)}°`, (v) => set({ sunAltitude: v }), 'sun-altitude')}
          {slider('Sun strength', cur.sunIntensity, 0, 5, 0.05, (v) => v.toFixed(2), (v) => set({ sunIntensity: v }))}
          {slider('Sky light', cur.ambientIntensity, 0, 3, 0.05, (v) => v.toFixed(2), (v) => set({ ambientIntensity: v }))}
          {slider('Exposure', cur.exposure, 0.3, 2.5, 0.01, (v) => v.toFixed(2), (v) => set({ exposure: v }))}
          {slider('Haze', cur.fogDensity, 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`, (v) => set({ fogDensity: v }))}
          <div className="flex items-center gap-2 text-[10px]">
            <label className="flex items-center gap-1">Sky <input type="color" value={cur.skyTop} onChange={(e) => set({ skyTop: e.target.value })} className="w-6 h-5" /></label>
            <input type="color" aria-label="Horizon colour" value={cur.skyBottom} onChange={(e) => set({ skyBottom: e.target.value, fogColor: e.target.value })} className="w-6 h-5" />
            <label className="flex items-center gap-1">Sun <input type="color" value={cur.sunColor} onChange={(e) => set({ sunColor: e.target.value })} className="w-6 h-5" /></label>
            <label className="flex items-center gap-1">Ground <input type="color" value={cur.groundColor} onChange={(e) => set({ groundColor: e.target.value })} className="w-6 h-5" /></label>
          </div>
          <label className="flex items-center gap-1.5 text-[11px]">
            <input type="checkbox" checked={cur.edges} onChange={(e) => set({ edges: e.target.checked })} /> Outline edges
          </label>
        </div>

        {/* MATERIALS */}
        <div>
          <button type="button" className={`${btn} w-full justify-between`} onClick={() => setMatsOpen((v) => !v)} aria-expanded={matsOpen}>
            <span className="flex items-center gap-1"><Palette className="w-3 h-3" /> Materials</span>
            <span>{matsOpen ? '−' : '+'}</span>
          </button>
          {matsOpen && (
            <div className="mt-1.5 space-y-1">
              {LOOK_CATEGORIES.map(({ id, label }) => {
                const m = cur.materials[id];
                return (
                  <div key={id} className="flex items-center gap-1.5">
                    <input
                      type="color"
                      aria-label={`${label} colour`}
                      value={m?.color ?? '#cccccc'}
                      onChange={(e) => setMat(id, { color: e.target.value })}
                      className="w-6 h-5 shrink-0"
                    />
                    <span className="w-24 truncate text-[11px]">{label}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={m?.roughness ?? 0.7}
                      title="Matte ↔ glossy"
                      aria-label={`${label} roughness`}
                      onChange={(e) => setMat(id, { roughness: Number(e.target.value) })}
                      className="flex-1 accent-amber-600"
                    />
                    {m?.color && (
                      <button
                        type="button"
                        title="Use the model's own colour"
                        className="text-[10px] opacity-60 hover:opacity-100 cursor-pointer"
                        onClick={() => {
                          const { [id]: _, ...rest } = cur.materials;
                          onLookChange({ ...cur, materials: rest });
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              <div className={`text-[10px] ${sub}`}>× keeps the material you set on the element (paint, wall finish).</div>
            </div>
          )}
        </div>

        {/* OUTPUT */}
        <div className="space-y-1.5">
          <div className={`text-[10px] uppercase tracking-wide ${sub}`}>Output</div>
          <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} className={field} aria-label="Render size">
            {RENDER_SIZES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-1">
            <button type="button" className={primary} onClick={doStill} disabled={!!busy} data-testid="render-still">
              <Camera className="w-3 h-3" /> Render still
            </button>
            {busy?.kind === 'photo' ? (
              <button type="button" className={btn} onClick={() => abortRef.current?.abort()} data-testid="render-photo-busy">
                <Loader2 className="w-3 h-3 animate-spin" /> Stop
              </button>
            ) : (
              <button type="button" className={btn} onClick={() => void doPhoto()} disabled={!!busy} data-testid="render-photo" title="Gemini repaints the still as a photo, keeping the geometry">
                <ImageIcon className="w-3 h-3" /> Photoreal
              </button>
            )}
          </div>
          {!geminiKey && (
            <div className={`text-[10px] ${sub} space-y-1`}>
              <div>Photoreal needs a Gemini API key (free at aistudio.google.com); it stays in this browser.</div>
              <div className="flex gap-1">
                <input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Gemini API key"
                  className={field}
                  aria-label="Gemini API key"
                />
                <button
                  type="button"
                  className={btn}
                  disabled={!keyDraft.trim()}
                  onClick={() => {
                    setStoredKey(keyDraft);
                    setKeyDraft('');
                    setGeminiKey(!!resolveApiKey());
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          )}
          {busy?.kind === 'photo' && <div className={`text-[10px] ${sub}`}>Gemini is painting the photo — usually 10–30 s.</div>}
        </div>

        {error && (
          <div role="alert" className="rounded border border-red-400/60 bg-red-500/10 text-red-600 dark:text-red-300 px-2 py-1.5 text-[11px]" data-testid="render-error">
            {error}
          </div>
        )}

        {shown && (
          <div className="space-y-1.5" data-testid="render-result">
            {photo && still && (
              <div className="flex gap-1">
                <button type="button" className={`${btn} flex-1 ${showing === 'still' ? 'ring-1 ring-amber-500' : ''}`} onClick={() => setShowing('still')}>3D still</button>
                <button type="button" className={`${btn} flex-1 ${showing === 'photo' ? 'ring-1 ring-amber-500' : ''}`} onClick={() => setShowing('photo')}>Photoreal</button>
              </div>
            )}
            <img src={shown} alt={showing === 'photo' ? 'Photoreal render' : 'Render still'} className="w-full rounded border border-inherit" />
            <button
              type="button"
              className={`${btn} w-full`}
              onClick={() => {
                const ext = /^data:image\/jpe?g/.test(shown) ? 'jpg' : /^data:image\/webp/.test(shown) ? 'webp' : 'png';
                onDownload(shown, `${safe}_${showing === 'photo' ? 'photoreal' : 'render'}_${(cur.name || 'look').replace(/\W+/g, '_').toLowerCase()}.${ext}`);
              }}
              data-testid="render-download"
            >
              <Download className="w-3 h-3" /> Download {showing === 'photo' ? 'photo' : 'still'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RenderPanel;
