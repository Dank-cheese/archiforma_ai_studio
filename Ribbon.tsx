/**
 * RIBBON: an AutoCAD-style tabbed ribbon (Home, Build, Structure, Insert, Annotate, View, Manage,
 * Output). Every button issues an ordinary command (so the command line, undo and step hints work
 * exactly as when typing), plus a few app actions (switch views, import / save files).
 */
import React, { useEffect, useState } from 'react';
import {
  AlignVerticalJustifyCenter, AppWindow, ArrowDownToLine, ArrowUpRight, Blocks, Box, BoxSelect, BrickWall, Camera, ChevronDown, ChevronUp, Circle,
  CircleDot, Columns3, Compass, Copy, CornerDownRight, DoorOpen, Eye, EyeOff, FileDown, FileInput, FilePlus2, FileUp, Fence, FlipHorizontal, FolderOpen,
  Frame, Grid2x2, Grid3x3, Hash, HelpCircle, Home, Keyboard, LayoutGrid, LayoutTemplate, Layers, Link2, Maximize2, Merge, Milestone, Minus,
  Move, PackagePlus, Paintbrush, PaintBucket, PanelTop, PencilRuler, Printer, Rows3, Rows4, Ruler, Save, Scale, ScanLine, Scissors, Shapes, Sofa, Sparkles,
  Spline, Split, Square, SquareDashed, SquareSplitVertical, Sun, Tag, Tally4, Tent, Trash2, TrendingUp, Triangle, Type, UnfoldHorizontal, Ungroup,
  Warehouse, Waypoints, Wrench, RotateCw, Slash, Anchor, RectangleHorizontal, Columns2, Mountain, Scan, Rotate3d, SlidersHorizontal, Palette, Spline as SplineIcon, Undo2,
} from 'lucide-react';
import type { Layer, LineTypeDef, ToolId } from '../types/model';
import { LineTypePreview } from './LineStyleControls';
import { BYLAYER, LINEWEIGHTS_MM, lineWeightLabel } from '../engine/lineStyles';
import { aciToHex } from '../engine/dxfExport';

type Icon = React.ComponentType<{ className?: string }>;
export type RibbonAction = 'view2d' | 'view3d' | 'split' | 'importDxf' | 'library' | 'saveJson' | 'openJson' | 'newBlank' | 'sample' | 'toggleGrid' | 'classic';
type Item = { label: string; icon: Icon; cmd?: string; action?: RibbonAction; tool?: ToolId; tip: string; large?: boolean };
type Panel = { title: string; items?: Item[]; custom?: 'properties' | 'layers' };
type Tab = { id: string; label: string; panels: Panel[] };

const it = (label: string, icon: Icon, cmd: string, tip: string, tool?: ToolId, large = false): Item => ({ label, icon, cmd, tip, tool, large });
const big = (label: string, icon: Icon, cmd: string, tip: string, tool?: ToolId): Item => it(label, icon, cmd, tip, tool, true);
const act = (label: string, icon: Icon, action: RibbonAction, tip: string, large = false): Item => ({ label, icon, action, tip, large });

export const RIBBON_TABS: Tab[] = [
  {
    id: 'home',
    label: 'Home',
    panels: [
      {
        title: 'Draw',
        items: [
          big('Line', Minus, 'L', 'Line (L)', 'line'),
          big('Polyline', Waypoints, 'PL', 'Polyline (PL)', 'polyline'),
          it('Circle', Circle, 'C', 'Circle (C)', 'circle'),
          it('Arc', Spline, 'A', 'Arc — 3 points (A)', 'arc'),
          it('Rectangle', Square, 'REC', 'Rectangle (REC)', 'rectangle'),
          it('Hatch', PaintBucket, 'H', 'Hatch (H)', 'hatch'),
        ],
      },
      {
        title: 'Modify',
        items: [
          it('Move', Move, 'M', 'Move (M)', 'move'),
          it('Copy', Copy, 'CO', 'Copy (CO)', 'copy'),
          it('Rotate', RotateCw, 'RO', 'Rotate (RO)', 'rotate'),
          it('Mirror', FlipHorizontal, 'MI', 'Mirror (MI)', 'mirror'),
          it('Scale', Scale, 'SC', 'Scale (SC)', 'scale'),
          it('Stretch', Maximize2, 'S', 'Stretch (S)', 'stretch'),
          it('Trim', Scissors, 'TR', 'Trim (TR)', 'trim'),
          it('Extend', ArrowUpRight, 'EX', 'Extend (EX)', 'extend'),
          it('Offset', UnfoldHorizontal, 'O', 'Offset (O)', 'offset'),
          it('Fillet', CornerDownRight, 'F', 'Fillet (F)', 'fillet'),
          it('Chamfer', Slash, 'CHA', 'Chamfer (CHA)', 'chamfer'),
          it('Array', Grid3x3, 'AR', 'Array (AR)', 'array'),
          it('Break', Split, 'BR', 'Break (BR)', 'break'),
          it('Join', Merge, 'J', 'Join (J)', 'join'),
          it('Explode', Ungroup, 'X', 'Explode (X)', 'explode'),
          it('Align', AlignVerticalJustifyCenter, 'AL', 'Align (AL)', 'align'),
          it('Erase', Trash2, 'E', 'Erase / Delete (E)'),
        ],
      },
      {
        title: 'Annotation',
        items: [
          big('Text', Type, 'TX', 'Text note (TX)', 'text'),
          big('Dimension', Ruler, 'DLI', 'Linear dimension (DLI)', 'dli'),
          it('Aligned', Ruler, 'DAL', 'Aligned dimension (DAL)', 'dimension'),
          it('Leader', ArrowUpRight, 'LE', 'Leader (LE)', 'leader'),
          it('Tag', Tag, 'TG', 'Tag by category (TG)', 'tag'),
        ],
      },
      { title: 'Layers', custom: 'layers' },
      {
        title: 'Block',
        items: [
          big('Insert', PackagePlus, 'I', 'Insert block / component (I)', 'insert'),
          it('Create', Blocks, 'B', 'Create block (B)', 'block'),
          it('Edit', PencilRuler, 'BE', 'Block editor (BE)'),
        ],
      },
      { title: 'Properties', custom: 'properties' },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    panels: [
      {
        title: 'Walls',
        items: [
          big('Wall', BrickWall, 'WA', 'Wall (WA)', 'wall'),
          it('Curtain Wall', Frame, 'CW', 'Curtain wall (CW)', 'curtainwall'),
          it('Wall Join', Merge, 'WJ', 'Wall join (WJ)', 'walljoin'),
          it('Attach Top', ArrowUpRight, 'AT', 'Attach walls to roof (AT)'),
          it('Detach Top', ArrowDownToLine, 'DTR', 'Detach walls from roof (DTR)'),
        ],
      },
      {
        title: 'Openings',
        items: [
          big('Door', DoorOpen, 'DR', 'Door (DR)', 'door'),
          big('Window', AppWindow, 'WN', 'Window (WN)', 'window'),
          it('Opening', Frame, 'WO', 'Wall opening (WO)', 'wallopening'),
          it('Equal Space', Columns3, 'EQ', 'Equal spacing of openings (EQ)'),
        ],
      },
      {
        title: 'Rooms & Floors',
        items: [
          big('Room Builder', Blocks, 'RMB', 'Room builder — describe sides, drop rooms that share walls (RMB)', 'roomplace'),
          it('Room', LayoutGrid, 'RM', 'Room tag & area (RM)', 'room'),
          it('Floor', Layers, 'SB', 'Floor slab (SB)', 'floor'),
          it('Stair', TrendingUp, 'ST', 'Stair (ST)', 'stair'),
        ],
      },
      {
        title: 'Roof & Facade',
        items: [
          big('Roof', Home, 'RF', 'Roof by footprint (RF)', 'roof'),
          it('Skylight', Sun, 'SKY', 'Skylight (SKY)', 'skylight'),
          it('Dormer', Tent, 'DMR', 'Dormer (DMR)', 'dormer'),
          it('Paint', Paintbrush, 'PT', 'Paint finish (PT)', 'paint'),
          it('Split Face', SquareSplitVertical, 'SF', 'Split face (SF)', 'splitface'),
          it('Sweep', Rows3, 'SWP', 'Wall sweep (SWP)', 'sweep'),
          it('Reveal', SquareDashed, 'RVL', 'Wall reveal (RVL)', 'reveal'),
          it('Balcony', PanelTop, 'BAL', 'Balcony (BAL)', 'balcony'),
          it('Railing', Fence, 'RAIL', 'Railing (RAIL)', 'railing'),
        ],
      },
      {
        title: 'Datum & Objects',
        items: [
          it('Grid', Hash, 'GR', 'Structural grid (GR)', 'grid'),
          it('Column', Columns2, 'CL', 'Column (CL)', 'column'),
          it('Levels', Rows4, 'LL', 'Levels manager (LL)'),
          it('Component', Sofa, 'CM', 'Place a component (CM)', 'insert'),
          it('Camera', Camera, 'CAM', 'Camera (CAM)', 'camera'),
        ],
      },
    ],
  },
  {
    id: 'structure',
    label: 'Structure',
    panels: [
      {
        title: 'Foundation',
        items: [
          big('Footing', Anchor, 'FT', 'Isolated footing (FT)', 'footing'),
          it('Wall Footing', RectangleHorizontal, 'WF', 'Wall footing (WF)', 'wallfooting'),
          it('Fdn. Slab', Square, 'FS', 'Foundation slab / slab on grade (FS)', 'foundationslab'),
          it('Pile Cap', Tally4, 'PC', 'Pile cap + piles (PC)', 'pilecap'),
        ],
      },
      {
        title: 'Framing',
        items: [
          big('Beam', Minus, 'BM', 'Beam (BM)', 'beam'),
          it('Beam System', Rows4, 'BS', 'Beam system / joists (BS)', 'beamsystem'),
          it('Brace', Slash, 'BRC', 'Brace (BRC)', 'brace'),
          it('Column', Columns2, 'CL', 'Column (CL)', 'column'),
        ],
      },
      {
        title: 'Reinforcement',
        items: [
          big('Rebar', SplineIcon, 'RB', 'Rebar (RB)', 'rebar'),
          it('Area Reinf.', Grid2x2, 'ARN', 'Area reinforcement (ARN)', 'areareinf'),
          it('Preset', Wrench, 'RBP', 'Rebar quick preset (RBP)'),
        ],
      },
      {
        title: 'Timber',
        items: [
          big('Truss', Triangle, 'TRS', 'Timber truss (TRS)', 'truss'),
          it('Knee Brace', CornerDownRight, 'KB', 'Knee brace / corbel (KB)', 'kneebrace'),
          it('Roof Framing', Warehouse, 'TRF', 'Ridge beam, purlins, rafters (TRF)', 'roofframing'),
        ],
      },
      {
        title: 'Connect & Load',
        items: [
          it('Connection', Link2, 'CN', 'Steel connection (CN)', 'connection'),
          it('Joint', ScanLine, 'CJ', 'Construction / control joint (CJ)', 'sjoint'),
          it('Load', ArrowDownToLine, 'LD', 'Load (LD)', 'load'),
          it('Section', Scissors, 'SEC', 'Structural section (SEC)', 'section'),
        ],
      },
      {
        title: 'Geometry',
        items: [
          it('Join', Merge, 'JG', 'Join geometry (JG)'),
          it('Unjoin', Ungroup, 'UJ', 'Unjoin geometry (UJ)'),
          it('Switch', RotateCw, 'SWJ', 'Switch join order (SWJ)'),
          it('Col. to Beam', ArrowUpRight, 'ATB', 'Attach column top to beam (ATB)'),
        ],
      },
      {
        title: 'Views',
        items: [
          it('Foundation', Layers, 'FP', 'Foundation plan (FP)'),
          it('Framing', Grid3x3, 'FRP', 'Framing plan (FRP)'),
          it('Analytical', CircleDot, 'AN', 'Analytical view (AN)'),
          it('Rebar', Eye, 'VR', 'View rebar (VR)'),
          it('X-ray', Scan, 'XR', 'X-ray below grade (XR)'),
        ],
      },
    ],
  },
  {
    id: 'insert',
    label: 'Insert',
    panels: [
      {
        title: 'Block',
        items: [
          big('Insert', PackagePlus, 'I', 'Insert block (I)', 'insert'),
          act('Library', Sofa, 'library', 'Show / hide the block & component library', true),
          it('Create', Blocks, 'B', 'Create block (B)', 'block'),
          it('Edit', PencilRuler, 'BE', 'Block editor (BE)'),
        ],
      },
      {
        title: 'Reference',
        items: [
          big('Trace Plan', ScanLine, 'TRACE', 'Attach a PDF / image plan to trace over (TRACE)'),
          big('Auto-trace', Sparkles, 'TRACEAUTO', 'AI turns the plan image into walls, doors, windows and rooms (TRACEAUTO)'),
          it('Set Scale', Ruler, 'TRACESCALE', 'Scale the trace image from a known length (TRACESCALE)', 'tracescale'),
          it('Move', Move, 'TRACEMOVE', 'Move the trace image (TRACEMOVE)', 'tracemove'),
        ],
      },
      {
        title: 'Import',
        items: [
          act('DXF', FileInput, 'importDxf', 'Import a DXF drawing', true),
          act('Open Project', FolderOpen, 'openJson', 'Open a saved project (.json)'),
        ],
      },
      {
        title: 'Start',
        items: [
          big('Template', LayoutTemplate, 'TEMPLATE', 'New from template (TEMPLATE)'),
          big('AI Design', Sparkles, 'AI', 'Design with AI from a sketch (AI)'),
        ],
      },
    ],
  },
  {
    id: 'annotate',
    label: 'Annotate',
    panels: [
      { title: 'Text', items: [big('Text', Type, 'TX', 'Text note (TX)', 'text')] },
      {
        title: 'Dimensions',
        items: [
          big('Linear', Ruler, 'DLI', 'Linear dimension (DLI)', 'dli'),
          it('Aligned', Ruler, 'DAL', 'Aligned dimension (DAL)', 'dimension'),
          it('Angular', Compass, 'DAN', 'Angular dimension (DAN)', 'dan'),
          it('Radius', CircleDot, 'DRA', 'Radius dimension (DRA)', 'dra'),
          it('Diameter', Circle, 'DDI', 'Diameter dimension (DDI)', 'ddi'),
          it('Continue', Milestone, 'DCO', 'Continue dimension (DCO)', 'dco'),
          it('Baseline', Milestone, 'DBA', 'Baseline dimension (DBA)', 'dba'),
          it('Dim Style', SlidersHorizontal, 'D', 'Dimension style (D)'),
        ],
      },
      {
        title: 'Leaders & Tags',
        items: [big('Leader', ArrowUpRight, 'LE', 'Leader (LE)', 'leader'), it('Tag', Tag, 'TG', 'Tag by category (TG)', 'tag'), it('Hatch', PaintBucket, 'H', 'Hatch (H)', 'hatch')],
      },
      {
        title: 'Measure',
        items: [it('Distance', Ruler, 'DIST', 'Measure distance (DIST)', 'dist'), it('Area', Shapes, 'AA', 'Measure area (AA)', 'area')],
      },
    ],
  },
  {
    id: 'view',
    label: 'View',
    panels: [
      {
        title: 'Views',
        items: [
          act('2D Plan', Square, 'view2d', '2D plan', true),
          act('3D', Box, 'view3d', '3D view', true),
          act('Split', Columns2, 'split', '2D + 3D side by side'),
          it('Elevations', Mountain, 'EL', 'Elevations (EL)'),
          it('Roof Plan', Home, 'RP', 'Roof plan (RP)'),
        ],
      },
      {
        title: 'Render',
        items: [
          big('AI Render', Sparkles, 'RENDER', 'Looks, AI restyle, high-res stills and photoreal renders (RENDER)'),
        ],
      },
      {
        title: 'Navigate',
        items: [
          big('Zoom Ext.', Maximize2, 'ZE', 'Zoom extents (ZE)'),
          it('ViewCube', Rotate3d, 'NAVVCUBE', 'ViewCube on / off (NAVVCUBE)'),
          it('Section Box', BoxSelect, 'BX', 'Section box (BX)'),
        ],
      },
      {
        title: 'Visibility',
        items: [
          big('Vis. / Graphics', Eye, 'VV', 'Visibility / graphics (VV)'),
          it('Hide', EyeOff, 'HH', 'Hide element temporarily (HH)'),
          it('Isolate', Scan, 'HI', 'Isolate element temporarily (HI)'),
          it('Reset', Undo2, 'HR', 'Reset temporary hide / isolate (HR)'),
          it('Architectural', BrickWall, 'DSA', 'Discipline: architectural (DSA)'),
          it('Structural', Columns3, 'DSS', 'Discipline: structural (DSS)'),
          it('Combined', Layers, 'DSC', 'Discipline: combined (DSC)'),
        ],
      },
      {
        title: 'Display',
        items: [
          it('Lineweights', Minus, 'LWT', 'Show / hide lineweights (LWT)'),
          act('Grid', Grid2x2, 'toggleGrid', 'Show / hide the grid (F7)'),
          it('Properties', SlidersHorizontal, 'PR', 'Properties palette (PR)'),
          it('Layers', Layers, 'LA', 'Layers palette (LA)'),
        ],
      },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    panels: [
      {
        title: 'Styles',
        items: [
          big('Layers', Layers, 'LP', 'Layer properties manager (LP)'),
          big('Linetypes', Spline, 'LT', 'Linetype manager (LT)'),
          it('LT Scale', Ruler, 'LTS', 'Global linetype scale (LTSCALE)'),
          it('Lineweights', Minus, 'LW', 'Lineweight settings (LW)'),
          it('Dim Style', SlidersHorizontal, 'D', 'Dimension style (D)'),
          it('Levels', Rows4, 'LL', 'Levels manager (LL)'),
        ],
      },
      { title: 'Plot', items: [big('Plot Styles', Palette, 'PLOTSTYLE', 'Plot style tables (.ctb) (PLOTSTYLE)')] },
      {
        title: 'Help',
        items: [
          it('Commands', HelpCircle, 'HELP', 'Command reference (F1)'),
          it('Shortcuts', Keyboard, 'KS', 'Keyboard shortcuts (KS)'),
          it('Tour', Compass, 'TOUR', 'Guided tour (TOUR)'),
          act('Classic UI', LayoutGrid, 'classic', 'Switch to the classic left toolbar'),
        ],
      },
    ],
  },
  {
    id: 'output',
    label: 'Output',
    panels: [
      {
        title: 'Plot',
        items: [
          big('Sheets', FileDown, 'SH', 'Sheets & title block (SH)'),
          big('Plot PDF', Printer, 'PLOT', 'Export multi-page PDF (PLOT)'),
          it('Plot Styles', Palette, 'PLOTSTYLE', 'Plot style tables (.ctb)'),
          it('Schedules', LayoutGrid, 'SCH', 'Schedules (SCH)'),
        ],
      },
      {
        title: 'Export',
        items: [big('DXF', FileUp, 'DXFOUT', 'Export DXF for AutoCAD (DXFOUT)'), big('IFC', Box, 'IFC', 'Export IFC4 BIM model (IFC)')],
      },
      {
        title: 'Project',
        items: [
          act('Save', Save, 'saveJson', 'Save project (.json)', true),
          act('Open', FolderOpen, 'openJson', 'Open project (.json)'),
          act('New Blank', FilePlus2, 'newBlank', 'New blank project'),
          it('Template', LayoutTemplate, 'TEMPLATE', 'New from template'),
        ],
      },
    ],
  },
];

export interface RibbonStyleValue {
  color?: string;         // undefined = ByLayer, 'varies' = mixed
  lineType?: string;
  lineWeight?: number;
}

interface Props {
  dark: boolean;
  activeTool: ToolId;
  viewMode: string;
  onRun: (alias: string) => void;
  onAction: (a: RibbonAction) => void;
  // Layers / Properties panels
  layers: Layer[];
  activeLayer: string;
  onSetLayer: (id: string) => void;
  lineTypes: LineTypeDef[];
  /** values shown in the Properties panel (the selection's, or the current ones) */
  styleValue: { color?: string | 'varies'; lineType?: string | 'varies'; lineWeight?: number | 'varies' };
  styleTarget: 'selection' | 'current';
  onSetStyle: (patch: { color?: string | null; lineType?: string | null; lineWeight?: number | null }) => void;
  showLineweights: boolean;
  libraryOpen: boolean;
  gridOn: boolean;
}

const COLOR_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const Ribbon: React.FC<Props> = (p) => {
  const { dark } = p;
  const [tab, setTab] = useState<string>(() => {
    try {
      return localStorage.getItem('archiforma_ribbon_tab') || 'home';
    } catch {
      return 'home';
    }
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('archiforma_ribbon_min') === '1';
    } catch {
      return false;
    }
  });
  const [peek, setPeek] = useState(false); // collapsed ribbon shown temporarily after clicking a tab
  useEffect(() => {
    try {
      localStorage.setItem('archiforma_ribbon_tab', tab);
      localStorage.setItem('archiforma_ribbon_min', collapsed ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [tab, collapsed]);

  const current = RIBBON_TABS.find((t) => t.id === tab) ?? RIBBON_TABS[0];
  const showPanels = !collapsed || peek;

  const pressed = (item: Item) => {
    if (item.tool && item.tool === p.activeTool) return true;
    if (item.action === 'view2d') return p.viewMode === '2d';
    if (item.action === 'view3d') return p.viewMode === '3d';
    if (item.action === 'split') return p.viewMode === 'split';
    if (item.action === 'library') return p.libraryOpen;
    if (item.action === 'toggleGrid') return p.gridOn;
    if (item.cmd === 'LWT') return p.showLineweights;
    return false;
  };
  const fire = (item: Item) => {
    if (item.action) p.onAction(item.action);
    else if (item.cmd) p.onRun(item.cmd);
    if (collapsed) setPeek(false);
  };

  const shell = dark ? 'bg-stone-900 border-stone-800 text-stone-200' : 'bg-stone-50 border-stone-200 text-stone-800';
  const hover = dark ? 'hover:bg-stone-800' : 'hover:bg-white hover:shadow-[inset_0_0_0_1px_rgb(214_211_209)]';
  const on = 'bg-amber-600 text-white hover:bg-amber-600';
  const sel = `px-1.5 py-0.5 text-[11px] rounded border min-w-0 focus:outline-none focus:border-amber-600 ${dark ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`;

  const largeBtn = (item: Item) => {
    const I = item.icon;
    const isOn = pressed(item);
    return (
      <button
        key={item.label + (item.cmd ?? item.action)}
        type="button"
        title={item.tip}
        aria-label={item.tip}
        aria-pressed={isOn}
        data-ribbon-cmd={item.cmd ?? item.action}
        onClick={() => fire(item)}
        className={`flex flex-col items-center justify-start gap-1 w-[54px] h-[68px] px-1 pt-1.5 rounded cursor-pointer text-center ${isOn ? on : hover}`}
      >
        <I className={`w-6 h-6 ${isOn ? '' : 'text-amber-600'}`} />
        <span className="text-[10.5px] leading-tight">{item.label}</span>
      </button>
    );
  };
  const smallBtn = (item: Item) => {
    const I = item.icon;
    const isOn = pressed(item);
    return (
      <button
        key={item.label + (item.cmd ?? item.action)}
        type="button"
        title={item.tip}
        aria-label={item.tip}
        aria-pressed={isOn}
        data-ribbon-cmd={item.cmd ?? item.action}
        onClick={() => fire(item)}
        className={`flex items-center gap-1.5 h-[21px] px-1.5 rounded cursor-pointer whitespace-nowrap text-[11px] ${isOn ? on : hover}`}
      >
        <I className={`w-3.5 h-3.5 shrink-0 ${isOn ? '' : 'text-amber-600'}`} />
        <span>{item.label}</span>
      </button>
    );
  };

  const layer = p.layers.find((l) => l.id === p.activeLayer);
  const sv = p.styleValue;

  const layersPanel = (
    <div className="flex items-start gap-1">
      {largeBtn(it('Layer Props', Layers, 'LP', 'Layer properties manager (LP)'))}
      <div className="flex flex-col gap-1 pt-0.5">
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm border border-stone-400/60 shrink-0" style={{ background: layer?.color }} />
          <select aria-label="Current layer" value={p.activeLayer} onChange={(e) => p.onSetLayer(e.target.value)} className={`${sel} w-32 font-mono`}>
            {p.layers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.visible ? '' : ' (off)'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-0.5">
          {smallBtn(it('Off', EyeOff, 'HH', 'Hide selected element (HH)'))}
          {smallBtn(it('Isolate', Scan, 'HI', 'Isolate selected element (HI)'))}
          {smallBtn(it('All', Eye, 'HR', 'Show all again (HR)'))}
        </div>
      </div>
    </div>
  );

  const colorLabel = sv.color === 'varies' ? 'Varies' : sv.color ? sv.color : BYLAYER;
  const propertiesPanel = (
    <div className="flex items-start gap-1">
      {largeBtn(it('Match', Paintbrush, 'MA', 'Match properties (MA)', 'matchprop'))}
      <div className="flex flex-col gap-0.5 pt-0.5" data-testid="ribbon-properties">
        <div className="flex items-center gap-1" title={p.styleTarget === 'selection' ? 'Color of the selected objects' : 'Color for new objects (CECOLOR)'}>
          <span className="w-3 h-3 rounded-sm border border-stone-400/60 shrink-0" style={{ background: sv.color && sv.color !== 'varies' ? sv.color : layer?.color }} />
          <select
            aria-label="Object color"
            value={sv.color === 'varies' ? 'varies' : sv.color ?? 'bylayer'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'varies') return;
              if (v === 'more') {
                const input = document.createElement('input');
                input.type = 'color';
                input.value = sv.color && sv.color !== 'varies' ? sv.color : '#1c1917';
                input.onchange = () => p.onSetStyle({ color: input.value });
                input.click();
                return;
              }
              p.onSetStyle({ color: v === 'bylayer' ? null : v });
            }}
            className={`${sel} w-32`}
          >
            <option value="bylayer">ByLayer</option>
            {sv.color === 'varies' && <option value="varies">Varies</option>}
            {sv.color && sv.color !== 'varies' && !COLOR_CHOICES.map(aciToHex).includes(sv.color) && <option value={sv.color}>{colorLabel}</option>}
            {COLOR_CHOICES.map((i) => (
              <option key={i} value={aciToHex(i)}>
                {['Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta', 'Black / White', 'Gray', 'Light gray'][i - 1]} ({i})
              </option>
            ))}
            <option value="more">More colors…</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <LineTypePreview def={p.lineTypes.find((l) => sv.lineType && sv.lineType !== 'varies' && l.name.toUpperCase() === sv.lineType.toUpperCase()) ?? null} width={22} />
          <select
            aria-label="Object linetype"
            value={sv.lineType === 'varies' ? 'varies' : sv.lineType ?? BYLAYER}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'varies') return;
              if (v === 'more') return p.onRun('LT');
              p.onSetStyle({ lineType: v === BYLAYER ? null : v });
            }}
            className={`${sel} w-[6.6rem]`}
          >
            <option value={BYLAYER}>ByLayer</option>
            {sv.lineType === 'varies' && <option value="varies">Varies</option>}
            {p.lineTypes.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name}
              </option>
            ))}
            <option value="more">Other / Linetype manager…</option>
          </select>
        </div>
        <div className="flex items-center gap-1">
          <svg width="22" height="10" aria-hidden="true" className="shrink-0">
            <line x1="1" y1="5" x2="21" y2="5" stroke="currentColor" strokeWidth={typeof sv.lineWeight === 'number' && sv.lineWeight >= 0 ? Math.max(1, (sv.lineWeight * 96) / 25.4) : 1} />
          </svg>
          <select
            aria-label="Object lineweight"
            value={sv.lineWeight === 'varies' ? 'varies' : sv.lineWeight === undefined ? 'bylayer' : sv.lineWeight < 0 ? 'default' : String(sv.lineWeight)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'varies') return;
              if (v === 'more') return p.onRun('LW');
              p.onSetStyle({ lineWeight: v === 'bylayer' ? null : v === 'default' ? -3 : Number(v) });
            }}
            className={`${sel} w-[6.6rem]`}
          >
            <option value="bylayer">ByLayer</option>
            <option value="default">Default</option>
            {sv.lineWeight === 'varies' && <option value="varies">Varies</option>}
            {LINEWEIGHTS_MM.map((w) => (
              <option key={w} value={String(w)}>
                {lineWeightLabel(w)}
              </option>
            ))}
            <option value="more">Lineweight settings…</option>
          </select>
        </div>
      </div>
    </div>
  );

  /** Small buttons stack three to a column, like AutoCAD. */
  const renderItems = (items: Item[]) => {
    const larges = items.filter((x) => x.large);
    const smalls = items.filter((x) => !x.large);
    const cols: Item[][] = [];
    for (let i = 0; i < smalls.length; i += 3) cols.push(smalls.slice(i, i + 3));
    return (
      <div className="flex items-start gap-0.5">
        {larges.map((x) => (
          largeBtn(x)
        ))}
        {cols.map((col, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            {col.map((x) => (
              smallBtn(x)
            ))}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={`shrink-0 border-b select-none ${shell}`} data-testid="ribbon" role="toolbar" aria-label="Ribbon">
      <div className="flex items-end gap-0.5 px-2 pt-1 overflow-x-auto">
        {RIBBON_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => {
              if (collapsed) setPeek(t.id === tab ? !peek : true);
              setTab(t.id);
            }}
            onDoubleClick={() => {
              setCollapsed((c) => !c);
              setPeek(false);
            }}
            className={`px-3 py-1 text-xs font-medium rounded-t-md cursor-pointer border border-b-0 ${
              t.id === tab && showPanels
                ? dark
                  ? 'bg-stone-950 border-stone-700 text-amber-400'
                  : 'bg-white border-stone-300 text-amber-700'
                : 'border-transparent opacity-80 hover:opacity-100'
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => p.onAction('classic')}
          title="Switch to the classic left toolbar (Ribbon | Classic in the top bar, or WORKSPACE)"
          className="px-2 py-0.5 mb-0.5 text-[11px] rounded hover:bg-stone-500/15 cursor-pointer opacity-70 hover:opacity-100"
        >
          Classic toolbar
        </button>
        <button
          type="button"
          aria-label={collapsed ? 'Expand the ribbon' : 'Minimize the ribbon'}
          title={collapsed ? 'Expand the ribbon (or double-click a tab)' : 'Minimize the ribbon to tabs (or double-click a tab)'}
          onClick={() => {
            setCollapsed((c) => !c);
            setPeek(false);
          }}
          className="p-1 mb-0.5 rounded hover:bg-stone-500/15 cursor-pointer"
        >
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>
      {showPanels && (
        <div className={`flex items-stretch overflow-x-auto border-t ${dark ? 'bg-stone-950 border-stone-700' : 'bg-white border-stone-300'}`} data-testid={`ribbon-tab-${current.id}`}>
          {current.panels.map((panel) => (
            <div key={panel.title} className={`flex flex-col shrink-0 border-r ${dark ? 'border-stone-800' : 'border-stone-200'}`}>
              <div className="flex-1 px-1.5 pt-1.5 pb-1 min-h-[76px]">
                {panel.custom === 'layers' ? layersPanel : panel.custom === 'properties' ? propertiesPanel : renderItems(panel.items ?? [])}
              </div>
              <div className={`text-center text-[10px] py-0.5 ${dark ? 'bg-stone-900 text-stone-400' : 'bg-stone-100 text-stone-500'}`}>{panel.title}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
