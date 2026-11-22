/**
 * PROJECT LIBRARY: every project you save is kept in this browser (IndexedDB, so large projects with
 * trace images fit — the single localStorage autosave stays as the crash-safe working copy).
 * The AF menu lists them; open, rename, duplicate, download or delete any of them.
 * Data never leaves the browser; Download (.json) is the way to move a project elsewhere.
 */
import type { ArchModel } from '../types/model';

export interface ProjectMeta {
  id: string;
  name: string;
  savedAt: number; // ms since epoch
  bytes: number;
  walls: number;
  levels: number;
  /** small plan thumbnail (data: URL), may be empty */
  thumb: string;
}

const DB_NAME = 'archiforma_projects';
const DB_VERSION = 1;
const META = 'meta';
const DATA = 'data';
const CURRENT_KEY = 'archiforma_current_library_id';

export class LibraryError extends Error {}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let req: IDBOpenDBRequest;
      try {
        if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        reject(new LibraryError('This browser is not letting ARCHIFORMA keep saved projects (private window or blocked site data). Use Download (.json) instead.'));
        return;
      }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(DATA)) d.createObjectStore(DATA);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new LibraryError('Could not open the saved-projects store in this browser. Use Download (.json) instead.'));
      req.onblocked = () => reject(new LibraryError('Close other ARCHIFORMA tabs, then try again.'));
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(stores, mode);
        let result: T;
        const r = run(t);
        if (r) r.onsuccess = () => (result = r.result);
        t.oncomplete = () => resolve(result);
        t.onabort = t.onerror = () => {
          const name = t.error?.name || '';
          reject(new LibraryError(/Quota/i.test(name) ? 'The browser is out of space for saved projects. Delete a few, or Download (.json) and remove it here.' : `Saving failed (${name || 'unknown error'}).`));
        };
      })
  );
}

export const newProjectId = () => `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function getCurrentLibraryId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}
export function setCurrentLibraryId(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await tx<ProjectMeta[]>([META], 'readonly', (t) => t.objectStore(META).getAll() as IDBRequest<ProjectMeta[]>);
  return (all || []).sort((a, b) => b.savedAt - a.savedAt);
}

export async function loadProject(id: string): Promise<ArchModel | null> {
  const m = await tx<ArchModel | undefined>([DATA], 'readonly', (t) => t.objectStore(DATA).get(id) as IDBRequest<ArchModel | undefined>);
  return m ?? null;
}

/** Saves (creates or replaces) a project; returns its metadata. */
export async function saveProject(id: string, model: ArchModel, name?: string): Promise<ProjectMeta> {
  const json = JSON.stringify(model);
  const meta: ProjectMeta = {
    id,
    name: (name ?? model.projectName ?? '').trim() || 'Untitled project',
    savedAt: Date.now(),
    bytes: json.length,
    walls: model.entities.filter((e) => e.type === 'wall').length,
    levels: model.levels?.length || 1,
    thumb: planThumbnail(model),
  };
  // store a plain clone (structured clone of the parsed JSON: no functions, no undefined surprises)
  const data = JSON.parse(json) as ArchModel;
  await tx([META, DATA], 'readwrite', (t) => {
    t.objectStore(DATA).put(data, id);
    t.objectStore(META).put(meta);
  });
  return meta;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const clean = name.trim() || 'Untitled project';
  const model = await loadProject(id);
  await tx([META, DATA], 'readwrite', (t) => {
    const ms = t.objectStore(META);
    const g = ms.get(id) as IDBRequest<ProjectMeta | undefined>;
    g.onsuccess = () => {
      if (g.result) ms.put({ ...g.result, name: clean });
    };
    if (model) t.objectStore(DATA).put({ ...model, projectName: clean }, id);
  });
}

export async function duplicateProject(id: string): Promise<ProjectMeta | null> {
  const model = await loadProject(id);
  if (!model) return null;
  const name = `${model.projectName || 'Untitled project'} (copy)`;
  return saveProject(newProjectId(), { ...model, projectName: name }, name);
}

export async function deleteProject(id: string): Promise<void> {
  await tx([META, DATA], 'readwrite', (t) => {
    t.objectStore(META).delete(id);
    t.objectStore(DATA).delete(id);
  });
}

// ------------------------------------------------------------------ thumbnails

/** Wall centre-lines (and room outlines) of the first level that has walls, normalized to 0–1. */
export function planThumbSegments(model: ArchModel): { segs: [number, number, number, number][]; aspect: number } {
  const walls = model.entities.filter((e) => e.type === 'wall') as Extract<ArchModel['entities'][number], { type: 'wall' }>[];
  if (!walls.length) return { segs: [], aspect: 1.6 };
  const byLevel = new Map<string, typeof walls>();
  for (const w of walls) {
    const k = (w as { levelId?: string }).levelId || 'level-1';
    byLevel.set(k, [...(byLevel.get(k) || []), w]);
  }
  const lvl = byLevel.get(model.activeLevelId || 'level-1') ?? [...byLevel.values()].sort((a, b) => b.length - a.length)[0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of lvl) {
    for (const p of [w.start, w.end]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const s = Math.max(w, h);
  return {
    segs: lvl.map((wl) => [(wl.start.x - minX) / s, (wl.start.y - minY) / s, (wl.end.x - minX) / s, (wl.end.y - minY) / s]),
    aspect: w / h,
  };
}

/** 160 × 100 PNG of the plan's walls; '' where no canvas is available. */
export function planThumbnail(model: ArchModel): string {
  try {
    if (typeof document === 'undefined') return '';
    const { segs, aspect } = planThumbSegments(model);
    const W = 160, H = 100, pad = 10;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) return '';
    g.fillStyle = '#f5f3ef';
    g.fillRect(0, 0, W, H);
    if (!segs.length) return c.toDataURL('image/png');
    // fit the normalized plan (longest side = 1) into the box, centred
    const boxW = W - pad * 2, boxH = H - pad * 2;
    const nw = aspect >= 1 ? 1 : aspect, nh = aspect >= 1 ? 1 / aspect : 1;
    const k = Math.min(boxW / nw, boxH / nh);
    const ox = (W - nw * k) / 2, oy = (H - nh * k) / 2;
    g.strokeStyle = '#3f3a33';
    g.lineWidth = 2;
    g.lineCap = 'square';
    g.beginPath();
    for (const [x1, y1, x2, y2] of segs) {
      g.moveTo(ox + x1 * k, oy + y1 * k);
      g.lineTo(ox + x2 * k, oy + y2 * k);
    }
    g.stroke();
    return c.toDataURL('image/png');
  } catch {
    return '';
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSavedAt(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const mins = Math.round((now - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today ${time}`;
  const yest = new Date(now - 86400000).toDateString() === d.toDateString();
  if (yest) return `yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' });
}
