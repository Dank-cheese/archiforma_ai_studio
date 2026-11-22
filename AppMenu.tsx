/**
 * AF APPLICATION MENU (like AutoCAD's "A" menu): file commands on the left, your saved projects on
 * the right — open, rename, duplicate, download or delete them. Saved projects live in this browser.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, FilePlus2, FolderOpen, LayoutTemplate, Loader2, Pencil, Save, SaveAll, Search, Trash2, X } from 'lucide-react';
import type { ArchModel } from '../types/model';
import {
  deleteProject,
  duplicateProject,
  formatBytes,
  formatSavedAt,
  listProjects,
  loadProject,
  renameProject,
  type ProjectMeta,
} from '../engine/projectLibrary';

interface Props {
  darkMode: boolean;
  currentId: string | null;
  currentName: string;
  /** bump after any save so the list refreshes */
  refreshSignal: number;
  onClose: () => void;
  onNew: () => void;
  onTemplate: () => void;
  onOpenFile: (file: File) => void;
  onSave: () => Promise<boolean>;
  onSaveAs: (name: string) => Promise<boolean>;
  onDownloadCurrent: () => void;
  onDownloadModel: (model: ArchModel) => void;
  /** open a saved project; saveCurrent = store the drawing that is open now first */
  onOpenSaved: (id: string, saveCurrent: boolean) => Promise<void>;
  onError: (msg: string) => void;
}

export const AppMenu: React.FC<Props> = ({
  darkMode, currentId, currentName, refreshSignal, onClose, onNew, onTemplate, onOpenFile, onSave, onSaveAs, onDownloadCurrent, onDownloadModel, onOpenSaved, onError,
}) => {
  const [items, setItems] = useState<ProjectMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<string | null>(null);
  const [saveAsName, setSaveAsName] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    listProjects()
      .then((l) => {
        setItems(l);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        setItems([]);
        setLoadError(e instanceof Error ? e.message : String(e));
      });
  }, []);
  useEffect(refresh, [refresh, refreshSignal]);

  // close on Escape / click outside
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (panelRef.current?.contains(t) || t.closest('[data-testid="app-menu-button"]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [items, query]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const shell = darkMode ? 'bg-stone-900 border-stone-700 text-stone-100' : 'bg-white border-stone-200 text-stone-900';
  const sub = darkMode ? 'text-stone-400' : 'text-stone-500';
  const rowHover = darkMode ? 'hover:bg-stone-800' : 'hover:bg-stone-100';
  const field = `w-full px-2 py-1 rounded border text-xs ${darkMode ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`;
  const small = `p-1 rounded cursor-pointer disabled:opacity-40 ${darkMode ? 'hover:bg-stone-700' : 'hover:bg-stone-200'}`;
  const cmd = (icon: React.ReactNode, label: string, hint: string, onClick: () => void, testId: string, kbd?: string) => (
    <button type="button" onClick={onClick} data-testid={testId} className={`w-full flex items-start gap-2.5 px-2.5 py-2 rounded-md text-left cursor-pointer ${rowHover}`}>
      <span className="mt-0.5 text-amber-600">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center justify-between gap-2 text-[13px] font-medium">
          {label}
          {kbd && <kbd className={`text-[10px] font-mono ${sub}`}>{kbd}</kbd>}
        </span>
        <span className={`block text-[11px] ${sub}`}>{hint}</span>
      </span>
    </button>
  );

  const isCurrent = (id: string) => id === currentId;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="ARCHIFORMA menu"
      data-testid="app-menu"
      className={`fixed z-50 left-3 top-14 w-[min(760px,calc(100vw-1.5rem))] max-h-[calc(100vh-5rem)] flex flex-col sm:flex-row rounded-xl border shadow-2xl overflow-hidden ${shell}`}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        data-testid="app-menu-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) {
            onOpenFile(f);
            onClose();
          }
        }}
      />
      {/* FILE COMMANDS */}
      <div className={`sm:w-64 shrink-0 p-2 border-b sm:border-b-0 sm:border-r overflow-y-auto ${darkMode ? 'border-stone-800 bg-stone-950/40' : 'border-stone-200 bg-stone-50'}`}>
        <div className={`px-2.5 pt-1 pb-2 text-[10px] font-semibold uppercase tracking-wider ${sub}`}>File</div>
        {cmd(<FilePlus2 className="w-4 h-4" />, 'New', 'Blank project (Ctrl+Z goes back)', () => { onNew(); onClose(); }, 'app-new')}
        {cmd(<LayoutTemplate className="w-4 h-4" />, 'New from template', 'House, studio, office, restaurant…', () => { onTemplate(); onClose(); }, 'app-template')}
        {cmd(<FolderOpen className="w-4 h-4" />, 'Open file…', 'A project .json from your computer', () => fileRef.current?.click(), 'app-open-file')}
        {cmd(
          busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />,
          'Save',
          currentId ? `Update "${currentName || 'Untitled project'}" in your projects` : 'Add this drawing to your projects',
          () => void run('save', onSave),
          'app-save',
          'Ctrl+S'
        )}
        {saveAsName === null ? (
          cmd(<SaveAll className="w-4 h-4" />, 'Save as…', 'Keep a separate copy under a new name', () => setSaveAsName(`${currentName || 'Untitled project'} (copy)`), 'app-save-as')
        ) : (
          <form
            className="px-2.5 py-2 space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const n = saveAsName;
              setSaveAsName(null);
              void run('saveas', () => onSaveAs(n));
            }}
          >
            <label htmlFor="app-save-as-name" className="text-[11px] font-medium">Save a copy as</label>
            <input id="app-save-as-name" autoFocus value={saveAsName} onChange={(e) => setSaveAsName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className={field} />
            <div className="flex gap-1.5">
              <button type="submit" className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold cursor-pointer" data-testid="app-save-as-confirm">Save copy</button>
              <button type="button" onClick={() => setSaveAsName(null)} className={`px-2 py-1 rounded text-[11px] cursor-pointer ${rowHover}`}>Cancel</button>
            </div>
          </form>
        )}
        {cmd(<Download className="w-4 h-4" />, 'Download (.json)', 'A file you can back up or open elsewhere', () => { onDownloadCurrent(); onClose(); }, 'app-download')}
      </div>

      {/* SAVED PROJECTS */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="flex items-center gap-2 px-3 pt-3 pb-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Your projects</div>
            <div className={`text-[11px] ${sub}`}>Saved in this browser. Download a project to keep a copy elsewhere.</div>
          </div>
          <button type="button" aria-label="Close menu" onClick={onClose} className={small}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {(items?.length ?? 0) > 5 && (
          <div className="px-3 pb-2">
            <div className="relative">
              <Search className={`w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 ${sub}`} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Find a project"
                aria-label="Find a project"
                className={`${field} pl-7`}
              />
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2 pb-2 min-h-[12rem]" data-testid="app-projects">
          {items === null ? (
            <div className={`flex items-center gap-2 px-2 py-6 text-xs ${sub}`}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your projects…
            </div>
          ) : loadError ? (
            <div className="px-2 py-4 text-xs text-red-600 dark:text-red-400">{loadError}</div>
          ) : !items.length ? (
            <div className={`px-3 py-8 text-center text-xs ${sub}`}>
              <div className="font-medium mb-1">No saved projects yet</div>
              Press <b>Save</b> (or Ctrl+S) to add the drawing you are working on. Every project you save shows up here.
            </div>
          ) : !shown.length ? (
            <div className={`px-3 py-6 text-xs ${sub}`}>No project matches "{query}".</div>
          ) : (
            <ul className="space-y-1">
              {shown.map((p) => (
                <li
                  key={p.id}
                  data-testid="app-project"
                  data-project-id={p.id}
                  className={`group flex items-center gap-3 p-1.5 rounded-lg border ${
                    isCurrent(p.id) ? 'border-amber-500/60 bg-amber-500/5' : `border-transparent ${rowHover}`
                  }`}
                >
                  <button
                    type="button"
                    title={isCurrent(p.id) ? 'This is the project you have open' : `Open ${p.name}`}
                    onClick={() => {
                      if (isCurrent(p.id)) return onClose();
                      setConfirmDelete(null);
                      setConfirmOpen(p.id);
                    }}
                    className="shrink-0 cursor-pointer"
                    aria-label={`Open ${p.name}`}
                  >
                    {p.thumb ? (
                      <img src={p.thumb} alt="" className={`w-20 h-[50px] rounded border object-cover ${darkMode ? 'border-stone-700' : 'border-stone-200'}`} />
                    ) : (
                      <div className={`w-20 h-[50px] rounded border ${darkMode ? 'border-stone-700 bg-stone-800' : 'border-stone-200 bg-stone-100'}`} />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    {renaming?.id === p.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const r = renaming;
                          setRenaming(null);
                          void run(`rename-${p.id}`, () => renameProject(r.id, r.name));
                        }}
                      >
                        <input
                          autoFocus
                          aria-label="New project name"
                          value={renaming.name}
                          onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                          className={field}
                        />
                      </form>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[13px] font-medium truncate">{p.name}</span>
                        {isCurrent(p.id) && <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-px rounded bg-amber-600 text-white">Open</span>}
                      </div>
                    )}
                    <div className={`text-[11px] tabular-nums ${sub}`}>
                      {formatSavedAt(p.savedAt)} · {p.walls} wall{p.walls === 1 ? '' : 's'} · {p.levels} level{p.levels === 1 ? '' : 's'} · {formatBytes(p.bytes)}
                    </div>
                    {confirmOpen === p.id && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]" data-testid="app-confirm-open">
                        {currentId ? (
                          <>
                            <span className={sub}>Your open drawing is saved first.</span>
                            <button type="button" className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer" onClick={() => void run(`open-${p.id}`, () => onOpenSaved(p.id, true))} data-testid="app-open-confirm">
                              Open
                            </button>
                          </>
                        ) : (
                          <>
                            <span className={sub}>The drawing open now isn't saved here.</span>
                            <button type="button" className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer" onClick={() => void run(`open-${p.id}`, () => onOpenSaved(p.id, true))} data-testid="app-open-save-first">
                              Save it, then open
                            </button>
                            <button type="button" className={`px-2 py-0.5 rounded border cursor-pointer ${darkMode ? 'border-stone-700' : 'border-stone-300'} ${rowHover}`} onClick={() => void run(`open-${p.id}`, () => onOpenSaved(p.id, false))} data-testid="app-open-anyway">
                              Open without saving
                            </button>
                          </>
                        )}
                        <button type="button" className={`px-1.5 py-0.5 rounded cursor-pointer ${rowHover}`} onClick={() => setConfirmOpen(null)}>
                          Cancel
                        </button>
                        {busy === `open-${p.id}` && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      </div>
                    )}
                    {confirmDelete === p.id && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" data-testid="app-confirm-delete">
                        <span className="text-red-600 dark:text-red-400">Delete "{p.name}" from this browser?</span>
                        <button type="button" className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-semibold cursor-pointer" onClick={() => { setConfirmDelete(null); void run(`del-${p.id}`, () => deleteProject(p.id)); }} data-testid="app-delete-confirm">
                          Delete
                        </button>
                        <button type="button" className={`px-1.5 py-0.5 rounded cursor-pointer ${rowHover}`} onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100 focus-within:opacity-100">
                    <button type="button" className={small} title="Rename" aria-label={`Rename ${p.name}`} onClick={() => setRenaming({ id: p.id, name: p.name })}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className={small} title="Duplicate" aria-label={`Duplicate ${p.name}`} disabled={!!busy} onClick={() => void run(`dup-${p.id}`, () => duplicateProject(p.id))}>
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className={small}
                      title="Download (.json)"
                      aria-label={`Download ${p.name}`}
                      onClick={() =>
                        void run(`dl-${p.id}`, async () => {
                          const m = await loadProject(p.id);
                          if (m) onDownloadModel(m);
                        })
                      }
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className={`${small} hover:text-red-600`}
                      title={isCurrent(p.id) ? 'This project is open — open another one to delete it' : 'Delete'}
                      aria-label={`Delete ${p.name}`}
                      disabled={isCurrent(p.id)}
                      onClick={() => {
                        setConfirmOpen(null);
                        setConfirmDelete(p.id);
                      }}
                      data-testid="app-delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppMenu;
