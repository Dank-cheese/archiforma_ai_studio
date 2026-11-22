/**
 * three.js console setup (imported once by every module that creates a WebGL renderer).
 *
 * On Windows, Chrome / Edge run WebGL through ANGLE on Direct3D. Its HLSL compiler reports
 * harmless precision notes such as
 *   "(209,41-69): warning X4122: sum of 1 and -1.49e-017 cannot be represented accurately…"
 * and three.js forwards them as "THREE.WebGLProgram: Program Info Log: …" warnings (AI Studio
 * shows them as AppWarnings). They do not affect rendering. This filter drops a Program Info
 * Log ONLY when every line in it is such a compiler warning; real shader errors (reported through
 * a different path) and every other three.js message are passed through unchanged.
 */
import * as THREE from 'three';

/** True for a shader log made only of D3D / ANGLE compiler warnings (no errors, nothing else). */
export function isOnlyDriverShaderWarnings(log: string): boolean {
  const lines = log
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((l) => /\bwarning X\d{4}\b/i.test(l) && !/\berror\b/i.test(l));
}

let installed = false;

export function installThreeConsoleFilter(): void {
  if (installed) return;
  installed = true;
  THREE.setConsoleFunction((type: string, message: string, ...params: unknown[]) => {
    if (type === 'warn' && /Program Info Log/.test(message)) {
      const text = params.filter((p): p is string => typeof p === 'string').join('\n');
      if (isOnlyDriverShaderWarnings(text)) return;
    }
    const out = type === 'error' ? console.error : type === 'warn' ? console.warn : console.log;
    const first = params[0] as { isStackTrace?: boolean; getError?: (m: string) => unknown } | undefined;
    if (first && first.isStackTrace && typeof first.getError === 'function') out(first.getError(message));
    else out(message, ...params);
  });
}

installThreeConsoleFilter();
