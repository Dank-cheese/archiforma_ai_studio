import React, { useEffect, useMemo, useState } from 'react';
import { LayoutTemplate, X } from 'lucide-react';
import type { ArchModel, BlockInstanceEntity, RoomEntity, UnitSystem, WallEntity } from '../types/model';
import { PLAN_TEMPLATES, buildTemplateModel, templateSizeLabel, type PlanTemplate, type TemplateCategory } from '../engine/templates';
import { computeModelExtents } from '../engine/geometry';

interface Props {
  open: boolean;
  units: UnitSystem;
  darkMode: boolean;
  onChoose: (model: ArchModel, tpl: PlanTemplate) => void;
  onClose: () => void;
}

/** Small schematic of a template: rooms, walls and furniture footprints. */
const Preview: React.FC<{ model: ArchModel; dark: boolean }> = ({ model, dark }) => {
  const walls = model.entities.filter((e): e is WallEntity => e.type === 'wall');
  if (!walls.length) {
    return <div className={`h-full flex items-center justify-center text-[11px] ${dark ? 'text-stone-500' : 'text-stone-400'}`}>Empty level</div>;
  }
  const ext = computeModelExtents(walls);
  const pad = 18;
  const vb = `${ext.minX - pad} ${ext.minY - pad} ${ext.maxX - ext.minX + pad * 2} ${ext.maxY - ext.minY + pad * 2}`;
  const rooms = model.entities.filter((e): e is RoomEntity => e.type === 'room');
  const furn = model.entities.filter((e): e is BlockInstanceEntity => e.type === 'block');
  const ink = dark ? '#e7e5e4' : '#292524';
  return (
    <svg viewBox={vb} className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {rooms.map((r, i) => (
        <polygon key={r.id} points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill={['#fde68a', '#bfdbfe', '#bbf7d0', '#fecaca', '#ddd6fe', '#fed7aa'][i % 6]} opacity={dark ? 0.22 : 0.45} />
      ))}
      {furn.map((f) => (
        <rect
          key={f.id}
          x={f.position.x - f.width / 2}
          y={f.position.y - f.depth / 2}
          width={f.width}
          height={f.depth}
          transform={`rotate(${-f.rotation} ${f.position.x} ${f.position.y})`}
          fill="none"
          stroke={dark ? '#a8a29e' : '#78716c'}
          strokeWidth={2}
        />
      ))}
      {walls.map((w) => (
        <line key={w.id} x1={w.start.x} y1={w.start.y} x2={w.end.x} y2={w.end.y} stroke={ink} strokeWidth={Math.max(4, w.thickness)} strokeLinecap="square" />
      ))}
    </svg>
  );
};

export const TemplateGallery: React.FC<Props> = ({ open, units, darkMode, onChoose, onClose }) => {
  const [cat, setCat] = useState<'All' | TemplateCategory>('All');
  const built = useMemo(() => (open ? PLAN_TEMPLATES.map((t) => ({ t, model: buildTemplateModel(t, units) })) : []), [open, units]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const shown = built.filter(({ t }) => cat === 'All' || t.category === cat);
  const card = darkMode ? 'bg-stone-900 border-stone-700 hover:border-amber-500' : 'bg-white border-stone-200 hover:border-amber-500';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Template gallery"
        data-testid="template-gallery"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-4xl max-h-[88vh] overflow-hidden flex flex-col rounded-xl border shadow-2xl ${darkMode ? 'bg-stone-950 border-stone-800 text-stone-100' : 'bg-stone-50 border-stone-200 text-stone-800'}`}
      >
        <div className={`flex items-center gap-3 px-5 py-3 border-b ${darkMode ? 'border-stone-800' : 'border-stone-200'}`}>
          <LayoutTemplate className="w-5 h-5 text-amber-600" />
          <div className="flex-1">
            <div className="font-semibold">Start from a template</div>
            <div className={`text-xs ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>Real walls, doors, windows, rooms and furniture you can edit. Replaces the current project — Ctrl+Z brings it back.</div>
          </div>
          <button type="button" aria-label="Close template gallery" onClick={onClose} className="p-1.5 rounded hover:bg-stone-500/15 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-1.5 px-5 pt-3">
          {(['All', 'Residential', 'Commercial', 'Start'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              aria-pressed={cat === c}
              className={`px-3 py-1 rounded-full text-xs font-medium border cursor-pointer ${
                cat === c ? 'bg-amber-600 border-amber-600 text-white' : darkMode ? 'border-stone-700 hover:bg-stone-800' : 'border-stone-300 hover:bg-white'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {shown.map(({ t, model }) => (
            <button
              key={t.id}
              type="button"
              data-template-id={t.id}
              aria-label={`Use template ${t.name}`}
              onClick={() => onChoose(model, t)}
              className={`text-left rounded-lg border-2 overflow-hidden transition-colors cursor-pointer ${card}`}
            >
              <div className={`h-40 p-2 ${darkMode ? 'bg-stone-900' : 'bg-stone-100'}`}>
                <Preview model={model} dark={darkMode} />
              </div>
              <div className="p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-sm">{t.name}</div>
                  <div className="text-[10px] uppercase tracking-wide text-amber-600 font-semibold">{t.category}</div>
                </div>
                {templateSizeLabel(t, units) && <div className={`text-[11px] font-mono mt-0.5 ${darkMode ? 'text-stone-400' : 'text-stone-500'}`}>{templateSizeLabel(t, units)}</div>}
                <div className={`text-xs mt-1 leading-snug ${darkMode ? 'text-stone-300' : 'text-stone-600'}`}>{t.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
