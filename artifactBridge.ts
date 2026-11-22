/**
 * ARTIFACT BRIDGE: when ARCHIFORMA runs as a claude.ai artifact, a plain <a download> click
 * cannot save a file (the page runs in a sandboxed frame). This routes every download the app
 * makes — PNG, PDF, DXF, JSON, video… — through the viewer's `downloads` capability, which asks
 * the viewer to confirm the save. Files whose extension the platform does not accept (e.g. .dxf,
 * .ctb, .archiforma) are wrapped in a .zip so they can still be saved.
 * Outside claude.ai nothing is patched and downloads work as usual.
 */

type SaveFn = (req: { filename: string; data: Blob | string | ArrayBuffer }) => Promise<{ status: string }>;
type Notify = (msg: string, kind: 'success' | 'error' | 'info') => void;

const ALLOWED = new Set(
  'gif png jpg jpeg webp mp4 webm mov txt json md docx pptx epub csv ttf html svg pdf xlsx zip fig'.split(' ')
);

let notify: Notify = () => {};
export function setDownloadNotifier(fn: Notify) {
  notify = fn;
}

// ---------------------------------------------------------------- minimal ZIP (stored, no compression)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A one-file .zip (method 0 = stored) — enough to carry a DXF / CTB past the extension allowlist. */
export function zipSingle(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const crc = crc32(data);
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(6, 0x0800, true); // UTF-8 names
  lv.setUint16(8, 0, true);
  lv.setUint16(10, dosTime, true);
  lv.setUint16(12, dosDate, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, nameBytes.length, true);
  lv.setUint16(28, 0, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(8, 0x0800, true);
  cv.setUint16(10, 0, true);
  cv.setUint16(12, dosTime, true);
  cv.setUint16(14, dosDate, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true); // local header offset
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const out = new Uint8Array(local.length + data.length + central.length + end.length);
  out.set(local, 0);
  out.set(data, local.length);
  out.set(central, local.length + data.length);
  out.set(end, local.length + data.length + central.length);
  return out;
}

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();

let savePromise: Promise<SaveFn | null> | null = null;
function downloadsCapability(): Promise<SaveFn | null> {
  if (!savePromise) {
    const c = (globalThis as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    savePromise = c?.use
      ? (c.use('downloads') as Promise<{ save: SaveFn } | null>).then((d) => (d ? d.save.bind(d) : null)).catch(() => null)
      : Promise.resolve(null);
  }
  return savePromise;
}

/** Saves a Blob through the artifact capability. Resolves false when the capability is absent. */
export async function saveViaArtifact(blob: Blob, filename: string): Promise<boolean> {
  const save = await downloadsCapability();
  if (!save) return false;
  let name = filename || 'archiforma-file.txt';
  let data: Blob = blob;
  if (!ALLOWED.has(extOf(name))) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    data = new Blob([zipSingle(name, bytes) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    name = `${name}.zip`;
  }
  try {
    await save({ filename: name, data });
    notify(name.endsWith('.zip') && name !== filename ? `Saved ${name} (unzip it to get ${filename}).` : `Saved ${name}.`, 'success');
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'declined') notify('Download cancelled.', 'info');
    else if (code === 'rate_limited') notify('A save prompt is already open — finish it, then try again.', 'info');
    else if (code === 'too_large') notify('That file is too large to save here.', 'error');
    else notify(`Could not save ${name} here (${code || 'unavailable'}).`, 'error');
  }
  return true;
}

let installed = false;
/**
 * Inside a claude.ai artifact: remember the Blob behind each object URL and turn
 * `<a download href="blob:|data:">.click()` into a capability save.
 */
export function installArtifactDownloads(retries = 6) {
  if (installed || typeof window === 'undefined') return;
  const c = (window as unknown as { claude?: { use?: unknown } }).claude;
  if (!c || typeof c.use !== 'function') {
    // the viewer may attach window.claude a moment after the first script runs
    if (retries > 0 && window.parent !== window) setTimeout(() => installArtifactDownloads(retries - 1), 250);
    return;
  }
  installed = true;
  const blobs = new Map<string, Blob>();
  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const url = origCreate(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    // apps revoke right after click(); keep the Blob for the async save
    setTimeout(() => {
      blobs.delete(url);
      origRevoke(url);
    }, 120_000);
  };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const href = this.href || '';
    if (this.hasAttribute('download') && (href.startsWith('blob:') || href.startsWith('data:'))) {
      const filename = this.getAttribute('download') || 'download';
      const known = blobs.get(href);
      void (async () => {
        try {
          const blob = known ?? (await (await fetch(href)).blob());
          const handled = await saveViaArtifact(blob, filename);
          if (!handled) origClick.call(this);
        } catch {
          notify(`Could not prepare ${filename}.`, 'error');
        }
      })();
      return;
    }
    origClick.call(this);
  };
}
