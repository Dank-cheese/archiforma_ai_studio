/**
 * DESIGN WITH AI — prompt bar at the bottom of the 2D plan.
 * Click "+" (or drop / paste an image) to attach a hand sketch, describe what you want,
 * and Gemini turns it into walls, doors, windows and rooms on the current level.
 */
import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Check, ChevronDown, FileText, KeyRound, Loader2, Plus, Settings2, Sparkles, Undo2, X, ArrowUp, Minus } from 'lucide-react';
import type { ArchModel } from '../types/model';
import { formatLength } from '../engine/geometry';
import { applyAiPlan, isStarterSample, levelHasPlan, type AiPlanReport, type ApplyMode } from '../engine/aiPlan';
import {
  AI_MODELS,
  AiDesignError,
  getStoredKey,
  getStoredModel,
  hasBuiltInKey,
  requestAiPlan,
  resolveApiKey,
  setStoredKey,
  setStoredModel,
  type SketchInput,
} from '../engine/aiClient';
import { claudeAvailable, getEnginePref, pickEngine, setEnginePref, type AiEnginePref } from '../engine/aiEngine';

interface Props {
  model: ArchModel;
  levelId: string;
  levelName: string;
  darkMode: boolean;
  /** Commits the generated model (undoable). */
  onApply: (next: ArchModel, label: string, report: AiPlanReport) => void;
  onUndo: () => void;
  /** Bumped by the "AI" command to open + focus the bar. */
  focusSignal?: number;
}

interface Sketch extends SketchInput {
  name: string;
  previewUrl: string | null;
}

const COLLAPSE_KEY = 'archiforma_ai_bar_collapsed_v1';
const MAX_SIDE = 1600;
const MAX_BYTES = 20 * 1024 * 1024;

const EXAMPLES = [
  '3 bedroom, 2 bath ranch, about 50 ft × 30 ft, open kitchen and living',
  'Small cabin 24 × 16 with a loft ladder, bath and porch',
  'Studio apartment 30 m², kitchenette along one wall',
];

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(file);
  });
}

/** Downscales photos of sketches (phone photos are huge) and flattens transparency onto white. */
async function prepareSketch(file: File): Promise<Sketch> {
  if (file.size > MAX_BYTES) throw new Error('That file is over 20 MB. Try a smaller photo or a screenshot.');
  if (file.type === 'application/pdf') {
    const url = await readAsDataUrl(file);
    return { name: file.name, mimeType: 'application/pdf', base64: url.split(',')[1] ?? '', previewUrl: null };
  }
  if (!file.type.startsWith('image/')) throw new Error('Add an image (JPG, PNG, WebP) or a PDF.');
  const src = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Couldn't open that image. Try a JPG or PNG (iPhone HEIC photos may need converting)."));
    el.src = src;
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process that image.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL('image/jpeg', 0.9);
  return { name: file.name || 'sketch.jpg', mimeType: 'image/jpeg', base64: out.split(',')[1] ?? '', previewUrl: out };
}

export default function AiDesignBar({ model, levelId, levelName, darkMode, onApply, onUndo, focusSignal }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [prompt, setPrompt] = useState('');
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ report: AiPlanReport; summary?: string; assumptions: string[]; level: string } | null>(null);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState(getStoredKey());
  const [enginePref, setEnginePrefState] = useState<AiEnginePref>(getEnginePref());
  const [claudeHere, setClaudeHere] = useState(false);
  useEffect(() => {
    let alive = true;
    void claudeAvailable().then((ok) => alive && setClaudeHere(ok));
    return () => {
      alive = false;
    };
  }, []);
  const [aiModel, setAiModel] = useState(getStoredModel());
  const [modeChoice, setMode] = useState<ApplyMode | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasPlan = levelHasPlan(model, levelId);
  const starter = isStarterSample(model);
  // default: a fresh project while the starter house is loaded, otherwise replace this level
  const mode: ApplyMode = modeChoice ?? (starter ? 'new' : 'replace');
  const showMode = hasPlan || starter || model.entities.length > 0;
  const units = model.settings.units;

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    if (!focusSignal) return;
    setCollapsed(false);
    setTimeout(() => textRef.current?.focus(), 50);
  }, [focusSignal]);

  // auto-grow the textarea up to ~5 lines
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [prompt, collapsed]);

  const attach = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setSketch(await prepareSketch(file));
      setResult(null);
      setTimeout(() => textRef.current?.focus(), 30);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const generate = useCallback(async () => {
    if (busy) return;
    if (!sketch && !prompt.trim()) {
      setError('Add a sketch with + or describe the plan you want.');
      textRef.current?.focus();
      return;
    }
    const { engine, reason } = await pickEngine();
    if (!engine) {
      setSettingsOpen(true);
      setError(reason ?? 'Add your Gemini API key first. It takes a minute and is free.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const plan = await requestAiPlan({ prompt, sketch, units, model: aiModel, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      const applyMode: ApplyMode = showMode ? mode : 'replace';
      const { model: next, report, levelId: usedLevel } = applyAiPlan(model, plan, levelId, applyMode, `ai${Date.now().toString(36)}`);
      onApply(next, sketch ? 'AI plan from sketch' : 'AI plan from prompt', report);
      const lvlName = (next.levels ?? []).find((l) => l.id === usedLevel)?.name ?? levelName;
      setResult({ report, summary: plan.summary, assumptions: plan.assumptions ?? [], level: applyMode === 'new' ? `a new project (${lvlName})` : lvlName });
      setMode(null);
      setShowAllNotes(false);
      setPrompt('');
      setSketch(null);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (e instanceof AiDesignError && e.needsKey) setSettingsOpen(true);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
    }
  }, [aiModel, busy, levelId, levelName, mode, model, onApply, prompt, showMode, sketch, units]);

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void generate();
    } else if (e.key === 'Escape') {
      (e.target as HTMLTextAreaElement).blur();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      void attach(item.getAsFile());
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void attach(e.dataTransfer.files?.[0]);
  };

  const saveSettings = () => {
    setStoredKey(keyDraft);
    setStoredModel(aiModel);
    setEnginePref(enginePref);
    setSettingsOpen(false);
    setError(null);
  };

  const card = darkMode ? 'bg-stone-900/95 border-stone-700 text-stone-100' : 'bg-white/95 border-stone-300 text-stone-900';
  const sub = darkMode ? 'text-stone-400' : 'text-stone-500';
  const chip = darkMode ? 'bg-stone-800 border-stone-700' : 'bg-stone-100 border-stone-200';

  if (collapsed) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
        <button
          type="button"
          onClick={() => {
            setCollapsed(false);
            setTimeout(() => textRef.current?.focus(), 50);
          }}
          className="flex items-center gap-2 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium pl-3 pr-4 py-2 shadow-lg shadow-amber-900/20"
          title="Design with AI (type AI in the command line)"
        >
          <Sparkles className="w-4 h-4" /> Design with AI
        </button>
      </div>
    );
  }

  const sizeText = (r: AiPlanReport) => `${formatLength(r.width, units)} × ${formatLength(r.depth, units)}`;
  const counts = (r: AiPlanReport) =>
    [
      `${r.walls} walls`,
      r.doors ? `${r.doors} door${r.doors > 1 ? 's' : ''}` : '',
      r.windows ? `${r.windows} window${r.windows > 1 ? 's' : ''}` : '',
      r.openings ? `${r.openings} opening${r.openings > 1 ? 's' : ''}` : '',
      r.rooms ? `${r.rooms} room${r.rooms > 1 ? 's' : ''}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  const notes = result ? [...result.assumptions, ...result.report.skipped] : [];

  return (
    <div
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[min(680px,calc(100%-32px))] flex flex-col gap-2"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* ---- settings */}
      {settingsOpen && (
        <div className={`rounded-xl border shadow-lg p-4 text-sm ${card}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 font-semibold">
              <KeyRound className="w-4 h-4 text-amber-600" /> AI settings
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} className={`p-1 rounded hover:bg-stone-500/10 ${sub}`} aria-label="Close settings">
              <X className="w-4 h-4" />
            </button>
          </div>
          <label className="block text-xs font-medium mb-1">AI engine</label>
          <select
            aria-label="AI engine"
            value={enginePref}
            onChange={(e) => setEnginePrefState(e.target.value as AiEnginePref)}
            className={`w-full rounded-md border px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-amber-500 mb-1 ${chip}`}
          >
            <option value="auto">Automatic — Claude in claude.ai, otherwise Gemini</option>
            <option value="claude">Claude (your claude.ai account, no key)</option>
            <option value="gemini">Gemini (API key)</option>
          </select>
          <p className={`mb-3 text-xs ${sub}`}>
            {claudeHere ? 'Claude is available on this page — no key needed. Photoreal renders still use Gemini.' : 'Claude is available when ARCHIFORMA is opened as an artifact in claude.ai.'}
          </p>
          <label className="block text-xs font-medium mb-1">Gemini API key</label>
          <input
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') saveSettings();
            }}
            placeholder={hasBuiltInKey() ? 'Using the key from AI Studio (optional override)' : 'Paste your key (starts with AIza…)'}
            className={`w-full rounded-md border px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-amber-500 ${chip}`}
            autoComplete="off"
            spellCheck={false}
          />
          <p className={`mt-1.5 text-xs ${sub}`}>
            Get a free key at{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-amber-600 underline">
              aistudio.google.com/apikey
            </a>
            . It is saved only in this browser.
          </p>
          <label className="block text-xs font-medium mt-3 mb-1">Model</label>
          <select
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            className={`w-full rounded-md border px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-amber-500 ${chip}`}
          >
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setSettingsOpen(false)} className={`px-3 py-1.5 rounded-md text-xs border ${chip}`}>
              Cancel
            </button>
            <button type="button" onClick={saveSettings} aria-label="Save AI settings" className="px-3 py-1.5 rounded-md text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white">
              Save
            </button>
          </div>
        </div>
      )}

      {/* ---- result */}
      {result && !busy && (
        <div className={`rounded-xl border shadow-lg p-3 text-sm ${card}`} role="status">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 rounded-full bg-green-600 text-white p-0.5 shrink-0">
              <Check className="w-3 h-3" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                Plan added to {result.level}: <span className="font-mono text-xs">{sizeText(result.report)}</span>
              </div>
              <div className={`text-xs mt-0.5 ${sub}`}>{counts(result.report)}</div>
              {result.summary && <div className="text-xs mt-1.5">{result.summary}</div>}
              {notes.length > 0 && (
                <ul className={`text-xs mt-1.5 space-y-0.5 list-disc pl-4 ${sub}`}>
                  {(showAllNotes ? notes : notes.slice(0, 3)).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                  {notes.length > 3 && !showAllNotes && (
                    <li className="list-none -ml-4">
                      <button type="button" className="text-amber-600 underline" onClick={() => setShowAllNotes(true)}>
                        {notes.length - 3} more notes
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  onUndo();
                  setResult(null);
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs border ${chip}`}
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" /> Undo
              </button>
              <button type="button" onClick={() => setResult(null)} className={`p-1 rounded hover:bg-stone-500/10 ${sub}`} aria-label="Dismiss">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- error */}
      {error && !busy && (
        <div className="rounded-lg border border-red-300 bg-red-50 text-red-800 dark:bg-red-950/80 dark:border-red-800 dark:text-red-200 px-3 py-2 text-xs flex items-start gap-2 shadow">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ---- prompt bar */}
      <div
        className={`rounded-2xl border shadow-xl backdrop-blur transition-colors ${card} ${
          dragOver ? 'ring-2 ring-amber-500 border-amber-500' : ''
        }`}
      >
        {sketch && (
          <div className="px-3 pt-3">
            <div className={`inline-flex items-center gap-2 rounded-lg border p-1 pr-2 ${chip}`}>
              {sketch.previewUrl ? (
                <img src={sketch.previewUrl} alt="Attached sketch" className="h-12 w-12 rounded object-cover bg-white" />
              ) : (
                <div className="h-12 w-12 rounded bg-white flex items-center justify-center">
                  <FileText className="w-6 h-6 text-stone-500" />
                </div>
              )}
              <div className="text-xs max-w-[180px]">
                <div className="truncate font-medium">{sketch.name}</div>
                <div className={sub}>Sketch attached</div>
              </div>
              <button type="button" onClick={() => setSketch(null)} className={`p-1 rounded hover:bg-stone-500/10 ${sub}`} aria-label="Remove sketch" disabled={busy}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2 p-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className={`shrink-0 h-9 w-9 rounded-full border flex items-center justify-center hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 ${chip}`}
            title="Add a sketch, photo or PDF of a floor plan"
            aria-label="Add a sketch"
          >
            <Plus className="w-5 h-5" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              void attach(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <textarea
            ref={textRef}
            rows={1}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            disabled={busy}
            placeholder={sketch ? 'Add notes (optional): "overall 40 ft wide", "rename room 3 to Office"…' : 'Describe a plan, or click + to add your sketch…'}
            className="flex-1 resize-none bg-transparent outline-none text-sm leading-6 py-1.5 placeholder:text-stone-400 disabled:opacity-60"
            aria-label="Describe the plan for AI"
          />
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className={`shrink-0 h-9 w-9 rounded-full flex items-center justify-center hover:bg-stone-500/10 ${sub}`}
            title="AI settings (API key, model)"
            aria-label="AI settings"
          >
            <Settings2 className="w-4 h-4" />
          </button>
          {busy ? (
            <button
              type="button"
              onClick={cancel}
              className="shrink-0 h-9 px-3 rounded-full bg-stone-700 hover:bg-stone-800 text-white text-xs font-medium flex items-center gap-1.5"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!sketch && !prompt.trim()}
              className="shrink-0 h-9 w-9 rounded-full bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300 dark:disabled:bg-stone-700 text-white flex items-center justify-center"
              title="Generate plan (Enter)"
              aria-label="Generate plan"
            >
              <ArrowUp className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className={`flex items-center gap-2 px-3 pb-2 -mt-1 text-[11px] ${sub}`}>
          {busy ? (
            <span className="flex items-center gap-1.5 text-amber-600 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {sketch ? 'Reading your sketch and drawing the plan…' : 'Designing your plan…'} (10–40 s)
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" /> Design with AI · {levelName}
            </span>
          )}
          {showMode && !busy && (
            <label className="relative flex items-center">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as ApplyMode)}
                className={`appearance-none rounded border pl-2 pr-6 py-0.5 text-[11px] outline-none ${chip}`}
                title="Where the generated plan goes"
              >
                <option value="new">New project from this</option>
                <option value="replace">Replace everything on {levelName}</option>
                {hasPlan && <option value="beside">Add beside current plan</option>}
              </select>
              <ChevronDown className="w-3 h-3 absolute right-1.5 pointer-events-none" />
            </label>
          )}
          <span className="flex-1" />
          {!busy && !prompt && !sketch && (
            <button
              type="button"
              className="hidden sm:inline text-amber-600 hover:underline truncate max-w-[260px]"
              onClick={() => {
                setPrompt(EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);
                textRef.current?.focus();
              }}
              title="Fill in an example prompt"
            >
              Try an example
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="p-0.5 rounded hover:bg-stone-500/10"
            title="Minimize"
            aria-label="Minimize AI bar"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
