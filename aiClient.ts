/**
 * Gemini connection for "Design with AI".
 *
 * API key, in order:
 *   1. a key the user pasted into the AI settings (kept only in this browser's localStorage)
 *   2. GEMINI_API_KEY provided by Google AI Studio (injected at build time by vite.config.ts)
 * Public builds (GitHub Pages, docs/index.html) never contain a key: each visitor uses their own.
 */
import { AI_PLAN_SCHEMA, AI_PLAN_SYSTEM_PROMPT, buildAiUserPrompt, parseAiPlan, type AiPlan } from './aiPlan';

const KEY_STORAGE = 'archiforma_gemini_key_v1';
const MODEL_STORAGE = 'archiforma_gemini_model_v1';

export const AI_MODELS: Array<{ id: string; label: string }> = [
  { id: 'gemini-flash-latest', label: 'Gemini Flash (fast)' },
  { id: 'gemini-pro-latest', label: 'Gemini Pro (most accurate, slower)' },
];

function envKey(): string {
  let k = '';
  try {
    // Vite `define` replaces this exact expression with a string at build time.
    // Without it (plain browser), `process` is undefined and the catch below applies.
    k = process.env.GEMINI_API_KEY || '';
  } catch {
    k = '';
  }
  return k && !/^MY_/i.test(k) ? k : '';
}

export function getStoredKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}
export function setStoredKey(key: string) {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
}
export function hasBuiltInKey(): boolean {
  return !!envKey();
}
export function resolveApiKey(): string {
  return getStoredKey() || envKey();
}
export function getStoredModel(): string {
  try {
    return localStorage.getItem(MODEL_STORAGE) || AI_MODELS[0].id;
  } catch {
    return AI_MODELS[0].id;
  }
}
export function setStoredModel(model: string) {
  try {
    localStorage.setItem(MODEL_STORAGE, model);
  } catch {
    /* storage unavailable */
  }
}

export interface SketchInput {
  mimeType: string;
  base64: string; // no data: prefix
}

export class AiDesignError extends Error {
  constructor(message: string, readonly needsKey = false) {
    super(message);
  }
}

/** Sends the brief (and sketch, if any) to the AI engine (Claude in claude.ai, or Gemini) and returns the parsed plan. */
export async function requestAiPlan(args: {
  prompt: string;
  sketch: SketchInput | null;
  units: 'imperial' | 'metric';
  model?: string;
  signal?: AbortSignal;
}): Promise<AiPlan> {
  const { askJson } = await import('./aiEngine');
  const { data } = await askJson({
    instructions: AI_PLAN_SYSTEM_PROMPT,
    request: buildAiUserPrompt(args.prompt, !!args.sketch, args.units),
    schema: AI_PLAN_SCHEMA as Record<string, unknown>,
    image: args.sketch,
    signal: args.signal,
    tier: 'default',
  });
  return parseAiPlan(JSON.stringify(data));
}
