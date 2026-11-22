/**
 * AI ENGINE: one way for every AI feature (plan from sketch, automatic tracing, render looks) to
 * ask for structured JSON — through Claude when ARCHIFORMA runs as a claude.ai artifact (the
 * viewer's own Claude account, no key), or through Gemini with the user's / AI Studio's key.
 * Photoreal image generation is Gemini-only (Claude does not make images).
 */
import { AiDesignError, getStoredModel, resolveApiKey } from './aiClient';

export type AiEngine = 'claude' | 'gemini';
export type AiEnginePref = 'auto' | AiEngine;

const PREF_KEY = 'archiforma_ai_engine_v1';

export function getEnginePref(): AiEnginePref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === 'claude' || v === 'gemini' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
export function setEnginePref(v: AiEnginePref) {
  try {
    if (v === 'auto') localStorage.removeItem(PREF_KEY);
    else localStorage.setItem(PREF_KEY, v);
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------------------------
// Claude through the artifact runtime (window.claude.use("sample"))
// ---------------------------------------------------------------------------------------------
type SampleFn = ((input: unknown, opts?: Record<string, unknown>) => Promise<{ text: string; truncated?: boolean }>) & {
  json: <T = unknown>(input: unknown, opts?: Record<string, unknown>) => Promise<T>;
  limits?: () => Promise<{ images?: { maxCount: number; maxBytes?: number; mediaTypes: string[] } }>;
};
let samplePromise: Promise<SampleFn | null> | null = null;

/** The Claude sample function when running inside a claude.ai artifact viewer, else null. */
export function claudeSample(): Promise<SampleFn | null> {
  if (!samplePromise) {
    const c = (globalThis as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    samplePromise = c?.use ? (c.use('sample') as Promise<SampleFn | null>).catch(() => null) : Promise.resolve(null);
  }
  return samplePromise;
}

/** True as soon as we know Claude can be asked (never blocks long outside a viewer). */
export async function claudeAvailable(): Promise<boolean> {
  return !!(await claudeSample());
}

/** Which engine a request will use, or null with the reason why none can. */
export async function pickEngine(): Promise<{ engine: AiEngine | null; reason?: string }> {
  const pref = getEnginePref();
  const gem = !!resolveApiKey();
  if (pref === 'gemini') return gem ? { engine: 'gemini' } : { engine: null, reason: 'Add your Gemini API key in AI settings.' };
  const claude = await claudeAvailable();
  if (pref === 'claude') return claude ? { engine: 'claude' } : { engine: null, reason: 'Claude is only available when ARCHIFORMA is opened as an artifact in claude.ai. Use Gemini here.' };
  if (claude) return { engine: 'claude' };
  if (gem) return { engine: 'gemini' };
  return { engine: null, reason: 'Add a Gemini API key in AI settings (or open ARCHIFORMA in claude.ai to use Claude).' };
}

export interface AiImage {
  mimeType: string;
  base64: string; // no data: prefix
}

const b64ToBlob = (img: AiImage) => {
  const bin = atob(img.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: img.mimeType });
};

export function dataUrlToImage(dataUrl: string): AiImage {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new AiDesignError('That image could not be read.');
  return { mimeType: m[1], base64: m[2] ? m[3] : btoa(decodeURIComponent(m[3])) };
}

function claudeError(e: unknown): AiDesignError {
  const code = (e as { code?: string })?.code;
  const map: Record<string, string> = {
    not_granted: 'Claude access was not allowed for this page. Allow it from the artifact\'s permissions, or use Gemini.',
    rate_limited: 'Claude is busy for this page right now. Wait a moment and try again.',
    images_unavailable: 'This page cannot send images to Claude here.',
    image_rejected: 'Claude could not read that image. Try a clearer or smaller one.',
    prompt_too_large: 'That request is too large for Claude. Try a smaller image or a shorter brief.',
    refused: 'Claude declined this request.',
    invalid_json: 'Claude did not return a usable answer. Try again.',
    empty_completion: 'Claude returned an empty answer. Try again.',
    cancelled: 'Cancelled.',
    sampling_disabled: 'Claude is turned off for this page.',
    session_expired: 'Your claude.ai session expired. Reload the page.',
  };
  if (code && map[code]) return new AiDesignError(map[code]);
  return new AiDesignError((e as { message?: string })?.message || 'Something went wrong talking to Claude.');
}

/**
 * Asks the chosen engine for JSON. `instructions` is the standing task (Gemini: system prompt),
 * `request` the specific ask; `schema` constrains Gemini and is spelled out for Claude.
 */
export async function askJson(args: {
  instructions: string;
  request: string;
  schema: Record<string, unknown>;
  image?: AiImage | null;
  signal?: AbortSignal;
  /** Claude effort: quick | default | complex */
  tier?: 'quick' | 'default' | 'complex';
  temperature?: number;
}): Promise<{ data: unknown; engine: AiEngine }> {
  const { engine, reason } = await pickEngine();
  if (!engine) throw new AiDesignError(reason ?? 'No AI engine is available.', true);

  if (engine === 'claude') {
    const sample = (await claudeSample())!;
    const prompt =
      `${args.instructions}\n\n${args.request}\n\n` +
      `Reply with ONE JSON object only (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(args.schema)}`;
    try {
      const data = await sample.json(prompt, {
        ...(args.image ? { images: [b64ToBlob(args.image)] } : {}),
        modelTier: args.tier ?? 'default',
        signal: args.signal,
        cache: false,
      });
      return { data, engine };
    } catch (e) {
      throw claudeError(e);
    }
  }

  // Gemini
  const apiKey = resolveApiKey();
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const parts: Array<Record<string, unknown>> = [];
  if (args.image) parts.push({ inlineData: { mimeType: args.image.mimeType, data: args.image.base64 } });
  parts.push({ text: args.request });
  const run = (model: string) =>
    ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: args.instructions,
        responseMimeType: 'application/json',
        responseJsonSchema: args.schema,
        temperature: args.temperature ?? 0.2,
        abortSignal: args.signal,
      },
    });
  let res;
  try {
    res = await run(getStoredModel());
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    if (/404|not found|not_found|is not supported/i.test(m)) res = await run('gemini-2.5-flash').catch((e2) => Promise.reject(geminiError(e2)));
    else throw geminiError(err);
  }
  const text = res.text ?? '';
  if (!text.trim()) throw new AiDesignError('Gemini returned an empty answer. Try again.');
  try {
    return { data: JSON.parse(text), engine };
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (m) return { data: JSON.parse(m[0]), engine };
    throw new AiDesignError('Gemini did not return usable JSON. Try again.');
  }
}

export function geminiError(err: unknown): AiDesignError {
  if (err instanceof AiDesignError) return err;
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();
  if (/api[_ ]?key|permission_denied|unauthenticated|401|403/.test(msg) && /invalid|not valid|denied|unauth|401|403|missing/.test(msg)) {
    return new AiDesignError('Gemini rejected the API key. Check it in AI settings.', true);
  }
  if (/429|quota|rate|resource_exhausted/.test(msg)) return new AiDesignError('Gemini is busy or your free quota is used up. Wait a minute and try again.');
  if (/safety|blocked/.test(msg)) return new AiDesignError('Gemini declined this image.');
  if (/failed to fetch|network|load failed|content security|csp/.test(msg)) return new AiDesignError("Couldn't reach Gemini from this page (no internet, or the page blocks outside connections).");
  if (/abort/.test(msg)) return new AiDesignError('Cancelled.');
  return new AiDesignError(raw.length > 220 ? `${raw.slice(0, 220)}…` : raw || 'Something went wrong talking to Gemini.');
}

/** Gemini image models, newest first; the first one that answers is used. */
export const GEMINI_IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview'];

/**
 * PHOTOREAL RENDER: Gemini image model repaints a 3D view as a photo, keeping its geometry.
 * Returns a data: URL. Needs a Gemini key (Claude cannot generate images).
 */
export async function geminiPhotoreal(args: { image: AiImage; prompt: string; signal?: AbortSignal }): Promise<string> {
  const apiKey = resolveApiKey();
  if (!apiKey) throw new AiDesignError('Photoreal renders use Gemini’s image model: add a Gemini API key in AI settings.', true);
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const text =
    'This is a 3D view of an architectural model. Turn it into a photorealistic architectural visualization. ' +
    'Keep the building geometry, proportions, camera angle, window and door positions exactly as shown; do not add or remove building parts. ' +
    'Replace flat colors with realistic materials, lighting, sky, landscaping and entourage as described. ' +
    `Look: ${args.prompt || 'natural daylight, realistic materials, soft shadows, landscaped surroundings'}`;
  let lastErr: unknown = null;
  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: args.image.mimeType, data: args.image.base64 } }, { text }] }],
        config: { responseModalities: ['IMAGE', 'TEXT'], abortSignal: args.signal },
      });
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p) => (p as { inlineData?: { data?: string } }).inlineData?.data) as { inlineData: { data: string; mimeType?: string } } | undefined;
      if (img) return `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`;
      lastErr = new AiDesignError('Gemini did not return an image. Try a different description.');
    } catch (e) {
      lastErr = e;
      const m = e instanceof Error ? e.message : String(e);
      if (!/404|not found|not_found|is not supported/i.test(m)) break;
    }
  }
  throw geminiError(lastErr);
}
