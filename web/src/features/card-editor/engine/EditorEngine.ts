/**
 * EditorEngine — the pure-TS state machine for the layered card editor.
 *
 * Architecture (research blueprint section G/J):
 *   - No React, no DOM: the engine owns the document + history and notifies
 *     subscribers. React binds via useSyncExternalStore.
 *   - Only semantic actions commit history. Dragging is transient state;
 *     dragEnd commits ONCE (no network, no history churn per pointermove).
 *   - The engine never touches the network: persistence is the caller's job
 *     (autosave debounce lives in the React layer).
 */
import type {
  CardDocument,
  CardLayer,
  LayerKind,
  PathLayer,
  PathPoint,
  RegionSettings,
  RegionStyleEntry,
  ShapeKind,
  StrokeLineCap,
  StrokeLineJoin,
  StrokeStyleKind,
} from "../domain/document";
import { ARTBOARD, DEFAULT_REGION_SETTINGS } from "../domain/document";
import { HistoryStack } from "../domain/history";
import {
  autoSmoothPoints,
  cornerAnchorAt,
  insertAnchor,
  moveAnchor,
  moveHandle,
  nearestSegmentOnCubics,
  nearestSegmentParam,
  normalizePathLayer,
  pathD,
  pathPadding,
  resolveLayerPathD,
  scalePathD,
  removeAnchor,
  smoothAnchorAt,
  straightenAllPoints,
  toggleAnchorAt,
} from "../domain/path";
import { outlineToEditablePath } from "../domain/freehand";
import {
  applyNodeCount,
  curveEndpointEdit,
  curveSpecMatchesGeometry,
  regenerateCurveAnchors,
  resampleCurveNodes,
} from "../domain/curveEditable";
import {
  CURVE_KIND_LABELS,
  DEFAULT_CURVE_SPEC,
  bakeCurve,
  curveAnchors,
  curveChordLength,
  normalizeCurveSpec,
  normalizeNodeCount,
  reverseCurveSpec,
  curvePointAt,
  type CurveKind,
  type CurveSpec,
} from "../domain/curveGeometry";
import {
  JOIN_TOLERANCE_DEFAULT,
  SNAP_TOLERANCE_DEFAULT,
  anchorSnapTargets,
  anchorsInRect,
  autoCloseWithinTolerance,
  breakPathAt,
  deleteAnchors,
  extendPath,
  joinPointLists,
  moveAnchorsBy,
  nearestAnchor,
  normalizeAnchorIndices,
  reshapePath,
  reversePoints,
  setAnchorTypes,
  snapToTargets,
  type Rect as WorldRect,
  type SnapTarget,
} from "../domain/pathOps";
import {
  BOOLEAN_OP_LABELS,
  booleanContours,
  type BooleanOp,
} from "../domain/geometry/booleanOps";
import {
  resolvePathGeometry,
  singleContourAnchors,
  toWorldSubPaths,
  type CubicSegment,
  type Pt as GeoPt,
  type SubPath,
} from "../domain/geometry/canonical";
import {
  buildSnapIndex,
  equalSpacingGuides,
  measureBetween,
  snapPointSmart,
  type Guide,
  type SnapIndex,
  type SnapResult,
} from "../domain/snapping";
import {
  ANGLE_ASSIST_DEFAULT,
  addAngledGuide,
  addGuide,
  angledGuideLines,
  axisAlignedGuideLines,
  moveGuide,
  normalizeAngleAssist,
  removeGuide,
  rotateGuide,
  toggleGuideLock,
  type GuideAxis,
  type UserGuide,
} from "../domain/guides";
import { createSetSquare, normalizeSetSquare, toggleSetSquareKind, MAX_SET_SQUARES, SET_SQUARE_MIN_SIZE, SET_SQUARE_MAX_SIZE, type SetSquare, type SetSquareKind } from "../domain/setSquare";
import { parseNumericInput } from "../domain/numericInput";
import { rotatePoint } from "../domain/rotation";
import {
  DEFAULT_FREEHAND_OPTIONS,
  freehandPipeline,
  normalizeFreehandOptions,
  simplifyAnchors,
  type FreehandMode,
  type FreehandOptions,
} from "../domain/freehandModes";
import {
  faceContainsPoint,
  remapRegionStyles,
  type RegionFace,
} from "../domain/geometry/regions";
import { regionsForDocument } from "../domain/geometry/documentRegions";
import { clampStrokeWidth } from "../domain/stroke";
import {
  budgetForTier,
  MAX_PATH_POINTS,
  type SaveBudget,
} from "../domain/saveLimits";
import { POLYGON_DEFAULT_SIDES } from "../domain/shapes";
import { framesBounds } from "../domain/geometry";
import {
  clampBend,
  createCurvedLineLayer,
  createWaveDividerLayer,
  createCornerSwooshLayer,
  LUXURY_MATERIALS,
  type LuxuryMaterialKey,
} from "../domain/luxuryMaterials";

/** 8 resize handles (corners + edges), plus the rotation handle. */
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Tier-aware save policy, injected by the host (CardStudio) from the live
 * ENTITLEMENT payload — never a plan name. `unlimited` tiers keep their
 * geometry byte-for-byte (no auto-simplify); capped tiers get the gentle
 * optimize ladder first. See domain/saveLimits.ts.
 */
export type SavePolicy = { budget: SaveBudget; unlimited: boolean };

/**
 * Normalize any angle into (−180, 180] — the reduction used by ROTATION
 * GESTURES and by values that fall outside the document's supported range.
 * Exact numeric entry does NOT go through this: an angle the user types inside
 * ±360 (including negatives past −180) is stored verbatim, so the number on
 * screen is the number on the layer.
 */
export function wrapAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  // Object.is keeps −0 out of the document (and reads as the intent, unlike
  // `a === -0`, which the bundler flags as a comparison that also matches 0).
  return Object.is(a, -0) ? 0 : a;
}

/** The active tool. `draw` is freehand, `pen` is the Bezier pen. */
export type EditorTool = "select" | "draw" | "pen";

/**
 * Selection domains (§16): what a click actually selects. `region` is the
 * Live-Paint face mode (§9) — the geometry it selects is a FACE, not a path.
 */
export type SelectionDomain = "object" | "path" | "node" | "region";

/** Which anchor (and therefore which path layer) the point editor is editing. */
export type AnchorSelection = { layerId: string; index: number };

/** Inspector fields that accept a numeric expression (`+10`, `*2`, `50%`). */
export type NumericField = "x" | "y" | "width" | "height" | "angle" | "strokeWidth" | "fontSize";

/**
 * Per-field bounds for numeric entry. The clamps exist because the resulting
 * value goes straight into the document (and therefore into the saved card), so
 * a typo like `9999999` must not be able to produce an unrenderable layer.
 */
export const NUMERIC_FIELD_LIMITS: Record<NumericField, { min: number; max: number; decimals: number }> = {
  x: { min: -20000, max: 20000, decimals: 2 },
  y: { min: -20000, max: 20000, decimals: 2 },
  width: { min: 1, max: 20000, decimals: 2 },
  height: { min: 1, max: 20000, decimals: 2 },
  angle: { min: -3600, max: 3600, decimals: 2 },
  strokeWidth: { min: 0, max: 400, decimals: 2 },
  fontSize: { min: 4, max: 800, decimals: 2 },
};

/** Read one numeric field off any layer kind (0 when the layer has none). */
function readLayerNumber(layer: CardLayer, field: string): number {
  const value = (layer as unknown as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export type SelectionState = {
  layerId: string | null;
  /**
   * Multi-select ids (shift-click). `layerId` is the "primary" selection the
   * inspector edits; the set is what align/distribute/nudge act on. When the
   * set has ≥2 entries, layerId is always one of them.
   */
  ids: string[];
};

export type EngineState = {
  doc: CardDocument;
  selection: SelectionState;
  tool: EditorTool;
  /** Brush settings for the freehand draw tool. */
  brushColor: string;
  brushWidth: number;
  brushStyle: StrokeStyleKind;
  brushLinecap: StrokeLineCap;
  brushLinejoin: StrokeLineJoin;
  brushOpacity: number;
  /** How the freehand gesture is interpreted at commit time. */
  freehandMode: FreehandMode;
  /** Fitting pipeline tuning (smoothing / fidelity / snapping / auto-close). */
  freehandTuning: FreehandOptions;
  /**
   * SELECTION MODEL (§16). The four domains are deliberately distinct: an
   * object selection is not a path selection, a node selection is not a region
   * selection. Keeping this explicit stops "select all" from meaning four
   * different things depending on the tool that happened to be active.
   */
  selectionDomain: SelectionDomain;
  /** Face id under the cursor in region mode (view state, never persisted). */
  hoveredRegion: string | null;
  /** Face id selected in region mode — a FACE, never the path that bounds it. */
  selectedRegion: string | null;
  /**
   * The path a Pen draft is CONTINUING ("continue from endpoint"), if any.
   * Set by `continuePathFrom`; consumed once by `finishPen`.
   */
  penContinuation: { layerId: string; end: "start" | "end" } | null;
  /** Live pointer samples for the freehand tool (transient, never persisted). */
  workingStroke: { x: number; y: number }[] | null;
  /** Live anchors for the Pen tool (transient, never persisted). */
  penDraft: PathPoint[] | null;
  /** Curvature tool mode: curvature (auto-smooth natural spline) vs corner (sharp polygons). */
  penMode: "curvature" | "corner";
  /**
   * The anchor/handle under edit on a COMMITTED path layer. View state, like
   * `selection`: it lives in the engine but never in undo history. It is the
   * PRIMARY node; `anchorSelection` is the whole group it belongs to.
   */
  selectedAnchor: AnchorSelection | null;
  /**
   * MULTI-NODE SELECTION (Figma's node marquee / shift-click). Always contains
   * `selectedAnchor` as its first entry when that is non-null — a single-node
   * selection is just a one-element group, so no code path has to special-case
   * "one node" versus "many".
   */
  anchorSelection: AnchorSelection[];
  /**
   * Snapping (§ smart guides). When on, a drag lands on anchors, box edges and
   * the artboard instead of on raw pixels; the guides below report what it hit.
   */
  snapping: boolean;
  /**
   * Live smart guides for the gesture in progress. VIEW STATE ONLY: guides are a
   * projection of one drag and are never persisted (`docs` stay clean).
   */
  snapGuides: Guide[];
  /**
   * RULERS + USER GUIDES + ANGLE ASSIST — the drawing aids (domain/guides.ts).
   *
   * All three are VIEW STATE: they live next to `snapping`/`snapGuides` and are
   * never written into the document, the save payload, the export or the public
   * card view. `rulers` only controls whether the strips are DRAWN — it does not
   * delete the guides, because hiding a ruler is not the same as throwing the
   * user's lines away.
   */
  rulers: boolean;
  /** Persistent user guides. `[]` when the user has none. */
  guides: UserGuide[];
  /** Physical drafting triangles are view state and never enter document history. */
  setSquares: SetSquare[];
  /** The "set-square": lock drawing angles to `angleAssistIncrement`. */
  angleAssist: boolean;
  /** Angular grid in degrees when `angleAssist` is on (45 by default). */
  angleAssistIncrement: number;
  /**
   * The path layer whose POINTS are being edited (double-click a curve, or the
   * "ویرایش نقاط" button). View state — never in history. Only one path can be
   * point-edited at a time, which is why this is an id and not a flag.
   */
  editingPathId: string | null;
  showNodes: boolean;
  curveRangeStart: AnchorSelection | null;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
};

export class EditorEngine {
  private history = new HistoryStack(50);
  private listeners = new Set<() => void>();
  /** Tier-aware save budget (defaults to the CAPPED policy; host injects the real one). */
  private savePolicy: SavePolicy = { budget: budgetForTier(60), unlimited: false };
  /**
   * JSON of the document as of the last successful save (null = never saved).
   * Undo/redo compare against it so the header can say the TRUTH after the user
   * steps back to the saved revision instead of keeping a permanent "unsaved".
   */
  private savedJson: string | null = null;
  private state: EngineState;

  /**
   * Inject the tier policy from the live entitlement payload. Called by the
   * host whenever capabilities load/change — engine mutations that create
   * geometry consult it so a stroke is fitted (or preserved) per tier.
   */
  setSavePolicy(maxLayers: number | null | undefined): void {
    const budget = budgetForTier(maxLayers);
    this.savePolicy = { budget, unlimited: budget.unlimited };
  }

  constructor(initialDoc: CardDocument) {
    this.state = {
      doc: initialDoc,
      selection: { layerId: null, ids: [] },
      tool: "select",
      brushColor: "#0ea5e9",
      brushWidth: 6,
      brushStyle: "solid",
      brushLinecap: "round",
      brushLinejoin: "round",
      brushOpacity: 1,
      freehandMode: "free",
      freehandTuning: { ...DEFAULT_FREEHAND_OPTIONS },
      selectionDomain: "object",
      hoveredRegion: null,
      selectedRegion: null,
      penContinuation: null,
      workingStroke: null,
      penDraft: null,
      penMode: "curvature",
      selectedAnchor: null,
      anchorSelection: [],
      snapping: true,
      snapGuides: [],
      rulers: false,
      guides: [],
      setSquares: [],
      angleAssist: false,
      angleAssistIncrement: ANGLE_ASSIST_DEFAULT,
      editingPathId: null,
      showNodes: true,
      curveRangeStart: null,
      canUndo: false,
      canRedo: false,
      dirty: false,
    };
    this.history.commit(JSON.stringify(initialDoc), { group: null });
  }

  /* ---------------------------- subscription ---------------------------- */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EngineState => this.state;

  private emit(next: Partial<EngineState>): void {
    // THE NODE-SELECTION INVARIANT: a caller that only sets `selectedAnchor`
    // (every single-node code path in the engine) means exactly that one node,
    // so the group collapses to it. Callers that manage a group pass both.
    if (next.selectedAnchor !== undefined && next.anchorSelection === undefined) {
      next = { ...next, anchorSelection: next.selectedAnchor ? [next.selectedAnchor] : [] };
    }
    const doc = next.doc;
    // REGION PAINT IS TOPOLOGY-BOUND (§11): every time geometry changes outside
    // a live gesture, the saved paint is remapped onto the freshly computed
    // faces, so an edited boundary can never leave fills stranded at old
    // coordinates. Inside a drag the remap is deliberately skipped (§17: it
    // would run on every pointer sample) and done once in `commitTransient`.
    if (doc && doc !== this.state.doc && !this.transientTouched && (doc.regions?.length ?? 0) > 0) {
      next = { ...next, doc: this.remapRegions(doc) };
    }
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  /**
   * Keep the selection invariants: `ids` always contains `layerId`, and an
   * empty ids array always means layerId === null.
   */
  private withSelection(layerId: string | null, ids?: string[]): SelectionState {
    const set = ids && ids.length > 0 ? Array.from(new Set(ids)) : layerId ? [layerId] : [];
    return { layerId, ids: layerId ? set : [] };
  }

  private currentJson(): string {
    return JSON.stringify(this.state.doc);
  }

  /**
   * The truth of "is this document different from what is persisted?" — used
   * after a history restore (undo/redo), where the pre-state recording cannot
   * know the save state. Null `savedJson` means nothing was ever saved, so any
   * document counts as changed.
   */
  private isDirtyAgainstSaved(json: string = this.currentJson()): boolean {
    return this.savedJson === null || this.savedJson !== json;
  }

  /**
   * Record the PRE-change state once per semantic action. Callers invoke
   * this BEFORE mutating the document, so undo restores exactly the state
   * before the action (one action = one history record).
   */
  private pushHistory(group: string | null = null): void {
    const changed = this.history.commit(this.currentJson(), { group });
    this.emit({
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      dirty: this.state.dirty || changed,
    });
  }

  /**
   * End the current history-coalescing run (e.g. the user left a text field or
   * released a slider). The next edit with the same group key starts a NEW
   * history record instead of merging into the previous one — so a typing run
   * is one undo step, and two separate runs are two.
   */
  breakHistoryGroup(): void {
    this.history.sealGroup();
  }

  /* ------------------------------ selection ------------------------------ */

  /**
   * Select a layer. Shift-click extends/contracts the multi-select set;
   * a plain click sets a single selection. Null clears everything.
   */
  select(layerId: string | null, additive = false): void {
    // POINT-EDIT EXIT CONTRACT: selecting a DIFFERENT layer always leaves the
    // path point-editor. Without this, a mode entered automatically when a
    // stroke is drawn (commitFreehandSamples) silently swallowed every later
    // click — the layer hit-areas started a node marquee instead of selecting,
    // so an existing line/path could not be reliably re-selected.
    if (this.state.editingPathId !== null && this.state.editingPathId !== layerId) {
      // Also covers `select(null)` (deselect / the edited layer was deleted):
      // point-editing a layer that is no longer selected would leave the node
      // overlay attached to the wrong thing.
      this.emit({ editingPathId: null, selectedAnchor: null, anchorSelection: [], curveRangeStart: null });
    }
    if (additive && layerId !== null) {
      const current = this.state.selection.ids;
      const has = current.includes(layerId);
      const nextIds = has
        ? current.filter((id) => id !== layerId)
        : [...current, layerId];
      // Primary selection follows the most recent click when it stays in the set.
      const primary = has ? nextIds[nextIds.length - 1] ?? null : layerId;
      this.emit({ selection: { layerId: primary, ids: nextIds } });
      return;
    }
    if (this.state.selection.layerId === layerId && (layerId === null || this.state.selection.ids.length === 1)) return;
    this.emit({ selection: this.withSelection(layerId) });
  }

  /** The full selection set (primary + shift-clicked). Empty = nothing selected. */
  selectedIds(): string[] {
    return this.state.selection.ids;
  }

  /** Selected layers in document order (for align/distribute/nudge). */
  selectedLayers(): CardLayer[] {
    const ids = this.state.selection.ids;
    return this.state.doc.layers.filter((l) => ids.includes(l.id));
  }

  getSelected(): CardLayer | null {
    return this.state.doc.layers.find((l) => l.id === this.state.selection.layerId) ?? null;
  }

  /* --------------------------- layer lifecycle --------------------------- */

  addLayer(kind: LayerKind, partial?: Partial<CardLayer>): string {
    const id = `${kind}-${Math.random().toString(36).slice(2, 9)}`;
    const base = {
      id, x: ARTBOARD.width / 2 - 150, y: ARTBOARD.height / 2 - 30,
      width: 300, height: 60, angle: 0, opacity: 1, locked: false, hidden: false,
      z: this.state.doc.layers.length + 1, color: null, background: null,
    };
    let layer: CardLayer;
    switch (kind) {
      case "text":
        layer = { ...base, kind: "text", text: "متن جدید", fontSize: 28, fontWeight: 600, align: "start", fontFamily: "vazir", color: "#0b1c33" };
        break;
      case "image":
        layer = { ...base, kind: "image", src: "", radius: 12, objectFit: "cover" };
        break;
      case "qr":
        layer = { ...base, kind: "qr", width: 130, height: 130, x: ARTBOARD.width / 2 - 65, y: ARTBOARD.height / 2 - 65, payload: "", dark: "#000000", light: "#ffffff" };
        break;
      case "badge":
        layer = { ...base, kind: "badge", width: 160, height: 40, style: "verified", text: "تأییدشده", color: "#ffffff", background: "#0ea5e9" };
        break;
      default:
        layer = { ...base, kind: "shape", shape: "rect", radius: 8, background: "#0ea5e9" };
        break;
    }
    layer = { ...layer, ...(partial as object) } as CardLayer;
    this.pushHistory();
    const layers = [...this.state.doc.layers, layer];
    this.emit({ doc: { ...this.state.doc, layers }, selection: this.withSelection(id) });
    return id;
  }

  /**
   * Apply an entire template design to the card document (with undo support).
   */
  applyTemplateDoc(background: string, layers: CardLayer[]): void {
    this.pushHistory();
    this.emit({
      doc: {
        ...this.state.doc,
        background,
        layers,
      },
      selection: { layerId: null, ids: [] },
    });
  }

  /**
   * Add a vector shape with defaults that match the shape's own nature.
   *
   * A LINE is the special case: it carries a REAL stroke width and colour (it
   * used to derive its thickness from the box height, which is why the width
   * control looked broken).
   */
  addShape(shape: ShapeKind, partial?: Partial<CardLayer>): string {
    const common = { shape, radius: shape === "rect" ? 12 : 0 };
    if (shape === "line") {
      return this.addLayer("shape", {
        ...common,
        width: 260,
        height: 40,
        stroke: "#0b1c33",
        strokeWidth: 4,
        strokeStyle: "solid",
        strokeLinecap: "round",
        background: null,
        ...(partial as object),
      } as Partial<CardLayer>);
    }
    return this.addLayer("shape", {
      ...common,
      background: "#0ea5e9",
      strokeWidth: 0,
      ...(shape === "polygon" ? { sides: POLYGON_DEFAULT_SIDES } : {}),
      ...(partial as object),
    } as Partial<CardLayer>);
  }

  /**
   * Add a freehand brush stroke as a pristine filled vector path layer.
   *
   * The stroke arrives as its perfect-freehand OUTLINE (artboard coordinates).
   * `outlineToEditablePath` re-origins it into a tight layer box AND refits the
   * ribbon as editable cubic anchors (RDP simplify → Catmull-Rom handles), so
   * the stroke is a first-class, node-editable layer — selectable, movable,
   * resizable, and convertible to a Pen path — instead of a frozen `rawD`
   * string. Rendering goes through `resolveLayerPathD` (points), so the canvas,
   * autosave, reload and export all show the same stroke.
   */
  addBrushLayer(outline: number[][], color = "#0ea5e9"): string | null {
    const geometry = outlineToEditablePath(outline, 2, this.savePolicy.unlimited ? 96 : Math.min(72, this.savePolicy.budget.pathPoints));
    if (!geometry) return null;

    const id = `path-${Math.random().toString(36).slice(2, 9)}`;
    const layer: PathLayer = {
      id,
      kind: "path",
      pathMode: "freehand",
      name: "قلم آزاد",
      points: geometry.points,
      closed: true,
      fill: color,
      stroke: null,
      strokeWidth: 0,
      strokeStyle: this.state.brushStyle,
      strokeLinecap: this.state.brushLinecap,
      strokeLinejoin: this.state.brushLinejoin,
      strokeOpacity: this.state.brushOpacity,
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      angle: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      color,
      background: null,
    };

    this.pushHistory();
    const layers = [...this.state.doc.layers, layer];
    this.emit({ doc: { ...this.state.doc, layers }, selection: this.withSelection(id) });
    return id;
  }

  /**
   * Add a smooth curved line / arc (Canva-like curved line).
   */
  addCurvedLine(curvature = 40): string {
    const layer = createCurvedLineLayer(100, 280, 500, 100, curvature, "#0ea5e9");
    this.pushHistory();
    const layers = [...this.state.doc.layers, layer];
    this.emit({ doc: { ...this.state.doc, layers }, selection: this.withSelection(layer.id) });
    return layer.id;
  }

  /**
   * Add an advertising wave or ribbon preset (like IranTarh / Karan Gostar designs).
   */
  addWavePreset(kind: "wave" | "swoosh"): string {
    let layer: PathLayer;
    if (kind === "wave") {
      layer = createWaveDividerLayer(ARTBOARD.width, 240);
    } else {
      layer = createCornerSwooshLayer(600, 320, 420, 260);
    }
    this.pushHistory();
    const layers = [...this.state.doc.layers, layer];
    this.emit({ doc: { ...this.state.doc, layers }, selection: this.withSelection(layer.id) });
    return layer.id;
  }

  /**
   * Adjust the arc of a 2-point curved line in real time.
   *
   * Writes ONLY `bend` — the canonical sagitta ratio the resolver, the bend
   * handle and the export all read. The geometry comes from `points + bend`
   * (domain/curveLine), so no Bézier handles are recomputed here.
   */
  setPathBend(layerId: string, bend: number): void {
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target || target.kind !== "path" || target.points.length !== 2) return;
    this.transientPatch(layerId, { bend: clampBend(bend) } as Partial<CardLayer>);
  }

  /**
   * Apply a luxury material (Glass, Velvet, Gold Foil, Chrome Silver, Neon Glow).
   */
  applyLuxuryMaterial(layerId: string, materialKey: LuxuryMaterialKey): void {
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target) return;
    if (materialKey === "none") {
      this.updateLayer(layerId, { effect: "none" } as Partial<CardLayer>);
      return;
    }
    const mat = LUXURY_MATERIALS.find((m) => m.key === materialKey);
    if (!mat) return;

    const patch: Record<string, unknown> = {
      effect: mat.effect,
    };
    if (target.kind === "shape") {
      patch.background = mat.fillCss;
      if (mat.effect === "glass") {
        patch.stroke = mat.strokeCss;
        patch.strokeWidth = Math.max(target.strokeWidth || 0, 1.5);
      }
    } else if (target.kind === "path") {
      if (target.closed) {
        patch.fill = mat.fillCss;
      } else {
        patch.stroke = mat.strokeCss;
      }
    } else if (target.kind === "text") {
      patch.color = mat.effect === "gold" ? "#BF953F" : mat.effect === "silver" ? "#d1d5db" : mat.effect === "neon" ? "#00f2fe" : "#ffffff";
    }
    this.updateLayer(layerId, patch as Partial<CardLayer>);
  }

  deleteLayer(layerId: string): void {
    if (!layerId) return;
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target || target.locked) return; // locked layers are never deletable
    this.pushHistory();
    const layers = this.state.doc.layers.filter((l) => l.id !== layerId);
    this.emit({ doc: { ...this.state.doc, layers }, selection: this.withSelection(null) });
  }

  /* ------------------------------ mutations ------------------------------ */

  /** Update a layer's props (text, color, fontSize…). Single commit per call.
   *  No-op guard: a patch that changes nothing records NO history entry. */
  updateLayer(layerId: string, patch: Partial<CardLayer>, options: { group?: string | null } = {}): void {
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target || target.locked) return; // locked layers reject prop edits
    const next = { ...target, ...(patch as object) } as CardLayer;
    if (JSON.stringify(next) === JSON.stringify(target)) return;
    this.pushHistory(options.group ?? null);
    const layers = this.state.doc.layers.map((layer) => (layer.id === layerId ? next : layer));
    this.emit({ doc: { ...this.state.doc, layers } });
  }

  /**
   * Mirror a layer about its own centre (horizontal or vertical). ONE
   * implementation for every kind — the frame transform does the work in the
   * canvas and in the SVG/PDF export, so a mirrored text/shape/path/QR layer
   * survives save, reload and export exactly like a mirrored image always did.
   * Returns the new value of the toggled flag (null when the layer is gone).
   */
  toggleFlip(layerId: string, axis: "x" | "y"): boolean | null {
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target || target.locked) return null;
    const key = axis === "x" ? "flipX" : "flipY";
    const next = !target[key];
    this.updateLayer(layerId, { [key]: next } as Partial<CardLayer>);
    return next;
  }

  /**
   * Z-order = ARRAY ORDER (single source of truth; later in the array paints
   * on top). These four ops mutate the array and the renderers read the index,
   * so the visual stacking always follows. All four are one history record.
   */
  reorder(layerId: string, direction: 1 | -1): void {
    const layers = [...this.state.doc.layers];
    const index = layers.findIndex((l) => l.id === layerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= layers.length) return;
    this.pushHistory();
    const [item] = layers.splice(index, 1);
    layers.splice(target, 0, item);
    this.emit({ doc: { ...this.state.doc, layers } });
  }

  bringToFront(layerId: string): void {
    const layers = [...this.state.doc.layers];
    const index = layers.findIndex((l) => l.id === layerId);
    if (index < 0 || index === layers.length - 1) return;
    this.pushHistory();
    const [item] = layers.splice(index, 1);
    layers.push(item);
    this.emit({ doc: { ...this.state.doc, layers } });
  }

  sendToBack(layerId: string): void {
    const layers = [...this.state.doc.layers];
    const index = layers.findIndex((l) => l.id === layerId);
    if (index <= 0) return;
    this.pushHistory();
    const [item] = layers.splice(index, 1);
    layers.unshift(item);
    this.emit({ doc: { ...this.state.doc, layers } });
  }

  /** Duplicate a layer (offset down-right so the copy is visible). */
  duplicateLayer(layerId: string): string | null {
    const source = this.state.doc.layers.find((l) => l.id === layerId);
    if (!source) return null;
    const copy = JSON.parse(JSON.stringify(source)) as CardLayer;
    const newId = `${source.kind}-${Math.random().toString(36).slice(2, 9)}`;
    copy.id = newId;
    copy.x = source.x + 24;
    copy.y = source.y + 24;
    copy.locked = false;
    this.pushHistory();
    const layers = [...this.state.doc.layers, copy];
    this.emit({ doc: { ...this.state.doc, layers }, selection: this.withSelection(newId) });
    return newId;
  }

  /** Create a reflected copy of an editable path beside the original. */
  duplicateMirroredPath(layerId: string, axis: "horizontal" | "vertical"): string | null {
    const source = this.editablePath(layerId);
    if (!source || source.points.length < 2 || source.rawD || source.bend !== undefined) return null;
    const center = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const axisStart = axis === "horizontal"
      ? { x: center.x, y: center.y - 1 }
      : { x: center.x - 1, y: center.y };
    const axisEnd = axis === "horizontal"
      ? { x: center.x, y: center.y + 1 }
      : { x: center.x + 1, y: center.y };
    return this.duplicateMirroredPathAcrossAxis(layerId, axisStart, axisEnd);
  }

  /** Reflect an editable path across an arbitrary artboard-space axis line. */
  /**
   * Can this path be mirrored as ONE contour?
   *
   * Ordinary anchors: yes. A legacy `bend` arc or a `rawD` contour that shadows
   * the anchors (the seeded paths): yes, because the copy is built from the
   * anchors read off the DRAWN geometry. A multi-contour shape (an ornament) is
   * refused — mirroring it as one anchor list would mangle it. This is the exact
   * question behind the mirror button's disabled state, so it is answered here
   * instead of being guessed in the UI.
   */
  canMirrorPathAcrossAxis(layerId: string): boolean {
    const layer = this.editablePath(layerId);
    if (!layer) return false;
    if (layer.rawD === undefined && layer.bend === undefined) return layer.points.length >= 2;
    const geometry = singleContourAnchors(layer);
    return Boolean(geometry && geometry.points.length >= 2);
  }

  duplicateMirroredPathAcrossAxis(
    layerId: string,
    axisStart: { x: number; y: number },
    axisEnd: { x: number; y: number },
  ): string | null {
    const source = this.editablePath(layerId);
    if (!source) return null;
    // ONE rule: mirror the geometry the layer DRAWS. For an ordinary anchor path
    // that is its own anchor list; for a legacy arc or a `rawD` shape it is the
    // anchors read off the drawn cubics, so the SOURCE keeps its frozen/parametric
    // form untouched and the copy comes out as an ordinary editable path.
    const anchors =
      source.rawD === undefined && source.bend === undefined
        ? source.points
        : singleContourAnchors(source)?.points ?? null;
    if (!anchors || anchors.length < 2) return null;
    const axisX = axisEnd.x - axisStart.x;
    const axisY = axisEnd.y - axisStart.y;
    const axisLengthSquared = axisX * axisX + axisY * axisY;
    if (!Number.isFinite(axisLengthSquared) || axisLengthSquared < 1e-8) return null;
    const angle = ((source.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const reflect = (point: { x: number; y: number }) => {
      const localX = point.x - source.width / 2;
      const localY = point.y - source.height / 2;
      const worldX = source.x + source.width / 2 + localX * cos - localY * sin;
      const worldY = source.y + source.height / 2 + localX * sin + localY * cos;
      const fromAxisX = worldX - axisStart.x;
      const fromAxisY = worldY - axisStart.y;
      const projection = (fromAxisX * axisX + fromAxisY * axisY) / axisLengthSquared;
      const nearestX = axisStart.x + projection * axisX;
      const nearestY = axisStart.y + projection * axisY;
      return { x: nearestX * 2 - worldX, y: nearestY * 2 - worldY };
    };
    const points = anchors.map((point) => {
      const anchor = reflect(point);
      const handleIn = point.hIn ? reflect(point.hIn) : null;
      const handleOut = point.hOut ? reflect(point.hOut) : null;
      return {
        x: anchor.x,
        y: anchor.y,
        hIn: handleIn,
        hOut: handleOut,
      };
    });
    const id = `path-${Math.random().toString(36).slice(2, 9)}`;
    const mirrored = normalizePathLayer<PathLayer>(
      {
        ...source,
        id,
        x: 0,
        y: 0,
        angle: 0,
        points,
        rawD: undefined,
        bend: undefined,
        curve: undefined,
        curveProfile: undefined,
        pathMode: "pen",
        locked: false,
      },
      pathPadding(source.strokeWidth),
    );

    this.pushHistory();
    this.emit({
      doc: { ...this.state.doc, layers: [...this.state.doc.layers, mirrored] },
      selection: this.withSelection(id),
      editingPathId: id,
      selectedAnchor: { layerId: id, index: 0 },
      curveRangeStart: null,
    });
    return id;
  }

  /** Rename a layer (layer panel). */
  renameLayer(layerId: string, name: string): void {
    this.updateLayer(layerId, { name } as Partial<CardLayer>);
  }

  /** Paste a copied layer (from the in-memory clipboard), offset down-right. */
  pasteLayer(copy: CardLayer): string | null {
    const layer = JSON.parse(JSON.stringify(copy)) as CardLayer;
    layer.id = `${layer.kind}-${Math.random().toString(36).slice(2, 9)}`;
    layer.x += 24;
    layer.y += 24;
    layer.locked = false;
    this.pushHistory();
    const layers = [...this.state.doc.layers, layer];
    this.emit({ doc: { ...this.state.doc, layers }, selection: this.withSelection(layer.id) });
    return layer.id;
  }

  /* ------------------------------ transform ------------------------------ */

  /**
   * Live resize (transient — no history until commitTransform). Anchor is the
   * OPPOSITE edge/corner of the dragged handle, kept fixed in ARTBOARD
   * coordinates. Supports rotation: the pointer delta is projected onto the
   * layer's rotated axes, then the resulting box is un-projected back.
   */
  transientResize(layerId: string, handle: ResizeHandle, pointer: { x: number; y: number }): void {
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target || target.locked) return;
    this.beginTransient();

    let startTarget = target;
    if (this.transientDocStart) {
      try {
        const startDoc = JSON.parse(this.transientDocStart) as CardDocument;
        startTarget = startDoc.layers.find((l) => l.id === layerId) ?? target;
      } catch {
        startTarget = target;
      }
    }

    const angle = (startTarget.angle ?? 0) * (Math.PI / 180);
    const center = { x: startTarget.x + startTarget.width / 2, y: startTarget.y + startTarget.height / 2 };
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = pointer.x - center.x;
    const dy = pointer.y - center.y;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    const halfW = startTarget.width / 2;
    const halfH = startTarget.height / 2;
    const MIN = 8;

    let newRight = handle.includes("e") ? localX : halfW;
    let newLeft = handle.includes("w") ? localX : -halfW;
    let newBottom = handle.includes("s") ? localY : halfH;
    let newTop = handle.includes("n") ? localY : -halfH;

    if (newRight - newLeft < MIN) {
      if (handle.includes("e")) newRight = newLeft + MIN;
      else if (handle.includes("w")) newLeft = newRight - MIN;
    }
    if (newBottom - newTop < MIN) {
      if (handle.includes("s")) newBottom = newTop + MIN;
      else if (handle.includes("n")) newTop = newBottom - MIN;
    }

    const newW = newRight - newLeft;
    const newH = newBottom - newTop;
    const localCenterX = (newLeft + newRight) / 2;
    const localCenterY = (newTop + newBottom) / 2;
    const worldCenterX = center.x + localCenterX * cos - localCenterY * sin;
    const worldCenterY = center.y + localCenterX * sin + localCenterY * cos;

    const patch: Partial<CardLayer> = {
      width: newW,
      height: newH,
      x: worldCenterX - newW / 2,
      y: worldCenterY - newH / 2,
    };

    if (startTarget.kind === "path") {
      const sx = newW / Math.max(1, startTarget.width);
      const sy = newH / Math.max(1, startTarget.height);
      // A parametric curve is scaled THROUGH its parameters, so Length and
      // Amplitude stay truthful after a resize (x scales length, y scales
      // amplitude — exactly equivalent to scaling the generated anchors).
      if (startTarget.curve) {
        (patch as Partial<PathLayer>).curve = normalizeCurveSpec({
          ...startTarget.curve,
          length: startTarget.curve.length * sx,
          amplitude: startTarget.curve.amplitude * sy,
        });
      }
      if (startTarget.rawD) {
        (patch as Partial<PathLayer>).rawD = scalePathD(startTarget.rawD, sx, sy);
      } else if (startTarget.points.length > 0) {
        (patch as Partial<PathLayer>).points = startTarget.points.map((point) => ({
          x: point.x * sx,
          y: point.y * sy,
          hIn: point.hIn ? { x: point.hIn.x * sx, y: point.hIn.y * sy } : point.hIn ?? null,
          hOut: point.hOut ? { x: point.hOut.x * sx, y: point.hOut.y * sy } : point.hOut ?? null,
        }));
      }
    }

    this.transientTouched = true;
    const next = { ...target, ...(patch as object) } as CardLayer;
    const layers = this.state.doc.layers.map((layer) => (layer.id === layerId ? next : layer));
    this.emit({ doc: { ...this.state.doc, layers } });
  }

  /**
   * Live rotate (transient). Angle measured from the layer center to the
   * pointer, with an optional shift-to-snap to 15° steps.
   */
  transientRotate(layerId: string, pointer: { x: number; y: number }, shift: boolean): void {
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target || target.locked) return;
    const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const deg = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI;
    // Screen Y is down; compensate so dragging CCW reads as CCW. The result is
    // wrapped into (−180,180] so stored values always satisfy the validator's
    // ±360 clamp instead of being silently clamped into a different pose.
    let angle = wrapAngle(deg + 90);
    if (shift) {
      const step = 15;
      angle = Math.round(angle / step) * step;
    }
    this.transientPatch(layerId, { angle } as Partial<CardLayer>);
  }

  /** End a resize/rotate gesture: one history record, no network. */
  commitTransform(): void {
    this.commitTransient();
  }

  /* --------------------------- group transform --------------------------- */

  /**
   * The DERIVED bounding box of the unlocked selection (null for < 2 layers).
   *
   * This is the group transform unit and it is NEVER stored: it is recomputed
   * from the layers on every gesture, so there is no second source of truth and
   * nothing to keep in sync after an undo or a reload.
   */
  selectionBounds(): { x: number; y: number; width: number; height: number } | null {
    const frames = this.state.doc.layers
      .filter((layer) => this.state.selection.ids.includes(layer.id) && !layer.locked)
      .map((layer) => ({ x: layer.x, y: layer.y, width: layer.width, height: layer.height }));

    if (frames.length < 2) return null;

    return framesBounds(frames);
  }

  /**
   * The members of the current gesture measured against the state at the START
   * of that gesture.
   *
   * A live gesture must be ABSOLUTE, not incremental: pointermove fires many
   * times, and scaling "the current width" by a pointer-derived factor on every
   * event would compound (width × s × s × s…). The single-layer transform avoids
   * this by deriving an absolute box from the pointer; the group transform needs
   * the same property, so it reads the pre-gesture document that
   * `beginTransient()` already captured.
   */
  private gestureMembers(): { bounds: { x: number; y: number; width: number; height: number }; members: CardLayer[] } | null {
    this.beginTransient();
    if (this.transientDocStart === null) return null;

    let startLayers: CardLayer[];
    try {
      startLayers = (JSON.parse(this.transientDocStart) as CardDocument).layers ?? [];
    } catch {
      return null;
    }

    const members = startLayers.filter(
      (layer) => this.state.selection.ids.includes(layer.id) && !layer.locked,
    );
    if (members.length < 2) return null;

    const bounds = framesBounds(
      members.map((layer) => ({ x: layer.x, y: layer.y, width: layer.width, height: layer.height })),
    );
    if (bounds === null) return null;

    return { bounds, members };
  }

  /**
   * Live GROUP resize (Figma-like): the dragged handle moves one side of the
   * derived bounding box and EVERY member is scaled about the opposite
   * (anchored) corner/edge. The group is never inverted or collapsed — the
   * smallest allowed box is 8 design px.
   *
   * Transient like the single-layer gesture: members are patched without
   * history, and pointerUp commits exactly ONE record for the whole gesture.
   */
  transientGroupResize(handle: ResizeHandle, pointer: { x: number; y: number }, keepAspect = false): void {
    const gesture = this.gestureMembers();
    if (gesture === null) return;
    const { bounds, members } = gesture;

    const MIN = 8;
    const left = bounds.x;
    const top = bounds.y;
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;

    let scaleX = 1;
    let scaleY = 1;
    if (handle.includes("e")) scaleX = (pointer.x - left) / bounds.width;
    else if (handle.includes("w")) scaleX = (right - pointer.x) / bounds.width;
    if (handle.includes("s")) scaleY = (pointer.y - top) / bounds.height;
    else if (handle.includes("n")) scaleY = (bottom - pointer.y) / bounds.height;

    // Minimum box, never a flipped (negative) one. The anchor edge stays put.
    scaleX = Math.max(scaleX, MIN / bounds.width);
    scaleY = Math.max(scaleY, MIN / bounds.height);

    // Corner handles keep the aspect ratio when shift is held (the same modifier
    // contract as the rotate gesture's 15° snap).
    if (keepAspect && handle.length === 2) {
      const uniform = Math.max(scaleX, scaleY);
      scaleX = uniform;
      scaleY = uniform;
    }

    const anchorX = handle.includes("w") ? right : left;
    const anchorY = handle.includes("n") ? bottom : top;

    for (const layer of members) {
      const patch: Partial<CardLayer> = {
        x: anchorX + (layer.x - anchorX) * scaleX,
        y: anchorY + (layer.y - anchorY) * scaleY,
        width: Math.max(MIN, layer.width * scaleX),
        height: Math.max(MIN, layer.height * scaleY),
      };
      if (layer.kind === "path") {
        if (layer.rawD) {
          (patch as Partial<PathLayer>).rawD = scalePathD(layer.rawD, scaleX, scaleY);
        } else if (layer.points.length > 0) {
          (patch as Partial<PathLayer>).points = layer.points.map((point) => ({
            x: point.x * scaleX,
            y: point.y * scaleY,
            hIn: point.hIn ? { x: point.hIn.x * scaleX, y: point.hIn.y * scaleY } : point.hIn ?? null,
            hOut: point.hOut ? { x: point.hOut.x * scaleX, y: point.hOut.y * scaleY } : point.hOut ?? null,
          }));
        }
      }
      this.transientPatch(layer.id, patch);
    }
  }

  /**
   * Live GROUP rotate: the delta is measured from the pointer's angle about the
   * gesture's group centre (0 at the rotate handle, which sits directly above
   * it). Every member's centre is rotated about that centre AND its own angle
   * advances by the same delta, so the composition rotates as one rigid body.
   */
  transientGroupRotate(pointer: { x: number; y: number }, shift: boolean): void {
    const gesture = this.gestureMembers();
    if (gesture === null) return;
    const { bounds, members } = gesture;

    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const degrees = (Math.atan2(pointer.y - centerY, pointer.x - centerX) * 180) / Math.PI;

    let delta = degrees + 90; // the rotate handle starts directly above the centre
    if (shift) {
      const step = 15;
      delta = Math.round(delta / step) * step;
    }

    const radians = (delta * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);

    for (const layer of members) {
      const offsetX = layer.x + layer.width / 2 - centerX;
      const offsetY = layer.y + layer.height / 2 - centerY;
      const nextCenterX = centerX + offsetX * cos - offsetY * sin;
      const nextCenterY = centerY + offsetX * sin + offsetY * cos;

      this.transientPatch(layer.id, {
        x: nextCenterX - layer.width / 2,
        y: nextCenterY - layer.height / 2,
        // Wrap the accumulated group rotation per member: repeated gestures
        // would otherwise push `angle` past ±360 where the validator clamps
        // it SILENTLY — the reloaded card would sit in a different pose.
        angle: wrapAngle((layer.angle ?? 0) + delta),
      } as Partial<CardLayer>);
    }
  }

  /**
   * Uniform-scale transform for one layer, anchored at its center. Used by the
   * numeric fields path and by the arrow-key scaling shortcuts.
   */
  /**
   * Update a layer's box (position, size, rotation).
   *
   * `box` is PARTIAL by contract: the transform panel's rotation controls are
   * angle-only — "صاف کردن" commits `{ angle: 0 }` and the quick slider commits
   * `{ angle: n }` — so a missing `width`/`height` is a normal, expected shape.
   *
   * Path anchors are stored in LAYER-LOCAL units, so a path must be rescaled
   * exactly when its SIZE changes, and only then. Reading a missing size as a
   * scale factor produced `NaN` for every anchor (`undefined / width`), which
   * the renderer then wrote into the path's `d` and into the anchor/handle
   * `cx`/`cy`, blanking the drawing and firing "Received NaN" console errors.
   * Non-finite box values are refused here, at the single boundary every box
   * edit crosses, so malformed geometry can never reach the document.
   */
  setLayerBox(
    layerId: string,
    box: Partial<{ x: number; y: number; width: number; height: number; angle: number }>,
  ): void {
    const target = this.state.doc.layers.find((layer) => layer.id === layerId);
    if (!target || target.locked) return;

    const patch: Partial<CardLayer> = {};
    for (const field of ["x", "y", "width", "height", "angle"] as const) {
      const value = box[field];
      if (typeof value === "number" && Number.isFinite(value)) {
        (patch as Record<string, number>)[field] = value;
      }
    }
    if (Object.keys(patch).length === 0) return;

    if (target.kind === "path") {
      const { width, height } = box;
      const resizes =
        typeof width === "number" &&
        typeof height === "number" &&
        Number.isFinite(width) &&
        Number.isFinite(height);
      if (resizes) {
        const sx = width / Math.max(1, target.width);
        const sy = height / Math.max(1, target.height);
        // A malformed CURRENT box (a non-finite stored size) must leave the
        // valid anchors alone instead of rescaling them into NaN.
        if (Number.isFinite(sx) && Number.isFinite(sy)) {
          if (target.rawD) {
            (patch as Partial<PathLayer>).rawD = scalePathD(target.rawD, sx, sy);
          } else if (target.points.length > 0) {
            (patch as Partial<PathLayer>).points = target.points.map((point) => ({
              x: point.x * sx,
              y: point.y * sy,
              hIn: point.hIn ? { x: point.hIn.x * sx, y: point.hIn.y * sy } : point.hIn ?? null,
              hOut: point.hOut ? { x: point.hOut.x * sx, y: point.hOut.y * sy } : point.hOut ?? null,
            }));
          }
        }
      }
    }
    this.updateLayer(layerId, patch);
  }

  /** Nudge a layer by a delta (keyboard arrows). One history entry per keydown. */
  nudge(layerId: string, dx: number, dy: number): void {
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target || target.locked) return;
    this.updateLayer(layerId, { x: target.x + dx, y: target.y + dy } as Partial<CardLayer>);
  }

  /**
   * Align a single layer against the artboard. One history record per call so
   * each alignment is independently undoable.
   */
  alignToArtboard(layerId: string, edge: "left" | "right" | "top" | "bottom" | "centerX" | "centerY"): void {
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target || target.locked) return;
    const board = this.state.doc.artboard;
    const patch: Partial<CardLayer> = {} as Partial<CardLayer>;
    switch (edge) {
      case "left":
        patch.x = 0;
        break;
      case "right":
        patch.x = board.width - target.width;
        break;
      case "top":
        patch.y = 0;
        break;
      case "bottom":
        patch.y = board.height - target.height;
        break;
      case "centerX":
        patch.x = board.width / 2 - target.width / 2;
        break;
      case "centerY":
        patch.y = board.height / 2 - target.height / 2;
        break;
    }
    this.updateLayer(layerId, patch);
  }

  /**
   * Align the MULTI-SELECTION to a common edge (all layers move to the same
   * line). Ignored for a single selection — that case is alignToArtboard.
   * One history record for the whole alignment.
   */
  alignSelection(edge: "left" | "right" | "top" | "bottom" | "centerX" | "centerY"): void {
    const layers = this.selectedLayers().filter((l) => !l.locked);
    if (layers.length < 2) return;
    this.pushHistory();
    // The alignment line is the minimum edge (for left/top), the maximum edge
    // (for right/bottom), or the mean (for centers) — matching Figma.
    const boxes = layers.map((l) => ({ id: l.id, x: l.x, y: l.y, w: l.width, h: l.height }));
    const right = (b: (typeof boxes)[number]) => b.x + b.w;
    const bottom = (b: (typeof boxes)[number]) => b.y + b.h;
    let next: { id: string; x: number; y: number }[] = [];
    if (edge === "left") {
      const line = Math.min(...boxes.map((b) => b.x));
      next = boxes.map((b) => ({ id: b.id, x: line, y: b.y }));
    } else if (edge === "right") {
      const line = Math.max(...boxes.map(right));
      next = boxes.map((b) => ({ id: b.id, x: line - b.w, y: b.y }));
    } else if (edge === "top") {
      const line = Math.min(...boxes.map((b) => b.y));
      next = boxes.map((b) => ({ id: b.id, x: b.x, y: line }));
    } else if (edge === "bottom") {
      const line = Math.max(...boxes.map(bottom));
      next = boxes.map((b) => ({ id: b.id, x: b.x, y: line - b.h }));
    } else if (edge === "centerX") {
      const mean = boxes.reduce((sum, b) => sum + b.x + b.w / 2, 0) / boxes.length;
      next = boxes.map((b) => ({ id: b.id, x: mean - b.w / 2, y: b.y }));
    } else {
      const mean = boxes.reduce((sum, b) => sum + b.y + b.h / 2, 0) / boxes.length;
      next = boxes.map((b) => ({ id: b.id, x: b.x, y: mean - b.h / 2 }));
    }
    const byId = new Map(next.map((n) => [n.id, n]));
    const layers2 = this.state.doc.layers.map((layer) => {
      const move = byId.get(layer.id);
      return move ? ({ ...layer, x: move.x, y: move.y } as CardLayer) : layer;
    });
    this.emit({ doc: { ...this.state.doc, layers: layers2 } });
  }

  /**
   * Even spacing between the selected layers along one axis. Requires ≥3
   * layers. One history record. Locked layers are excluded from the move.
   * The two EXTREME layers stay put (Figma behaviour); only the inner ones
   * are re-spaced, so the group never grows or shrinks past its bounds.
   */
  distribute(axis: "x" | "y"): void {
    const layers = this.selectedLayers()
      .filter((l) => !l.locked)
      .map((l) => ({ id: l.id, x: l.x, y: l.y, w: l.width, h: l.height }));
    if (layers.length < 3) return;
    this.pushHistory();
    const key = axis === "x" ? ("x" as const) : ("y" as const);
    const size = axis === "x" ? ("w" as const) : ("h" as const);
    const sorted = layers.slice().sort((a, b) => a[key] - b[key]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const inner = sorted.slice(1, -1);
    // Even gaps between the (fixed) extremes: available room / (n-1) gaps,
    // each inner box consuming its own extent.
    const room = last[key] - first[key] - last[size];
    const gap = room / (inner.length + 1);
    let cursor = first[key] + first[size] + gap;
    const byId = new Map<string, number>();
    byId.set(first.id, first[key]);
    byId.set(last.id, last[key]);
    for (const box of inner) {
      byId.set(box.id, cursor);
      cursor += box[size] + gap;
    }
    const layers2 = this.state.doc.layers.map((layer) => {
      const pos = byId.get(layer.id);
      if (pos === undefined) return layer;
      return axis === "x" ? ({ ...layer, x: pos } as CardLayer) : ({ ...layer, y: pos } as CardLayer);
    });
    this.emit({ doc: { ...this.state.doc, layers: layers2 } });
  }

  toggleHidden(layerId: string): void {
    const layer = this.state.doc.layers.find((l) => l.id === layerId);
    if (layer && !layer.locked) this.updateLayer(layerId, { hidden: !layer.hidden });
  }

  /** Flip the lock flag directly (bypasses updateLayer's locked guard). */
  toggleLocked(layerId: string): void {
    this.pushHistory();
    const layers = this.state.doc.layers.map((layer) =>
      layer.id === layerId ? ({ ...layer, locked: !layer.locked } as CardLayer) : layer,
    );
    this.emit({ doc: { ...this.state.doc, layers } });
  }

  setBackground(color: string): void {
    if (this.state.doc.background === color) return; // no-op guard
    this.pushHistory();
    this.emit({ doc: { ...this.state.doc, background: color } });
  }

  /**
   * Live background edit (transient — no history until commitBackground).
   *
   * Same path as transientPatch: dragging a gradient control (angle, stop
   * offset, stop color) paints the document on every pointermove but records
   * nothing, so an entire gesture costs exactly ONE undo record instead of one
   * record per intermediate value.
   */
  transientBackground(css: string): void {
    if (this.state.doc.background === css) return; // no-op guard
    this.beginTransient();
    this.transientTouched = true;
    this.emit({ doc: { ...this.state.doc, background: css } });
  }

  /** End a background gesture: exactly ONE history record (or none if unchanged). */
  commitBackground(): void {
    this.commitTransient();
  }

  /* ------------------------------- history ------------------------------- */

  private transientDocStart: string | null = null;
  private transientTouched = false;

  beginTransient(): void {
    if (this.transientDocStart === null) {
      this.transientDocStart = this.currentJson();
      this.transientTouched = false;
    }
  }

  transientPatch(layerId: string, patch: Partial<CardLayer>): void {
    const target = this.state.doc.layers.find((l) => l.id === layerId);
    if (!target || target.locked) return;
    const next = { ...target, ...(patch as object) } as CardLayer;
    if (JSON.stringify(next) === JSON.stringify(target)) return;
    this.beginTransient();
    this.transientTouched = true;
    const layers = this.state.doc.layers.map((layer) => (layer.id === layerId ? next : layer));
    this.emit({ doc: { ...this.state.doc, layers } }); // no history, no dirty
  }

  commitTransient(_label?: string): void {
    if (this.transientDocStart === null) return;
    const start = this.transientDocStart;
    const touched = this.transientTouched;
    this.transientDocStart = null;
    this.transientTouched = false;
    if (!touched) return; // gesture ended with no change
    // Using group: null ensures consecutive gestures don't coalesce into one history record
    this.history.commit(start, { group: null });
    // §11: the region paint is remapped ONCE here instead of on every pointer
    // sample during the gesture (the remap is skipped while `transientTouched`).
    const doc = this.remapRegions(this.state.doc);
    this.emit({ doc, canUndo: this.history.canUndo, canRedo: this.history.canRedo, dirty: true });
  }

  /** End of a transient gesture (drag): record the pre-drag state once. */
  commitMove(_layerId: string): void {
    // Ported to use the generic transient tracking
    this.commitTransient();
  }

  /** Live drag: moves the layer WITHOUT committing history or notifying autosave. */
  transientMove(layerId: string, x: number, y: number): void {
    this.transientPatch(layerId, { x, y } as Partial<CardLayer>);
  }

  /**
   * Move EVERY selected layer by the same delta (multi-select drag). The
   * primary layer is moved to the exact pointer; the others follow by their
   * original offset to it. Still transient — pointerUp commits once.
   */
  transientMoveSelection(layerId: string, x: number, y: number): void {
    const ids = this.state.selection.ids;
    if (ids.length <= 1) {
      this.transientMove(layerId, x, y);
      return;
    }
    const layers = this.state.doc.layers;
    const primary = layers.find((l) => l.id === layerId);
    if (!primary || primary.locked) return;
    const dx = x - primary.x;
    const dy = y - primary.y;
    this.beginTransient();
    this.transientTouched = true;
    const next = layers.map((layer) => {
      if (!ids.includes(layer.id) || layer.locked) return layer;
      return { ...layer, x: layer.x + dx, y: layer.y + dy } as CardLayer;
    });
    this.emit({ doc: { ...this.state.doc, layers: next } });
  }

  /* ------------------------------- drawing ------------------------------- */

  setTool(tool: EditorTool): void {
    if (this.state.tool === tool) return;
    // Leaving a tool always drops its transient state: a half-drawn stroke, a
    // half-finished pen path or a point selection must never leak into the next
    // interaction.
    this.emit({
      tool,
      workingStroke: tool === "draw" ? this.state.workingStroke : null,
      penDraft: tool === "pen" ? this.state.penDraft : null,
      selectedAnchor: tool === "select" ? this.state.selectedAnchor : null,
      editingPathId: tool === "select" ? this.state.editingPathId : null,
    });
  }

  /** Change the freehand brush color (live; affects the next committed path). */
  setBrushColor(color: string): void {
    this.emit({ brushColor: color });
  }

  /** Change the freehand brush width (1..50 design px). */
  setBrushWidth(width: number): void {
    this.emit({ brushWidth: clampStrokeWidth(width) });
  }

  /**
   * Freehand mode (§6): `free` fits the stroke, `straight` produces an accurate
   * two-anchor line, `constrained` snaps every segment to the configured angle
   * increments (with axis lock).
   */
  setFreehandMode(mode: FreehandMode): void {
    this.emit({ freehandMode: normalizeFreehandOptions({ mode }).mode });
  }

  /** Tuning for the freehand pipeline (smoothing / fidelity / snapping). */
  setFreehandTuning(patch: Partial<FreehandOptions>): void {
    this.emit({ freehandTuning: normalizeFreehandOptions({ ...this.state.freehandTuning, ...patch }) });
  }

  /** The snapping increments the constrained mode uses (degrees). */
  setFreehandAngleSnapping(increments: number[]): void {
    this.setFreehandTuning({ angleIncrements: increments });
  }

  /**
   * Live stroke decorations for the NEXT freehand stroke. The draw tool is
   * only useful if a new stroke can be dashed/dotted/translucent, so these
   * mirror the inspector controls instead of being hardcoded.
   */
  setBrushStroke(patch: {
    style?: StrokeStyleKind;
    linecap?: StrokeLineCap;
    linejoin?: StrokeLineJoin;
    opacity?: number;
  }): void {
    this.emit({
      brushStyle: patch.style ?? this.state.brushStyle,
      brushLinecap: patch.linecap ?? this.state.brushLinecap,
      brushLinejoin: patch.linejoin ?? this.state.brushLinejoin,
      brushOpacity: patch.opacity ?? this.state.brushOpacity,
    });
  }

  beginFreehandStroke(startPoint: { x: number; y: number }): void {
    this.emit({ workingStroke: [startPoint] });
  }

  extendFreehandStroke(point: { x: number; y: number }): void {
    if (!this.state.workingStroke) return;
    this.emit({ workingStroke: [...this.state.workingStroke, point] });
  }

  /**
   * Commit an explicit freehand sample stream.
   *
   * The React stage keeps raw samples in refs so pointermove never causes a
   * document render. This method is the bridge from that high-frequency input
   * to the canonical freehand pipeline (smoothing → fidelity → simplification
   * → Bezier fitting). It deliberately does NOT use the perfect-freehand outline
   * as the final geometry; that outline is preview-only.
   */
  commitFreehandSamples(
    samples: { x: number; y: number }[],
    options: {
      color: string;
      width: number;
      style?: StrokeStyleKind;
      linecap?: StrokeLineCap;
      linejoin?: StrokeLineJoin;
      opacity?: number;
    },
  ): string | null {
    if (samples.length < 2) return null;
    const strokeWidth = clampStrokeWidth(options.width);
    const fit = freehandPipeline(samples, {
      ...this.state.freehandTuning,
      mode: this.state.freehandMode,
      maxPoints: MAX_PATH_POINTS,
    });
    if (fit.points.length < 2) return null;

    const id = `path-${Math.random().toString(36).slice(2, 9)}`;
    const layer = normalizePathLayer<PathLayer>(
      {
        id,
        kind: "path",
        pathMode: "freehand",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        angle: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        z: this.state.doc.layers.length + 1,
        color: null,
        background: null,
        closed: fit.closed,
        points: fit.points,
        stroke: options.color,
        strokeWidth,
        strokeStyle: options.style ?? this.state.brushStyle,
        strokeLinecap: options.linecap ?? this.state.brushLinecap,
        strokeLinejoin: options.linejoin ?? this.state.brushLinejoin,
        strokeOpacity: options.opacity ?? this.state.brushOpacity,
        fill: null,
      },
      pathPadding(strokeWidth),
    );

    this.pushHistory();
    const layers = [...this.state.doc.layers, layer];
    this.emit({
      doc: { ...this.state.doc, layers },
      workingStroke: null,
      // Keep the drawing tool active while the committed path is selected
      // and its anchors are editable.
      tool: "draw",
      selection: this.withSelection(id),
      editingPathId: id,
      selectedAnchor: { layerId: id, index: 0 },
    });
    return id;
  }

  /** Commit a straightedge-constrained stroke without smoothing or curve fitting. */
  commitStraightStroke(
    start: { x: number; y: number },
    end: { x: number; y: number },
    options: { color: string; width: number; style?: StrokeStyleKind; linecap?: StrokeLineCap; linejoin?: StrokeLineJoin; opacity?: number },
  ): string | null {
    if (Math.hypot(end.x - start.x, end.y - start.y) < 0.01) return this.commitFreehandDot(start, options);
    const strokeWidth = clampStrokeWidth(options.width);
    const id = `path-${Math.random().toString(36).slice(2, 9)}`;
    const points: PathPoint[] = [
      { x: start.x, y: start.y, hIn: null, hOut: null },
      { x: end.x, y: end.y, hIn: null, hOut: null },
    ];
    const layer = normalizePathLayer<PathLayer>({
      id, kind: "path", pathMode: "freehand", x: 0, y: 0, width: 1, height: 1,
      angle: 0, opacity: options.opacity ?? this.state.brushOpacity, locked: false, hidden: false,
      z: this.state.doc.layers.length + 1, color: null, background: null, closed: false, points,
      stroke: options.color, strokeWidth, strokeStyle: options.style ?? this.state.brushStyle,
      strokeLinecap: options.linecap ?? this.state.brushLinecap,
      strokeLinejoin: options.linejoin ?? this.state.brushLinejoin,
      strokeOpacity: options.opacity ?? this.state.brushOpacity, fill: null,
    }, pathPadding(strokeWidth));
    this.pushHistory();
    this.emit({
      doc: { ...this.state.doc, layers: [...this.state.doc.layers, layer] },
      workingStroke: null, tool: "draw", selection: this.withSelection(id),
      editingPathId: id, selectedAnchor: { layerId: id, index: 0 },
    });
    return id;
  }

  /** A press/release without travel is a visible round dab, never an empty path. */
  commitFreehandDot(
    point: { x: number; y: number },
    options: { color: string; width: number; opacity?: number },
  ): string {
    const diameter = Math.max(1, clampStrokeWidth(options.width));
    const id = this.addShape("ellipse", {
      x: point.x - diameter / 2, y: point.y - diameter / 2,
      width: diameter, height: diameter, background: options.color,
      opacity: options.opacity ?? this.state.brushOpacity,
    });
    this.emit({ tool: "draw", editingPathId: null, selectedAnchor: null });
    return id;
  }

  commitFreehandStroke(options: {
    color: string;
    width: number;
    style?: StrokeStyleKind;
    linecap?: StrokeLineCap;
    linejoin?: StrokeLineJoin;
    opacity?: number;
  }): string | null {
    const working = this.state.workingStroke;
    if (!working || working.length < 2) {
      this.emit({ workingStroke: null });
      return null;
    }
    const strokeWidth = clampStrokeWidth(options.width);
    const id = `path-${Math.random().toString(36).slice(2, 9)}`;
    // THE PIPELINE (§6): smoothing → fidelity → simplification → curve fitting.
    // The anchor cap lives inside the pipeline (it re-fits the SAME samples with
    // a coarser epsilon instead of truncating, so the stroke keeps its shape and
    // still ends where the finger ended).
    // The layer box is DERIVED from the geometry (never hand-computed), so a
    // freshly drawn stroke and a later-edited one always agree on the box.
    const fit = freehandPipeline(working, {
      ...this.state.freehandTuning,
      mode: this.state.freehandMode,
      maxPoints: MAX_PATH_POINTS,
    });
    const points = fit.points;
    if (points.length < 2) {
      this.emit({ workingStroke: null });
      return null;
    }

    const newLayer = normalizePathLayer<PathLayer>(
      {
        id,
        kind: "path",
        pathMode: "pen",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        angle: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        z: this.state.doc.layers.length + 1,
        color: null,
        background: null,
        closed: fit.closed,
        points,
        stroke: options.color,
        strokeWidth,
        strokeStyle: options.style ?? this.state.brushStyle,
        strokeLinecap: options.linecap ?? this.state.brushLinecap,
        strokeLinejoin: options.linejoin ?? this.state.brushLinejoin,
        strokeOpacity: options.opacity ?? this.state.brushOpacity,
        fill: null,
      },
      pathPadding(strokeWidth),
    );

    this.pushHistory();
    const layers = [...this.state.doc.layers, newLayer];
    this.emit({
      doc: { ...this.state.doc, layers },
      workingStroke: null,
      selection: this.withSelection(id),
    });
    return id;
  }

  cancelFreehandStroke(): void {
    this.emit({ workingStroke: null });
  }

  /* -------------------------------- pen tool -------------------------------- */

  /**
   * The Pen tool builds a Bezier path anchor by anchor.
   *
   * Contract (Figma/Illustrator-like):
   *   - click            → add an anchor with no handles (a corner point)
   *   - click + drag     → add an anchor AND pull two mirrored handles out of it
   *                        (a smooth point)
   *   - click anchor #1  → close the path and commit it
   *   - Esc / Enter      → commit the path as an open path
   *
   * The draft is TRANSIENT engine state: it never touches history and never
   * reaches the document until it is committed, so an abandoned draft leaves no
   * trace behind.
   */
  setPenMode(mode: "curvature" | "corner"): void {
    this.emit({ penMode: mode });
  }

  penStart(point: { x: number; y: number }): void {
    this.emit({ penDraft: [{ x: point.x, y: point.y, hIn: null, hOut: null }] });
  }

  penAddAnchor(point: { x: number; y: number }): void {
    const draft = this.state.penDraft ?? [];
    const raw = [...draft, { x: point.x, y: point.y, hIn: null, hOut: null }];
    const hasExplicitHandles = draft.some((p) => p.hIn !== null || p.hOut !== null);
    const smoothed =
      this.state.penMode === "curvature" && !hasExplicitHandles && raw.length >= 2
        ? autoSmoothPoints(raw, false)
        : raw;
    this.emit({ penDraft: smoothed });
  }

  /**
   * While the pointer is still down on the anchor just placed, pull its two
   * mirrored handles out. This is what turns a corner into a smooth point.
   */
  penDragHandle(point: { x: number; y: number }): void {
    const draft = this.state.penDraft;
    if (!draft || draft.length === 0) return;
    const last = draft[draft.length - 1];
    const next = draft.slice();
    next[next.length - 1] = {
      ...last,
      hOut: { x: point.x, y: point.y },
      hIn: { x: last.x * 2 - point.x, y: last.y * 2 - point.y },
    };
    this.emit({ penDraft: next });
  }

  /** Commit the draft. Returns the new layer id, or null when it was too short. */
  finishPen(closed: boolean): string | null {
    const draft = this.state.penDraft;
    if (!draft || draft.length < 2) {
      this.emit({ penDraft: null, penContinuation: null });
      return null;
    }
    // CONTINUE FROM ENDPOINT (§5): the draft was seeded with the existing path's
    // anchors, so finishing writes the merged anchors BACK into that layer —
    // one record, one layer, no duplicate path left behind.
    const continuation = this.state.penContinuation;
    if (continuation) {
      this.emit({ penContinuation: null });
      const target = this.editablePath(continuation.layerId);
      if (target) {
        const merged = normalizePathLayer(
          { ...target, points: draft, closed: closed && draft.length > 2 },
          pathPadding(target.strokeWidth),
        );
        this.pushHistory();
        const layers = this.state.doc.layers.map((layer) => (layer.id === target.id ? merged : layer));
        this.emit({
          doc: { ...this.state.doc, layers },
          penDraft: null,
          tool: "select",
          selection: this.withSelection(target.id),
          editingPathId: target.id,
          selectedAnchor: { layerId: target.id, index: draft.length - 1 },
        });
        return target.id;
      }
    }
    const strokeWidth = clampStrokeWidth(this.state.brushWidth);
    const id = `path-${Math.random().toString(36).slice(2, 9)}`;
    const layer = normalizePathLayer<PathLayer>(
      {
        id,
        kind: "path",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        angle: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        z: this.state.doc.layers.length + 1,
        color: null,
        background: null,
        closed: closed && draft.length > 2,
        points: draft,
        stroke: this.state.brushColor,
        strokeWidth,
        strokeStyle: this.state.brushStyle,
        strokeLinecap: this.state.brushLinecap,
        strokeLinejoin: this.state.brushLinejoin,
        strokeOpacity: this.state.brushOpacity,
        fill: null,
      },
      pathPadding(strokeWidth),
    );

    this.pushHistory();
    const layers = [...this.state.doc.layers, layer];
    // Finish in `select` with the first anchor focused so the new curve is
    // immediately editable (stroke + points) instead of leaving the user stuck
    // in a drawing mode.
    this.emit({
      doc: { ...this.state.doc, layers },
      penDraft: null,
      tool: "select",
      selection: this.withSelection(id),
      editingPathId: id,
      selectedAnchor: { layerId: id, index: 0 },
    });
    return id;
  }

  cancelPen(): void {
    this.emit({ penDraft: null });
  }

  /* ------------------------------ curve tool (§4) ------------------------------ */

  /**
   * Create a parametric curve layer.
   *
   * The layer keeps its `curve` record, so Length / Amplitude / Frequency /
   * Phase / Symmetry / tangents / direction stay editable forever — the tool
   * produces live geometry, not a baked picture of it. The anchors it generates
   * are ordinary Bezier points, so the pen, node editor, resize and export all
   * treat it like any other path.
   */
  addCurve(kind: CurveKind = "sine", partial: Partial<CurveSpec> = {}): string {
    const spec = normalizeCurveSpec({ ...DEFAULT_CURVE_SPEC, ...partial, kind });
    const strokeWidth = clampStrokeWidth(this.state.brushWidth);
    const id = `path-${Math.random().toString(36).slice(2, 9)}`;
    const layer = normalizePathLayer<PathLayer>(
      {
        id,
        kind: "path",
        pathMode: "curve",
        curve: spec,
        points: curveAnchors(spec),
        closed: false,
        name: `منحنی — ${CURVE_KIND_LABELS[spec.kind]}`,
        x: (ARTBOARD.width - spec.length) / 2,
        y: ARTBOARD.height / 2 - 40,
        width: spec.length,
        height: Math.max(8, spec.amplitude * 2),
        angle: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        color: null,
        background: null,
        stroke: this.state.brushColor,
        strokeWidth,
        strokeStyle: this.state.brushStyle,
        strokeLinecap: this.state.brushLinecap,
        strokeLinejoin: this.state.brushLinejoin,
        strokeOpacity: this.state.brushOpacity,
        fill: null,
      },
      pathPadding(strokeWidth),
    );
    this.pushHistory();
    const layers = [...this.state.doc.layers, layer];
    // A new curve opens in NODE EDITING with its first node focused, so the
    // endpoints are immediately draggable on the canvas — creating a curve and
    // then hunting for "edit points" would not be a vector editor.
    this.emit({
      doc: { ...this.state.doc, layers },
      selection: this.withSelection(id),
      tool: "select",
      editingPathId: id,
      selectedAnchor: { layerId: id, index: 0 },
    });
    return id;
  }

  /** The parametric record of a curve layer (null when it is a plain path). */
  curveSpec(layerId: string): CurveSpec | null {
    const layer = this.state.doc.layers.find((l) => l.id === layerId);
    if (!layer || layer.kind !== "path" || !layer.curve) return null;
    return normalizeCurveSpec(layer.curve);
  }

  /**
   * Chord length of a curve layer, measured from its OWN generated geometry.
   * This is the number the inspector must show — changing amplitude, frequency,
   * phase, symmetry or rotation can never move it.
   */
  curveLength(layerId: string): number {
    const layer = this.state.doc.layers.find((l) => l.id === layerId);
    if (!layer || layer.kind !== "path") return 0;
    const spec = layer.curve ? normalizeCurveSpec(layer.curve) : null;
    if (!spec || spec.kind === "custom") return curveChordLength(layer.points);
    return curveChordLength(curveAnchors(spec));
  }

  /**
   * Edit any curve parameter. The anchors and the layer box are re-derived from
   * the spec in the same step, so the rendered geometry can never disagree with
   * the parameters (one geometry, one contract).
   *
   * `transient: true` is for live slider drags: it updates without touching
   * history (the caller commits once) — but the box IS re-origined here, because
   * a parametric curve is edited through numbers, not by dragging its nodes.
   */
  setCurveParam(
    layerId: string,
    patch: Partial<CurveSpec>,
    options: { transient?: boolean } = {},
  ): void {
    const layer = this.state.doc.layers.find((l) => l.id === layerId);
    if (!layer || layer.kind !== "path" || layer.locked || !layer.curve) return;
    const spec = normalizeCurveSpec({ ...layer.curve, ...patch });
    // A parameter edit may only re-derive the anchors while the spec is still a
    // truthful description of them. Coherence is judged against the spec the
    // layer ACTUALLY has (the stored one), never against the patched value:
    // testing the patch would compare a curve against itself and always pass.
    //
    // If the user has already dragged a node or a handle, the spec was frozen by
    // that gesture (see `freezeCurveSpec`), so this guard is about STALE specs:
    // rewriting the anchors here would silently discard hand-edited geometry,
    // which is the one thing a vector editor must never do.
    const coherent = spec.kind === "custom" || curveSpecMatchesGeometry(layer.curve, layer.points);
    const points =
      spec.kind === "custom" || !coherent
        ? layer.points
        : regenerateCurveAnchors(spec, layer.points);
    const next = normalizePathLayer<PathLayer>(
      { ...layer, curve: spec, points, closed: spec.kind === "custom" ? layer.closed : false, bend: undefined, rawD: undefined },
      pathPadding(layer.strokeWidth),
    );
    const patch2 = {
      curve: next.curve,
      points: next.points,
      closed: next.closed,
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
      rawD: undefined,
      bend: undefined,
    } as Partial<CardLayer>;
    if (options.transient) this.transientPatch(layerId, patch2);
    else this.updateLayer(layerId, patch2);
  }

  /**
   * Reverse a curve. Reversing is a SPEC operation, so every other parameter
   * survives and reversing twice returns the original curve exactly.
   */
  reverseCurve(layerId: string): void {
    const spec = this.curveSpec(layerId);
    if (!spec) return;
    this.setCurveParam(layerId, reverseCurveSpec(spec));
  }

  /**
   * RE-PARAMETRIZE a path as one of the canonical curve profiles.
   *
   * This is the single entry point behind the profile grid, and it is also the
   * documented way OUT of editable mode: choosing a profile creates a fresh spec
   * from the layer's CURRENT size (chord length and peak amplitude are read off
   * the geometry that is on screen), so the curve is rebuilt from parameters
   * again without jumping to a default 600px shape.
   *
   * The layer angle, stroke, and node count survive: rotation is a rigid
   * transform on the layer, and the node count is carried into the new spec.
   */
  setCurveProfile(layerId: string, kind: CurveKind): boolean {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length < 2) return false;
    const previous = layer.curve ? normalizeCurveSpec(layer.curve) : null;

    // Read the chord and the peak offset off the CURRENT geometry so the rebuilt
    // curve lands where the old one was instead of somewhere else.
    const first = layer.points[0];
    const last = layer.points[layer.points.length - 1];
    const chord = Math.hypot(last.x - first.x, last.y - first.y);
    const peak = layer.points.reduce((max, point) => Math.max(max, Math.abs(point.y - first.y)), 0);

    // The chord DIRECTION is read off the geometry too: a curve that was already
    // rotated by dragging its endpoint must not snap back to horizontal.
    const chordAngle = (Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI;
    const spec = normalizeCurveSpec({
      ...(previous ?? DEFAULT_CURVE_SPEC),
      kind,
      length: chord > 1 ? chord : previous?.length ?? DEFAULT_CURVE_SPEC.length,
      amplitude: peak > 1 ? peak : previous?.amplitude ?? DEFAULT_CURVE_SPEC.amplitude,
      chordAngle,
      nodes: previous?.nodes ?? normalizeNodeCount(layer.points.length),
    });
    const next = normalizePathLayer<PathLayer>(
      {
        ...layer,
        curve: spec,
        pathMode: "curve",
        points: regenerateCurveAnchors(spec, layer.points),
        bend: undefined,
        rawD: undefined,
      },
      pathPadding(layer.strokeWidth),
    );
    this.updateLayer(layerId, {
      curve: next.curve,
      pathMode: "curve",
      points: next.points,
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
      bend: undefined,
      rawD: undefined,
    } as Partial<CardLayer>);
    return true;
  }

  applyCurveToRange(layerId: string, startIdx: number, endIdx: number, kind: CurveKind, amplitude?: number): boolean {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length < 2 || kind === "custom") return false;
    if (!Number.isInteger(startIdx) || !Number.isInteger(endIdx)) return false;
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    if (lo < 0 || lo === hi || hi >= layer.points.length) return false;
    const pts = layer.points.map((p) => ({
      ...p,
      hIn: p.hIn ? { ...p.hIn } : null,
      hOut: p.hOut ? { ...p.hOut } : null,
    }));
    const first = pts[lo];
    const last = pts[hi];
    const chord = Math.hypot(last.x - first.x, last.y - first.y);
    if (chord < 1) return false;
    const amp = amplitude ?? Math.min(80, chord * 0.3);
    const spec = normalizeCurveSpec({ kind, length: chord, amplitude: amp, frequency: 1 });
    const count = hi - lo + 1;
    const generated = Array.from({ length: count }, (_, index) =>
      curvePointAt(spec, index / (count - 1)),
    );
    const rad = Math.atan2(last.y - first.y, last.x - first.x);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotated = generated.map((point) => {
      const g = {
        x: point.x * cos - point.y * sin + first.x,
        y: point.x * sin + point.y * cos + first.y,
      };
      return g;
    });
    rotated[0] = { x: first.x, y: first.y };
    rotated[count - 1] = { x: last.x, y: last.y };
    for (let i = 0; i < count; i++) {
      const g = rotated[i];
      pts[lo + i] = { ...pts[lo + i], x: g.x, y: g.y };
    }
    const tension = 1 / 3;
    for (let i = 0; i < count; i++) {
      const prev = rotated[Math.max(0, i - 1)];
      const next = rotated[Math.min(count - 1, i + 1)];
      const point = rotated[i];
      const tx = ((next.x - prev.x) / 2) * tension;
      const ty = ((next.y - prev.y) / 2) * tension;
      if (i > 0) {
        pts[lo + i].hIn = { x: point.x - tx, y: point.y - ty };
      }
      if (i < count - 1) {
        pts[lo + i].hOut = { x: point.x + tx, y: point.y + ty };
      }
    }
    this.applyPathPoints(layer, pts);
    return true;
  }

  autoSmoothRange(layerId: string, startIdx: number, endIdx: number, tension = 0.28): void {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length < 2) return;
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    if (lo === hi || hi >= layer.points.length) return;
    const pts = layer.points.map((p) => ({ ...p, hIn: p.hIn ? { ...p.hIn } : null, hOut: p.hOut ? { ...p.hOut } : null }));
    for (let i = lo; i <= hi; i++) {
      const prev = i > 0 ? pts[i - 1] : pts[i];
      const next = i < pts.length - 1 ? pts[i + 1] : pts[i];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const dPrev = Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y);
      const dNext = Math.hypot(next.x - pts[i].x, next.y - pts[i].y);
      const dTotal = dPrev + dNext || 1;
      const hInLen = (dPrev / dTotal) * tension * 2;
      const hOutLen = (dNext / dTotal) * tension * 2;
      if (i > lo || i > 0) pts[i].hIn = { x: pts[i].x - dx * hInLen, y: pts[i].y - dy * hInLen };
      if (i < hi || i < pts.length - 1) pts[i].hOut = { x: pts[i].x + dx * hOutLen, y: pts[i].y + dy * hOutLen };
    }
    this.applyPathPoints(layer, pts);
  }

  /* ------------------------- editable node count (§2) ------------------------- */

  /**
   * The EDITABLE node count of a curve layer — how many nodes the user can
   * select and drag. Distinct from render/sample resolution by design.
   *
   * For a parametric curve it is `spec.nodes`; for a frozen (editable) curve it
   * is simply how many anchors the layer has.
   */
  curveNodeCount(layerId: string): number {
    const layer = this.state.doc.layers.find((l) => l.id === layerId);
    if (!layer || layer.kind !== "path") return 0;
    if (layer.curve && layer.curve.kind !== "custom") return normalizeCurveSpec(layer.curve).nodes;
    return layer.points.length;
  }

  /**
   * Change the editable node count, preserving the drawn shape.
   *
   * Parametric curve → regenerated from the SAME parameters at the new density
   * (exact, and amplitude/frequency/phase/symmetry/tangents/rotation/length are
   * all preserved by construction).
   *
   * Frozen curve or plain path → nodes are redistributed along the existing
   * geometry by ARC LENGTH (see `resampleCurveNodes`), endpoints kept verbatim.
   *
   * One history record per change, and the layer box is re-derived so the
   * selection frame hugs the new geometry.
   */
  setCurveNodeCount(layerId: string, count: number): boolean {
    const layer = this.editablePath(layerId);
    if (!layer) return false;
    const target = normalizeNodeCount(count);

    // A legacy 2-point SAGITTA arc draws a CIRCLE, not the polyline through its
    // two anchors — resampling those anchors would flatten the arc into a line.
    // It is converted to the canonical parametric arc first (same chord, the
    // sagitta becomes the amplitude, a negative bend becomes `reversed`), then
    // the node count is applied to real geometry. One history record.
    if (layer.bend !== undefined && layer.points.length === 2) {
      const first = layer.points[0];
      const last = layer.points[1];
      const chord = Math.hypot(last.x - first.x, last.y - first.y);
      if (!(chord > 1)) return false;
      const spec = normalizeCurveSpec({
        ...DEFAULT_CURVE_SPEC,
        kind: "arc",
        length: chord,
        amplitude: Math.max(1, Math.abs(layer.bend) * (chord / 2)),
        chordAngle: (Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI,
        reversed: layer.bend < 0,
        nodes: target,
      });
      const next = normalizePathLayer<PathLayer>(
        {
          ...layer,
          curve: spec,
          pathMode: "curve",
          points: regenerateCurveAnchors(spec, layer.points),
          bend: undefined,
          rawD: undefined,
        },
        pathPadding(layer.strokeWidth),
      );
      this.updateLayer(layerId, {
        curve: next.curve,
        pathMode: "curve",
        points: next.points,
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
        bend: undefined,
        rawD: undefined,
      } as Partial<CardLayer>);
      return true;
    }

    const spec = layer.curve && layer.curve.kind !== "custom" ? normalizeCurveSpec(layer.curve) : null;

    // Coherence is judged against the spec the layer ACTUALLY has, and the
    // requested node count is compared to it — not to the incoming patch (which
    // always carries the new count and would make every change look like a
    // no-op).
    if (spec && curveSpecMatchesGeometry(layer.curve!, layer.points)) {
      const applied = applyNodeCount(spec, layer.points, count, layer.closed);
      if (applied.spec.nodes === spec.nodes) return false;
      const next = normalizePathLayer<PathLayer>(
        { ...layer, curve: applied.spec, points: applied.points, bend: undefined, rawD: undefined },
        pathPadding(layer.strokeWidth),
      );
      this.updateLayer(layerId, {
        curve: next.curve,
        points: next.points,
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
        bend: undefined,
        rawD: undefined,
      } as Partial<CardLayer>);
      return true;
    }

    if (target === layer.points.length) return false;
    this.applyPathPoints(layer, resampleCurveNodes(layer.points, target, layer.closed));
    return true;
  }

  /**
   * Is this layer a curve that is STILL described by its spec? The canvas uses
   * it to pick the interaction: a parametric curve edits its chord on an
   * endpoint drag, a plain/frozen path moves the anchor.
   */
  isParametricCurve(layerId: string): boolean {
    const layer = this.state.doc.layers.find((l) => l.id === layerId);
    if (!layer || layer.kind !== "path" || !layer.curve || layer.curve.kind === "custom") return false;
    return curveSpecMatchesGeometry(normalizeCurveSpec(layer.curve), layer.points);
  }

  /**
   * Move ONE node of a curve by an explicit position.
   *
   * This is the engine entry point behind a canvas node drag on a CURVE:
   *   - first/last anchor of a still-parametric curve → the CHORD moved, so the
   *     spec is updated (length + chord angle) and the waveform is regenerated
   *     along it. The curve keeps every parameter AND its own shape while the
   *     dragged node tracks the pointer exactly, and the spec still describes
   *     the anchors (so the inspector stays live).
   *   - interior node, handle, or an already-frozen curve → the spec is frozen
   *     (dropped) and the anchors become the geometry.
   */
  updateCurveNode(
    layerId: string,
    index: number,
    position: { x: number; y: number },
    options: { transient?: boolean } = {},
  ): void {
    const layer = this.editablePath(layerId);
    if (!layer || index < 0 || index >= layer.points.length) return;
    // The canvas works in WORLD (artboard) coordinates — that is what the
    // pointer produces — while the geometry is stored in the layer's own frame.
    // Converting here keeps every call site honest and stops a drag from
    // landing at `pointer + layer origin`.
    const local = { x: position.x - layer.x, y: position.y - layer.y };
    const spec = layer.curve && layer.curve.kind !== "custom" ? normalizeCurveSpec(layer.curve) : null;

    if (spec && curveSpecMatchesGeometry(spec, layer.points)) {
      const applied = curveEndpointEdit(spec, layer.points, index, local);
      if (applied) {
        // A live drag must NOT re-origin the box: `normalizePathLayer` would
        // move the layer origin under the pointer mid-gesture. The box is
        // re-derived once, at `commitPathEdit`.
        if (options.transient) {
          this.transientPatch(layerId, { curve: applied.spec, points: applied.points } as Partial<CardLayer>);
          return;
        }
        const next = normalizePathLayer<PathLayer>(
          { ...layer, curve: applied.spec, points: applied.points },
          pathPadding(layer.strokeWidth),
        );
        this.updateLayer(layerId, {
          curve: next.curve,
          points: next.points,
          x: next.x,
          y: next.y,
          width: next.width,
          height: next.height,
        } as Partial<CardLayer>);
        return;
      }
    }
    if (options.transient) {
      this.transientPatch(layerId, {
        points: moveAnchor(layer.points, index, local),
        ...this.freezeCurveSpec(layer),
      } as Partial<CardLayer>);
      return;
    }
    this.applyPathPoints(layer, moveAnchor(layer.points, index, local));
  }

  /**
   * Freeze a parametric curve into plain editable anchors: the spec stops being
   * a description of the geometry and is DROPPED, so the document can never hold
   * two conflicting representations. Used by the first direct node/handle edit.
   */
  private freezeCurveSpec(layer: PathLayer): Partial<CardLayer> {
    if (!layer.curve) return {};
    return { curve: undefined, curveProfile: undefined, pathMode: "pen" };
  }

  /**
   * Convert to Path: freeze the parameters into plain anchors and DROP the
   * record, so the result is ordinary editable Bezier geometry (§4).
   */
  convertCurveToPath(layerId: string): void {
    const layer = this.state.doc.layers.find((l) => l.id === layerId);
    if (!layer || layer.kind !== "path" || layer.locked || !layer.curve) return;
    const frozen = layer.curve.kind === "custom" ? layer.points : bakeCurve(layer.curve);
    const copy = { ...layer } as PathLayer & { curve?: CurveSpec };
    delete copy.curve;
    const next = normalizePathLayer<PathLayer>(
      { ...(copy as PathLayer), points: frozen, pathMode: "pen" },
      pathPadding(layer.strokeWidth),
    );
    this.pushHistory();
    const layers = this.state.doc.layers.map((l) => (l.id === layerId ? next : l));
    this.emit({ doc: { ...this.state.doc, layers } });
  }

  /* ------------------------------ bend anywhere ------------------------------ */

  /**
   * Freeze a LEGACY two-point sagitta arc (`bend`) into plain editable anchors.
   *
   * A bent line DRAWS a circle through its two anchors, so its anchor list sits
   * on the chord while the user sees the arc: the node overlay showed nodes in
   * mid-air and every press on the visible curve missed the geometry (the bent
   * line could not be curved anywhere except at its apex). This reads the
   * anchors off the DRAWN cubics, so the box, the hit tests and the node editor
   * all agree with the canvas, and the drawing does not move (a cubic
   * approximates the circular arc to a fraction of a pixel). One history record.
   */
  freezeBendArc(layerId: string): boolean {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length !== 2 || layer.bend === undefined) return false;
    return this.freezeDrawnGeometry(layerId);
  }

  /**
   * Freeze whatever spelling of geometry SHADOWS the anchors into real anchors.
   *
   * Two cases, one rule ("the anchors are read off the drawn cubics"):
   *   - a legacy two-point sagitta arc (a circle through its two anchors), and
   *   - a `rawD` contour that outranks `points` in the resolver — the seeded and
   *     imported paths, where the anchor list the inspector shows is NOT the
   *     line the user sees.
   *
   * Refused for a multi-contour `rawD`: it cannot become one anchor list without
   * losing geometry, so it stays the frozen shape it is. One history record, and
   * the drawing does not move.
   */
  freezeDrawnGeometry(layerId: string): boolean {
    const layer = this.editablePath(layerId);
    if (!layer) return false;
    if (layer.bend === undefined && layer.rawD === undefined) return false;
    const geometry = singleContourAnchors(layer);
    if (!geometry || geometry.points.length < 2) return false;
    this.applyPathPoints(layer, geometry.points);
    return true;
  }

  /**
   * WHERE a bend would land: the nearest point on the shape the layer DRAWS.
   *
   * The canvas uses it for the hover dot, so the dot and the press agree by
   * construction (one hit test, one geometry) — including on a legacy arc, where
   * the only honest answer is a point on the arc rather than on the chord.
   */
  bendPointAt(
    layerId: string,
    localPoint: { x: number; y: number },
    tolerance = SNAP_TOLERANCE_DEFAULT,
  ): { point: { x: number; y: number }; distance: number } | null {
    const layer = this.editablePath(layerId);
    if (!layer) return null;
    const hit = nearestSegmentOnCubics(this.bendSegmentsOf(layer), localPoint);
    if (!hit || hit.distance > tolerance) return null;
    return { point: hit.point, distance: hit.distance };
  }

  /**
   * The layer's DRAWN geometry as cubic segments, cached per layer version.
   *
   * The hover dot runs on EVERY pointermove, and resolving a path means writing
   * its `d` string and parsing it back — real work per frame for a freehand
   * stroke with a few hundred anchors. The engine replaces the layer object on
   * every patch (and the points array with it), so object identity is a sound
   * cache key: there is no invalidation logic to get wrong.
   */
  private bendGeometry = new WeakMap<
    PathLayer,
    {
      points: PathPoint[];
      rawD: string | undefined;
      bend: number | undefined;
      closed: boolean;
      segments: CubicSegment[];
    }
  >();

  private bendSegmentsOf(layer: PathLayer): CubicSegment[] {
    const cached = this.bendGeometry.get(layer);
    if (
      cached &&
      cached.points === layer.points &&
      cached.rawD === layer.rawD &&
      cached.bend === layer.bend &&
      cached.closed === layer.closed
    ) {
      return cached.segments;
    }
    const segments = resolvePathGeometry(layer).flatMap((sub) => sub.segments);
    this.bendGeometry.set(layer, {
      points: layer.points,
      rawD: layer.rawD,
      bend: layer.bend,
      closed: layer.closed,
      segments,
    });
    return segments;
  }

  /**
   * START A BEND — the one entry point behind "grab the line anywhere and curve
   * that spot".
   *
   * It (a) turns the layer into a shape whose anchors ARE its geometry if it was
   * not one already (legacy arc / parametric spec), (b) finds the spot on the
   * DRAWN shape closest to the pointer, and (c) inserts a node there with a
   * loss-less de Casteljau split. The node is returned so the caller can keep
   * dragging it: the whole press-move-release is ONE undo record, committed by
   * `commitPathEdit` (which also re-origins the layer box once, at the end).
   */
  beginBend(
    layerId: string,
    localPoint: { x: number; y: number },
    tolerance = SNAP_TOLERANCE_DEFAULT,
  ): { index: number; point: { x: number; y: number } } | null {
    const layer = this.editablePath(layerId);
    if (!layer) return null;
    const prepared = this.bendReadyLayer(layer);
    // `null` = the drawing cannot be described by anchors at all (a multi-contour
    // ornament): there is no honest place to put the node, so nothing happens.
    if (!prepared) return null;
    // HIT TEST FIRST, PATCH SECOND. Freezing a legacy arc / `rawD` shape is a real
    // document change, and a press that misses the line must leave the document
    // exactly as it was — not convert the layer and then bail out.
    const hit = nearestSegmentOnCubics(this.bendSegmentsOf(prepared.layer), localPoint);
    if (!hit || hit.distance > tolerance) return null;
    if (prepared.patch) this.transientPatch(layerId, prepared.patch);
    const index = this.transientInsertAnchor(layerId, hit.segIndex, hit.t);
    if (index === null) return null;
    return { index, point: hit.point };
  }

  /**
   * INSERT A NODE MID-GESTURE, without history and without re-origining the box.
   *
   * The press that starts a bend creates the node AND keeps dragging it, so the
   * split must not go through `updateLayer` (which pushes a record and moves the
   * layer origin under the pointer). Returns the new node's index, or null when
   * the segment cannot take an anchor.
   */
  transientInsertAnchor(layerId: string, segIndex: number, t: number): number | null {
    const layer = this.editablePath(layerId);
    if (!layer) return null;
    const points = insertAnchor(layer.points, layer.closed, segIndex, t);
    if (points === layer.points) return null;
    const index = Math.min(segIndex + 1, points.length - 1);
    this.transientPatch(layerId, {
      points,
      ...this.freezeCurveSpec(layer),
      ...this.freezeBendModel(layer),
    } as Partial<CardLayer>);
    this.emit({ selectedAnchor: { layerId, index }, anchorSelection: [{ layerId, index }] });
    return index;
  }

  /** Drop a stale legacy arc model: the anchors are the geometry now. */
  private freezeBendModel(layer: PathLayer): Partial<CardLayer> {
    if (layer.bend === undefined && layer.curvature === undefined && layer.rawD === undefined) return {};
    return { bend: undefined, curvature: undefined, rawD: undefined, pathMode: "pen" };
  }

  /**
   * The layer as the BEND gesture needs it: anchors that ARE the geometry, or
   * `null` when the drawing cannot be expressed as one anchor contour.
   *
   * It returns the layer WITHOUT patching (the caller applies `patch` only once a
   * hit is confirmed) and every patch is transient on purpose — a gesture must
   * never re-origin the box or leave two undo records behind (the caller commits
   * once).
   */
  private bendReadyLayer(layer: PathLayer): { layer: PathLayer; patch: Partial<CardLayer> | null } | null {
    let next = layer;
    let patch: Partial<CardLayer> | null = null;
    const shadowsAnchors = (layer.points.length === 2 && layer.bend !== undefined) || layer.rawD !== undefined;
    if (shadowsAnchors) {
      const geometry = singleContourAnchors(layer);
      if (!geometry || geometry.points.length < 2) return null;
      patch = { ...(patch ?? {}), ...this.freezeBendModel(layer), points: geometry.points, closed: geometry.closed };
      next = {
        ...layer,
        points: geometry.points,
        closed: geometry.closed,
        bend: undefined,
        curvature: undefined,
        rawD: undefined,
        pathMode: "pen",
      } as PathLayer;
    }
    if (next.curve) {
      patch = { ...(patch ?? {}), ...this.freezeCurveSpec(next) };
      next = { ...next, curve: undefined, curveProfile: undefined, pathMode: "pen" } as PathLayer;
    }
    return { layer: next, patch };
  }

  /* ---------------------------- pen path surgery (§5) ---------------------------- */

  /** Reverse a path's direction. Handles travel with their anchors. */
  reversePath(layerId: string): void {
    const layer = this.editablePath(layerId);
    if (!layer) return;
    // A parametric curve reverses through its spec (so its parameters survive);
    // a plain path reverses by re-ordering its anchors.
    if (layer.curve) {
      this.reverseCurve(layerId);
      return;
    }
    this.applyPathPoints(layer, reversePoints(layer.points));
  }

  /**
   * Break a path at an anchor.
   *
   * CLOSED path → it opens (one layer, two ends at the break node).
   * OPEN path   → it splits into TWO layers, each keeping the original
   *               geometry, stroke and style.
   */
  breakPathAtAnchor(layerId: string, index: number): string[] {
    const layer = this.editablePath(layerId);
    if (!layer) return [];
    const broken = breakPathAt(layer.points, layer.closed, index);
    if (!broken || broken.first.length < 2) return [];

    if (layer.closed) {
      const next = normalizePathLayer<PathLayer>(
        { ...layer, closed: false, points: broken.first, curve: undefined },
        pathPadding(layer.strokeWidth),
      );
      this.updateLayer(layerId, {
        closed: false,
        points: next.points,
        x: next.x,
        y: next.y,
        width: next.width,
        height: next.height,
      } as Partial<CardLayer>);
      return [layerId];
    }

    if (broken.second.length < 2) return [];
    const pad = pathPadding(layer.strokeWidth);
    const firstLayer = normalizePathLayer<PathLayer>({ ...layer, points: broken.first, curve: undefined }, pad);
    const secondId = `path-${Math.random().toString(36).slice(2, 9)}`;
    const secondLayer = normalizePathLayer<PathLayer>(
      { ...layer, id: secondId, name: layer.name ? `${layer.name} (۲)` : undefined, points: broken.second, curve: undefined },
      pad,
    );
    this.pushHistory();
    const layers: CardLayer[] = [];
    for (const candidate of this.state.doc.layers) {
      if (candidate.id !== layerId) {
        layers.push(candidate);
        continue;
      }
      layers.push(firstLayer, secondLayer);
    }
    this.emit({
      doc: { ...this.state.doc, layers },
      selection: this.withSelection(secondId),
      selectedAnchor: { layerId: secondId, index: 0 },
    });
    return [layerId, secondId];
  }

  /**
   * Join two open paths end-to-end. The CLOSEST pair of ends wins, so clicking
   * either end in either order gives the same result. Both layers must share an
   * orientation (an unrotated path) — joining across rotations would have to
   * bake a transform into the anchors, which is a different feature.
   */
  joinPaths(firstId: string, secondId: string, tolerance = JOIN_TOLERANCE_DEFAULT): string | null {
    if (firstId === secondId) return null;
    const first = this.editablePath(firstId);
    const second = this.editablePath(secondId);
    if (!first || !second || first.closed || second.closed) return null;
    if (Math.abs((first.angle ?? 0) - (second.angle ?? 0)) > 0.01) return null;

    // Put the second path into the first path's LOCAL space before joining.
    const shiftX = second.x - first.x;
    const shiftY = second.y - first.y;
    const shifted = second.points.map((point) => ({
      x: point.x + shiftX,
      y: point.y + shiftY,
      hIn: point.hIn ? { x: point.hIn.x + shiftX, y: point.hIn.y + shiftY } : point.hIn ?? null,
      hOut: point.hOut ? { x: point.hOut.x + shiftX, y: point.hOut.y + shiftY } : point.hOut ?? null,
    }));

    const joined = joinPointLists(first.points, shifted, tolerance);
    if (!joined) return null;

    const pad = pathPadding(Math.max(first.strokeWidth, second.strokeWidth));
    const merged = normalizePathLayer<PathLayer>(
      { ...first, curve: undefined, points: joined.points },
      pad,
    );
    this.pushHistory();
    const layers = this.state.doc.layers
      .filter((layer) => layer.id !== secondId)
      .map((layer) => (layer.id === firstId ? merged : layer));
    this.emit({ doc: { ...this.state.doc, layers }, selection: this.withSelection(firstId) });
    return firstId;
  }

  /**
   * Continue drawing from an existing path's endpoint (§5).
   *
   * The existing anchors BECOME the pen draft, so finishing the gesture writes
   * the merged path straight back into the same layer.
   */
  continuePathFrom(layerId: string, end: "start" | "end" = "end"): boolean {
    const layer = this.editablePath(layerId);
    if (!layer || layer.closed) return false;
    const draft = end === "start" ? reversePoints(layer.points) : layer.points.map((p) => ({ ...p }));
    this.emit({
      penDraft: draft,
      penContinuation: { layerId, end },
      tool: "pen",
      selection: this.withSelection(null),
      selectedAnchor: null,
    });
    return true;
  }

  /** Snap targets from every visible path (nodes + free ends). */
  snapTargets(excludeLayerId?: string): SnapTarget[] {
    const targets: SnapTarget[] = [];
    for (const layer of this.state.doc.layers) {
      if (layer.kind !== "path" || layer.hidden || layer.locked || layer.id === excludeLayerId) continue;
      for (const target of anchorSnapTargets(layer.points, layer.id)) {
        targets.push({ ...target, x: target.x + layer.x, y: target.y + layer.y });
      }
    }
    return targets;
  }

  /** Snap an artboard-space point onto an existing node/endpoint (§5). */
  snapPoint(point: { x: number; y: number }, tolerance = SNAP_TOLERANCE_DEFAULT, excludeLayerId?: string) {
    return snapToTargets(point, this.snapTargets(excludeLayerId), tolerance);
  }

  /** Nearest anchor of ONE layer (node editing hit-test), artboard space. */
  nearestAnchorAt(layerId: string, point: { x: number; y: number }, tolerance = SNAP_TOLERANCE_DEFAULT) {
    const layer = this.editablePath(layerId);
    if (!layer) return null;
    const local = { x: point.x - layer.x, y: point.y - layer.y };
    return nearestAnchor(layer.points, local, tolerance);
  }

  /* -------------------------- freehand extensions (§6) -------------------------- */

  /**
   * Keep drawing an existing path with a new freehand run ("extend").
   * The run is fitted by the same pipeline the pencil uses, and it must start
   * near one of the path's ends — otherwise it becomes its own layer instead of
   * teleporting the existing stroke.
   */
  extendPathWithStroke(layerId: string, samples: { x: number; y: number }[]): string | null {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length < 2 || samples.length < 2) return null;
    const world = layer.points.map((point) => ({ x: point.x + layer.x, y: point.y + layer.y }));
    const fit = freehandPipeline(samples, {
      ...this.state.freehandTuning,
      mode: this.state.freehandMode,
      maxPoints: MAX_PATH_POINTS,
    });
    if (fit.points.length < 2) return null;
    const extended = extendPath(world, fit.points, JOIN_TOLERANCE_DEFAULT);
    if (!extended) return null;
    const next = normalizePathLayer<PathLayer>(
      { ...layer, x: 0, y: 0, points: extended, curve: undefined, closed: fit.closed || layer.closed },
      pathPadding(layer.strokeWidth),
    );
    this.updateLayer(layerId, {
      points: next.points,
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
      closed: next.closed,
    } as Partial<CardLayer>);
    return layerId;
  }

  /**
   * Reshape part of an existing path with a freshly drawn run (§6).
   * Anchors outside [fromIndex, toIndex] keep their exact handles.
   */
  reshapePathRun(
    layerId: string,
    fromIndex: number,
    toIndex: number,
    samples: { x: number; y: number }[],
  ): boolean {
    const layer = this.editablePath(layerId);
    if (!layer || samples.length < 2) return false;
    const world = layer.points.map((point) => ({ x: point.x + layer.x, y: point.y + layer.y }));
    const fit = freehandPipeline(samples, {
      ...this.state.freehandTuning,
      mode: "free",
      maxPoints: MAX_PATH_POINTS,
    });
    if (fit.points.length < 2) return false;
    const reshaped = reshapePath(world, fromIndex, toIndex, fit.points);
    if (!reshaped) return false;
    const next = normalizePathLayer<PathLayer>(
      { ...layer, x: 0, y: 0, points: reshaped, curve: undefined },
      pathPadding(layer.strokeWidth),
    );
    this.updateLayer(layerId, {
      points: next.points,
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
    } as Partial<CardLayer>);
    return true;
  }

  /** Simplify Path (§6/§15): drop redundant anchors, keep the shape. */
  simplifyPathLayer(layerId: string, fidelity = this.state.freehandTuning.fidelity): void {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length < 3) return;
    const simplified = simplifyAnchors(layer.points, fidelity, MAX_PATH_POINTS);
    // Re-fit handles from the surviving anchors so the simplified path is still
    // a smooth curve rather than a polygon.
    const refit = autoSmoothPoints(simplified, layer.closed, 0.28);
    this.applyPathPoints(layer, refit);
  }

  /** Auto-close an open path when its ends already touch. */
  autoClosePath(layerId: string): boolean {
    const layer = this.editablePath(layerId);
    if (!layer || layer.closed) return false;
    const closed = autoCloseWithinTolerance(layer.points, this.state.freehandTuning.closeTolerance);
    if (!closed) return false;
    const next = normalizePathLayer<PathLayer>({ ...layer, closed: true, points: closed }, pathPadding(layer.strokeWidth));
    this.updateLayer(layerId, {
      closed: true,
      points: next.points,
      x: next.x,
      y: next.y,
      width: next.width,
      height: next.height,
    } as Partial<CardLayer>);
    return true;
  }

  /* --------------------- region / face system (§8–§13, §16) --------------------- */

  /** All faces of the current document (memoised on the geometry — see §17). */
  regionFaces(): RegionFace[] {
    return this.facesFor(this.state.doc);
  }

  /** The face under a point, innermost first (§9). */
  regionAt(point: { x: number; y: number }): RegionFace | null {
    // The hit test uses the DOCUMENT's fill rule (§13), so a face the user can
    // see is a face the user can click — never a different set of pixels.
    const rule = (this.state.doc.regionSettings ?? DEFAULT_REGION_SETTINGS).fillRule;
    const hits = this.regionFaces().filter((face) => faceContainsPoint(face, point, rule));
    if (hits.length === 0) return null;
    return hits.sort((a, b) => b.depth - a.depth || Math.abs(a.area) - Math.abs(b.area))[0];
  }

  /** Hover highlight for region mode (view state only). */
  hoverRegionAt(point: { x: number; y: number } | null): void {
    const key = point ? this.regionAt(point)?.id ?? null : null;
    if (key === this.state.hoveredRegion) return;
    this.emit({ hoveredRegion: key });
  }

  /** The paint attached to a face key, if any. */
  regionStyleFor(key: string | null): RegionStyleEntry | null {
    if (!key) return null;
    return (this.state.doc.regions ?? []).find((style) => style.key === key) ?? null;
  }

  /** Region paint as a lookup (renderer + export read this). */
  regionPaintMap(): Record<string, RegionStyleEntry> {
    const map: Record<string, RegionStyleEntry> = {};
    for (const style of this.state.doc.regions ?? []) map[style.key] = style;
    return map;
  }

  /** Paint the face under a point. Returns the face key, or null when none. */
  paintRegionAt(point: { x: number; y: number }, style: Omit<RegionStyleEntry, "key">): string | null {
    const face = this.regionAt(point);
    if (!face) return null;
    this.paintRegion(face.id, style);
    return face.id;
  }

  /** Paint one face. Paint never touches the paths that bound it (§10). */
  paintRegion(key: string, style: Omit<RegionStyleEntry, "key">): void {
    this.writeRegions((regions) => {
      const next = regions.filter((entry) => entry.key !== key);
      next.push({ ...style, key });
      return next;
    });
  }

  /** Remove the paint from one face (the geometry is untouched). */
  clearRegion(key: string): void {
    this.writeRegions((regions) => regions.filter((entry) => entry.key !== key));
  }

  /** Remove EVERY region fill ("clear live paint"). */
  clearAllRegionPaint(): void {
    this.writeRegions(() => []);
  }

  /** Gap tolerance + fill rule for region detection. */
  setRegionSettings(patch: Partial<RegionSettings>): void {
    const current = this.state.doc.regionSettings ?? DEFAULT_REGION_SETTINGS;
    const next: RegionSettings = {
      gapTolerance: Math.min(64, Math.max(0, Number.isFinite(patch.gapTolerance) ? (patch.gapTolerance as number) : current.gapTolerance)),
      fillRule: patch.fillRule === "evenodd" || patch.fillRule === "nonzero" ? patch.fillRule : current.fillRule,
    };
    if (next.gapTolerance === current.gapTolerance && next.fillRule === current.fillRule) return;
    this.pushHistory();
    this.emit({ doc: { ...this.state.doc, regionSettings: next } });
  }

  /** §16 — switch the selection domain (object / path / node / region). */
  setSelectionDomain(domain: SelectionDomain): void {
    if (this.state.selectionDomain === domain) return;
    this.emit({
      selectionDomain: domain,
      // Leaving a domain drops the state that only makes sense inside it, so a
      // stale node focus or region highlight can never leak into the next one.
      selectedAnchor: domain === "node" ? this.state.selectedAnchor : null,
      editingPathId: domain === "node" ? this.state.editingPathId : null,
      hoveredRegion: domain === "region" ? this.state.hoveredRegion : null,
      selectedRegion: domain === "region" ? this.state.selectedRegion : null,
    });
  }

  /** Select a FACE (region domain). Never selects the paths that bound it. */
  selectRegion(key: string | null): void {
    const face = this.regionFaces().find((candidate) => candidate.id === key) ?? null;
    this.emit({
      selectionDomain: "region",
      selectedRegion: face ? face.id : null,
      selection: { layerId: null, ids: [] },
    });
  }

  /* ------------------------- region internals (§11/§17) ------------------------- */

  private regionCache: { key: string; faces: RegionFace[] } | null = null;

  /**
   * The topology key: everything the face computation depends on, and nothing
   * else. Two pointer samples inside the same geometry produce the same key, so
   * the planar-graph pass runs once per real edit instead of once per frame.
   */
  private topologyKey(doc: CardDocument): string {
    const settings = doc.regionSettings ?? DEFAULT_REGION_SETTINGS;
    const parts: string[] = [];
    for (const layer of doc.layers) {
      if (layer.kind !== "path" || layer.hidden || layer.opacity <= 0) continue;
      parts.push(`${layer.id}|${layer.x},${layer.y}|${layer.closed ? "c" : "o"}|${resolveLayerPathD(layer)}`);
    }
    return `${settings.gapTolerance}|${settings.fillRule}|${parts.join("~")}`;
  }

  /** The canonical face list for a document, memoised on its topology key. */
  private facesFor(doc: CardDocument): RegionFace[] {
    const key = this.topologyKey(doc);
    if (this.regionCache && this.regionCache.key === key) return this.regionCache.faces;
    const faces = regionsForDocument(doc);
    this.regionCache = { key, faces };
    return faces;
  }

  /**
   * §11 — re-attach saved paint to the current faces after a geometry change.
   * Called from `emit` (never inside a live drag) so every edit path in the
   * engine gets the behaviour for free, including undo/redo and template apply.
   */
  private remapRegions(doc: CardDocument): CardDocument {
    const previous = doc.regions ?? [];
    if (previous.length === 0) return doc;
    const faces = this.facesFor(doc);
    const remapped = remapRegionStyles(previous, faces);
    const same =
      remapped.length === previous.length && remapped.every((style, i) => style.key === previous[i].key);
    return same ? doc : { ...doc, regions: remapped.length > 0 ? remapped : [] };
  }

  /** One history record per paint action. */
  private writeRegions(mutate: (regions: RegionStyleEntry[]) => RegionStyleEntry[]): void {
    const current = this.state.doc.regions ?? [];
    const next = mutate(current.map((style) => ({ ...style })));
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    this.pushHistory();
    this.emit({ doc: { ...this.state.doc, regions: next } });
  }

  /* ---------------------------- path point editor ---------------------------- */

  /**
   * Focus an anchor (view state — the point editor overlay reads it).
   *
   * `additive` toggles nodes outside point-edit range selection; while editing a
   * path, the first shift-click starts a range and the second completes it.
   */
  selectAnchor(selection: AnchorSelection | null, additive = false): void {
    if (!additive || selection === null) {
      this.emit({
        selectedAnchor: selection,
        anchorSelection: selection ? [selection] : [],
        curveRangeStart: null,
      });
      return;
    }
    if (this.state.editingPathId === selection.layerId) {
      const start = this.state.curveRangeStart;
      const current = this.state.selectedAnchor;
      const hasStartedRange =
        start?.layerId === selection.layerId &&
        current?.layerId === selection.layerId &&
        current.index === start.index;
      if (!hasStartedRange || selection.index === start?.index) {
        const currentSelection = this.state.anchorSelection.filter((anchor) => anchor.layerId === selection.layerId);
        const selected = currentSelection.some(
          (anchor) => anchor.layerId === selection.layerId && anchor.index === selection.index,
        );
        const nextSelection = selected
          ? currentSelection.filter(
              (anchor) => !(anchor.layerId === selection.layerId && anchor.index === selection.index),
            )
          : [...currentSelection, selection];
        this.emit({
          selectedAnchor: selection,
          anchorSelection: nextSelection,
          curveRangeStart: selection,
        });
      } else {
        this.emit({
          selectedAnchor: selection,
          anchorSelection: [selection],
        });
      }
      return;
    }
    const current = this.state.anchorSelection;
    const found = current.findIndex(
      (anchor) => anchor.layerId === selection.layerId && anchor.index === selection.index,
    );
    if (found !== -1) {
      // Deselect: the last remaining node is promoted to primary.
      const next = current.filter((_, index) => index !== found);
      this.emit({ selectedAnchor: next.length > 0 ? next[next.length - 1] : null, anchorSelection: next });
      return;
    }
    this.emit({ selectedAnchor: selection, anchorSelection: [...current, selection] });
  }

  /**
   * Enter/leave point-editing mode for a path.
   *
   * Entering focuses the first anchor so the inspector immediately has a
   * subject; leaving clears the anchor so no stale index survives into the next
   * selection.
   */
  setPathEditing(layerId: string | null): void {
    if (this.state.editingPathId === layerId) return;
    if (layerId === null) {
      this.emit({ editingPathId: null, selectedAnchor: null, anchorSelection: [], curveRangeStart: null });
      return;
    }
    const layer = this.editablePath(layerId);
    if (!layer) return;
    // NOTE: entering the mode does NOT convert a legacy two-point arc. Looking at
    // the nodes must never destroy the parametric description of the line (the
    // arc slider has to survive a mere click-through), so the conversion happens
    // on the first STRUCTURAL edit instead: `beginBend` freezes it before
    // inserting, and `applyPathPoints` drops it for every other node edit. The
    // two anchors it does show are honest — they are the drawn arc's endpoints.
    const first = { layerId, index: 0 };
    this.emit({
      editingPathId: layerId,
      selectedAnchor: first,
      anchorSelection: [first],
      curveRangeStart: null,
    });
  }

  toggleShowNodes(): void {
    this.emit({ showNodes: !this.state.showNodes });
  }

  setCurveRangeStart(anchor: AnchorSelection | null): void {
    this.emit({ curveRangeStart: anchor });
  }

  /**
   * Give an anchor SMOOTH handles derived from its neighbours.
   */
  smoothAnchor(layerId: string, index: number): void {
    const layer = this.editablePath(layerId);
    if (!layer || index < 0 || index >= layer.points.length) return;
    const smoothed = smoothAnchorAt(layer.points, index, layer.closed);
    this.applyPathPoints(layer, smoothed);
  }

  /** Turn an anchor back into a corner by dropping both of its handles. */
  cornerAnchor(layerId: string, index: number): void {
    const layer = this.editablePath(layerId);
    if (!layer || index < 0 || index >= layer.points.length) return;
    const cornered = cornerAnchorAt(layer.points, index);
    this.applyPathPoints(layer, cornered);
  }

  /** Alias for cornerAnchor. */
  straightenAnchor(layerId: string, index: number): void {
    this.cornerAnchor(layerId, index);
  }

  /** Set a node's tangent to a world-space angle and handle length. */
  setAnchorTangent(layerId: string, index: number, angle: number, length: number): boolean {
    const layer = this.editablePath(layerId);
    if (!layer || !Number.isInteger(index) || index < 0 || index >= layer.points.length) return false;
    if (!Number.isFinite(angle) || !Number.isFinite(length) || length < 0 || length > 2000) return false;
    const radians = ((angle - (layer.angle ?? 0)) * Math.PI) / 180;
    const dx = Math.cos(radians) * length;
    const dy = Math.sin(radians) * length;
    const points = layer.points.map((current, currentIndex) =>
      currentIndex === index
        ? {
            ...current,
            hIn: length === 0 ? null : { x: current.x - dx, y: current.y - dy },
            hOut: length === 0 ? null : { x: current.x + dx, y: current.y + dy },
          }
        : current,
    );
    const anchorWorld = this.pathAnchorWorldPosition(layer, index);
    const source = layer.curve
      ? ({ ...layer, ...this.freezeCurveSpec(layer), points } as PathLayer)
      : ({ ...layer, points } as PathLayer);
    const normalized = normalizePathLayer(source, pathPadding(layer.strokeWidth));
    const correctedWorld = this.pathAnchorWorldPosition(normalized, index);
    this.updateLayer(layerId, {
      points: normalized.points,
      x: normalized.x + anchorWorld.x - correctedWorld.x,
      y: normalized.y + anchorWorld.y - correctedWorld.y,
      width: normalized.width,
      height: normalized.height,
      curve: undefined,
      curveProfile: undefined,
      ...(layer.curve ? { pathMode: "pen" } : {}),
    } as Partial<CardLayer>);
    return true;
  }

  /** Move an anchor to an exact artboard coordinate, retaining its handles. */
  setAnchorWorldPosition(layerId: string, index: number, position: { x: number; y: number }): boolean {
    const layer = this.editablePath(layerId);
    if (!layer || !Number.isInteger(index) || index < 0 || index >= layer.points.length) return false;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
    const angle = ((layer.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const centerX = layer.width / 2;
    const centerY = layer.height / 2;
    const dx = position.x - (layer.x + centerX);
    const dy = position.y - (layer.y + centerY);
    const local = {
      x: dx * cos + dy * sin + centerX,
      y: -dx * sin + dy * cos + centerY,
    };
    const moved = moveAnchor(layer.points, index, local);
    const source = layer.curve
      ? ({ ...layer, ...this.freezeCurveSpec(layer), points: moved } as PathLayer)
      : ({ ...layer, points: moved } as PathLayer);
    const normalized = normalizePathLayer(source, pathPadding(layer.strokeWidth));
    const normalizedPoint = normalized.points[index];
    const normalizedCenterX = normalized.width / 2;
    const normalizedCenterY = normalized.height / 2;
    const pointDx = normalizedPoint.x - normalizedCenterX;
    const pointDy = normalizedPoint.y - normalizedCenterY;
    const worldX = normalized.x + normalizedCenterX + pointDx * cos - pointDy * sin;
    const worldY = normalized.y + normalizedCenterY + pointDx * sin + pointDy * cos;
    this.updateLayer(layerId, {
      points: normalized.points,
      x: normalized.x + position.x - worldX,
      y: normalized.y + position.y - worldY,
      width: normalized.width,
      height: normalized.height,
      curve: undefined,
      curveProfile: undefined,
      ...(layer.curve ? { pathMode: "pen" } : {}),
    } as Partial<CardLayer>);
    return true;
  }

  private pathAnchorWorldPosition(layer: PathLayer, index: number): { x: number; y: number } {
    const point = layer.points[index];
    const angle = ((layer.angle ?? 0) * Math.PI) / 180;
    const dx = point.x - layer.width / 2;
    const dy = point.y - layer.height / 2;
    return {
      x: layer.x + layer.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: layer.y + layer.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle),
    };
  }

  /**
   * Toggle a specific anchor between smooth curve and sharp corner (Illustrator standard).
   */
  toggleAnchorType(layerId: string, index: number): void {
    const layer = this.editablePath(layerId);
    if (!layer || index < 0 || index >= layer.points.length) return;
    const toggled = toggleAnchorAt(layer.points, index, layer.closed);
    this.applyPathPoints(layer, toggled);
  }

  /** The path layer behind `layerId`, or null when it is not an editable path. */
  private editablePath(layerId: string): PathLayer | null {
    const layer = this.state.doc.layers.find((l) => l.id === layerId);
    return layer && layer.kind === "path" && !layer.locked ? layer : null;
  }

  /** Live anchor drag (transient — pointerUp commits ONE record). */
  transientMoveAnchor(layerId: string, index: number, position: { x: number; y: number }): void {
    const layer = this.editablePath(layerId);
    if (!layer) return;
    // A PARAMETRIC curve keeps its parameters while an ENDPOINT is dragged: the
    // chord moved, so length is updated and the chord direction is folded into
    // the layer angle. Any other node (or an already-frozen curve) has no
    // parametric equivalent, so the spec is frozen and the anchors take over.
    const spec = layer.curve && layer.curve.kind !== "custom" ? normalizeCurveSpec(layer.curve) : null;
    if (spec && curveSpecMatchesGeometry(spec, layer.points)) {
      const applied = curveEndpointEdit(spec, layer.points, index, position);
      if (applied) {
        this.transientPatch(layerId, {
          curve: applied.spec,
          points: applied.points,
        } as Partial<CardLayer>);
        return;
      }
    }
    this.transientPatch(layerId, {
      points: moveAnchor(layer.points, index, position),
      ...this.freezeCurveSpec(layer),
    } as Partial<CardLayer>);
  }

  /** Live handle drag (transient). `symmetric` mirrors the opposite handle. */
  transientMoveHandle(
    layerId: string,
    index: number,
    which: "hIn" | "hOut",
    position: { x: number; y: number },
    symmetric: boolean,
  ): void {
    const layer = this.editablePath(layerId);
    if (!layer) return;
    this.transientPatch(layerId, {
      points: moveHandle(layer.points, index, which, position, symmetric),
      ...this.freezeCurveSpec(layer),
    } as Partial<CardLayer>);
  }

  transientDragSegment(
    layerId: string,
    segIndex: number,
    dx: number,
    dy: number,
  ): void {
    const layer = this.editablePath(layerId);
    if (!layer || segIndex < 0 || segIndex >= layer.points.length - (layer.closed ? 0 : 1)) return;
    const pts = layer.points.map((p) => ({ ...p }));
    const nextIdx = layer.closed ? (segIndex + 1) % pts.length : Math.min(segIndex + 1, pts.length - 1);
    const from = pts[segIndex];
    const to = pts[nextIdx];
    const hOut = from.hOut ?? {
      x: from.x + (to.x - from.x) / 3,
      y: from.y + (to.y - from.y) / 3,
    };
    const hIn = to.hIn ?? {
      x: to.x - (to.x - from.x) / 3,
      y: to.y - (to.y - from.y) / 3,
    };
    from.hOut = { x: hOut.x + dx, y: hOut.y + dy };
    to.hIn = { x: hIn.x + dx, y: hIn.y + dy };
    this.transientPatch(layerId, {
      points: pts,
      ...this.freezeCurveSpec(layer),
    } as Partial<CardLayer>);
  }

  /**
   * End a point edit: re-origin the layer box onto the new geometry, then record
   * exactly ONE history entry for the whole gesture.
   *
   * The box is deliberately NOT re-origined during the drag — moving the layer
   * origin mid-gesture would shift the coordinate space under the pointer.
   */
  commitPathEdit(layerId: string): void {
    const layer = this.editablePath(layerId);
    if (!layer) {
      this.commitTransient();
      return;
    }
    const normalized = normalizePathLayer(layer, pathPadding(layer.strokeWidth));
    if (JSON.stringify(normalized) !== JSON.stringify(layer)) {
      // No-op when the drag already opened a transient gesture; this only adds
      // the pre-state when the geometry changed without a pointer gesture.
      this.beginTransient();
      this.transientTouched = true;
      const layers = this.state.doc.layers.map((l) => (l.id === layerId ? normalized : l));
      this.emit({ doc: { ...this.state.doc, layers } });
    }
    this.commitTransient();
    this.anchorGesture = null;
    this.clearSnapGuides();
  }

  /** Insert an anchor on a segment (loss-less de Casteljau split). One record. */
  insertAnchorAt(layerId: string, segIndex: number, t: number): void {
    const layer = this.editablePath(layerId);
    if (!layer) return;
    const points = insertAnchor(layer.points, layer.closed, segIndex, t);
    if (points === layer.points) return;
    this.applyPathPoints(layer, points);
    this.emit({ selectedAnchor: { layerId, index: segIndex + 1 } });
  }

  /** Remove an anchor (never below the minimum drawable point count). */
  removeAnchorAt(layerId: string, index: number): void {
    const layer = this.editablePath(layerId);
    if (!layer) return;
    const points = removeAnchor(layer.points, layer.closed, index);
    if (points.length === layer.points.length) return;
    this.applyPathPoints(layer, points);
    const selection = this.state.selectedAnchor;
    if (selection?.layerId === layerId) {
      this.emit({
        selectedAnchor: { layerId, index: Math.min(index, points.length - 1) },
      });
    }
  }

  /** Open or close a path. A closed path can also be filled. */
  setPathClosed(layerId: string, closed: boolean): void {
    const layer = this.editablePath(layerId);
    if (!layer || layer.closed === closed) return;
    const normalized = normalizePathLayer({ ...layer, closed }, pathPadding(layer.strokeWidth));
    this.updateLayer(layerId, {
      closed,
      points: normalized.points,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
    } as Partial<CardLayer>);
  }

  /**
   * Automatically convert all points of a path into a continuous, smooth, organic curve.
   */
  autoSmoothLayer(layerId: string, tension = 0.28): void {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length < 2) return;
    const smoothed = autoSmoothPoints(layer.points, layer.closed, tension);
    this.applyPathPoints(layer, smoothed);
  }

  /**
   * Straighten all anchors of a path into sharp corner points.
   */
  straightenLayer(layerId: string): void {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length < 2) return;
    const straight = straightenAllPoints(layer.points);
    this.applyPathPoints(layer, straight);
  }

  /** Replace a path's points in ONE history record, with the box re-derived. */
  private applyPathPoints(layer: PathLayer, points: PathPoint[]): void {
    // Once a user edits a generated parametric curve at node/handle level, the
    // anchors become the source of truth. Keeping the old curve spec alive
    // would make the next parameter edit silently regenerate the user's manual
    // geometry, which is not acceptable in a vector editor.
    //
    // The same rule covers the two other spellings of geometry that SHADOW the
    // anchors in the resolver: a legacy `bend` arc is drawn as a circle (a node
    // edit that left `bend` alive would be invisible — and the box would hug the
    // chord), and `rawD` outranks `points`. Anchors are the geometry now.
    const dropsModel =
      layer.curve !== undefined ||
      layer.bend !== undefined ||
      layer.curvature !== undefined ||
      layer.rawD !== undefined;
    const source = dropsModel
      ? ({ ...layer, ...this.freezeCurveSpec(layer), ...this.freezeBendModel(layer), points } as PathLayer)
      : ({ ...layer, points } as PathLayer);
    const normalized = normalizePathLayer(source, pathPadding(layer.strokeWidth));
    this.updateLayer(layer.id, {
      points: normalized.points,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      curve: undefined,
      curveProfile: undefined,
      ...(dropsModel ? { bend: undefined, curvature: undefined, rawD: undefined, pathMode: "pen" } : {}),
    } as Partial<CardLayer>);
  }

  /* --------------------------- multi-node editing --------------------------- */

  /**
   * The path a node gesture acts on: the one in point-edit mode, or the single
   * selected path. Returning null means "there is no node context" — every
   * group operation below then does nothing instead of guessing.
   */
  anchorTargetId(): string | null {
    if (this.state.editingPathId && this.editablePath(this.state.editingPathId)) return this.state.editingPathId;
    const selected = this.state.selection.layerId;
    return selected && this.editablePath(selected) ? selected : null;
  }

  /** The whole node group (a single node is a one-element group). */
  anchorSelectionList(): AnchorSelection[] {
    return this.state.anchorSelection;
  }

  /** Selected node INDICES of one path, cleaned and sorted (never duplicates). */
  selectedAnchorIndices(layerId: string | null = this.anchorTargetId()): number[] {
    const layer = layerId ? this.editablePath(layerId) : null;
    if (!layer) return [];
    return normalizeAnchorIndices(
      layer.points.length,
      this.state.anchorSelection.filter((anchor) => anchor.layerId === layer.id).map((anchor) => anchor.index),
    );
  }

  /** Select every node of a path (⌘A in node mode). Returns how many were selected. */
  selectAllAnchors(layerId: string | null = this.anchorTargetId()): number {
    const layer = layerId ? this.editablePath(layerId) : null;
    if (!layer || layer.points.length === 0) return 0;
    const group = layer.points.map((_, index) => ({ layerId: layer.id, index }));
    this.emit({ selectedAnchor: group[0], anchorSelection: group, curveRangeStart: null });
    return group.length;
  }

  /**
   * MARQUEE: select the nodes inside a rect drawn in ARTBOARD coordinates.
   *
   * The rect arrives in world space (that is what the pointer produces) and is
   * converted into the path's own frame here, so the overlay never has to know
   * about layer origins. `additive` keeps whatever was already selected.
   */
  selectAnchorsInRect(rect: WorldRect, additive = false, layerId: string | null = this.anchorTargetId()): number {
    const layer = layerId ? this.editablePath(layerId) : null;
    if (!layer) return 0;
    const angle = ((layer.angle ?? 0) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const centerX = layer.width / 2;
    const centerY = layer.height / 2;
    const worldPoints = layer.points.map((point) => {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      return {
        x: layer.x + centerX + dx * cos - dy * sin,
        y: layer.y + centerY + dx * sin + dy * cos,
      };
    });
    const found = anchorsInRect(worldPoints, rect, 0).map((index) => ({ layerId: layer.id, index }));
    if (found.length === 0) {
      if (additive) return 0;
      this.clearAnchorSelection();
      return 0;
    }
    const existing = additive
      ? this.state.anchorSelection.filter((anchor) => !found.some((hit) => hit.layerId === anchor.layerId && hit.index === anchor.index))
      : [];
    const group = [...existing, ...found];
    this.emit({ selectedAnchor: group[0], anchorSelection: group, curveRangeStart: null });
    return found.length;
  }

  clearAnchorSelection(): void {
    this.emit({ selectedAnchor: null, anchorSelection: [], curveRangeStart: null });
  }

  /** Where a group drag starts: the geometry it is measured FROM. */
  private anchorGesture: { layerId: string; indices: number[]; points: PathPoint[] } | null = null;

  /**
   * Begin a node drag. Idempotent: calling it again during the same gesture
   * keeps the ORIGINAL geometry, which is what makes the drag a function of the
   * total pointer delta instead of an accumulation of samples (no drift).
   */
  beginAnchorGesture(layerId: string | null = this.anchorTargetId(), indices?: number[]): number[] {
    const layer = layerId ? this.editablePath(layerId) : null;
    if (!layer) return [];
    const list = normalizeAnchorIndices(layer.points.length, indices ?? this.selectedAnchorIndices(layer.id));
    if (list.length === 0) return [];
    if (!this.anchorGesture || this.anchorGesture.layerId !== layer.id) {
      this.anchorGesture = { layerId: layer.id, indices: list, points: layer.points.map((point) => ({ ...point })) };
    }
    this.beginTransient();
    return list;
  }

  /**
   * Live group drag (transient — ONE history record at `commitPathEdit`).
   *
   * The delta is measured from the gesture's START geometry, and SNAPPING is
   * applied to the primary node and transferred to the whole group: the group
   * stays rigid and the node under the pointer is the one that lands exactly on
   * the target, exactly like dragging a selection in Figma.
   */
  transientMoveAnchors(delta: { x: number; y: number }, options: { snap?: boolean } = {}): void {
    const gesture = this.anchorGesture;
    if (!gesture) return;
    const layer = this.editablePath(gesture.layerId);
    if (!layer) return;

    let dx = delta.x;
    let dy = delta.y;
    let guides: Guide[] = [];
    if (this.state.snapping && options.snap !== false && gesture.indices.length > 0) {
      const primary = this.state.selectedAnchor?.layerId === gesture.layerId
        ? this.state.selectedAnchor.index
        : gesture.indices[0];
      const start = gesture.points[primary] ?? gesture.points[gesture.indices[0]];
      const target = { x: start.x + layer.x + dx, y: start.y + layer.y + dy };
      const snapped = this.smartSnapPoint(target, { excludeIds: [gesture.layerId] });
      dx += snapped.x - target.x;
      dy += snapped.y - target.y;
      guides = snapped.guides;
    }

    this.emit({ snapGuides: guides });
    this.transientPatch(gesture.layerId, {
      points: moveAnchorsBy(gesture.points, gesture.indices, dx, dy),
      ...(layer.curve ? { curve: undefined, curveProfile: undefined, pathMode: "pen" } : {}),
    } as Partial<CardLayer>);
  }

  /**
   * Move the selected nodes by a fixed delta (arrow keys, numeric fields).
   * One history record per call, and the box is re-derived afterwards.
   */
  moveSelectedAnchors(dx: number, dy: number, layerId: string | null = this.anchorTargetId()): boolean {
    const layer = layerId ? this.editablePath(layerId) : null;
    if (!layer) return false;
    const indices = this.selectedAnchorIndices(layer.id);
    if (indices.length === 0 || (dx === 0 && dy === 0)) return false;
    this.applyPathPoints(layer, moveAnchorsBy(layer.points, indices, dx, dy));
    return true;
  }

  /**
   * Delete every selected node in ONE record.
   *
   * Refused when the path would drop below the minimum drawable anchor count:
   * deleting the last two nodes of a line would leave a layer that cannot be
   * drawn or edited, which is never what the user meant.
   */
  deleteSelectedAnchors(layerId: string | null = this.anchorTargetId()): boolean {
    const layer = layerId ? this.editablePath(layerId) : null;
    if (!layer) return false;
    const indices = this.selectedAnchorIndices(layer.id);
    if (indices.length === 0) return false;
    const next = deleteAnchors(layer.points, layer.closed, indices);
    if (!next) return false;
    this.applyPathPoints(layer, next);
    const primary = Math.min(indices[0], next.length - 1);
    this.emit({ selectedAnchor: { layerId: layer.id, index: primary }, anchorSelection: [{ layerId: layer.id, index: primary }] });
    return true;
  }

  /** Smooth/corner a whole node group (§5 node toolbar). One record. */
  setSelectedAnchorType(type: "smooth" | "corner", layerId: string | null = this.anchorTargetId()): boolean {
    const layer = layerId ? this.editablePath(layerId) : null;
    if (!layer) return false;
    const indices = this.selectedAnchorIndices(layer.id);
    if (indices.length === 0) return false;
    this.applyPathPoints(layer, setAnchorTypes(layer.points, layer.closed, indices, type));
    return true;
  }

  /**
   * INSERT ON CLICK: add a node where the pointer touched the path.
   *
   * The segment is split with de Casteljau (`insertAnchor`), so the drawn curve
   * does not move by a single pixel — the new node simply appears on it. Returns
   * the new node's index, or null when the click was not on the path.
   */
  insertAnchorNearest(layerId: string, point: { x: number; y: number }, tolerance = SNAP_TOLERANCE_DEFAULT): number | null {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length < 2) return null;
    const hit = nearestSegmentParam(layer.points, layer.closed, { x: point.x - layer.x, y: point.y - layer.y });
    if (!hit || hit.distance > tolerance) return null;
    const next = insertAnchor(layer.points, layer.closed, hit.segIndex, hit.t);
    if (next === layer.points) return null;
    this.applyPathPoints(layer, next);
    const index = Math.min(hit.segIndex + 1, next.length - 1);
    this.emit({ selectedAnchor: { layerId, index } });
    return index;
  }

  /* ------------------------------ smart guides ------------------------------ */

  /**
   * Turn snapping on/off. Guides are dropped with it: leaving a stale guide on
   * screen after the feature is off would be a lie about what the geometry did.
   */
  setSnapping(enabled: boolean): void {
    if (this.state.snapping === enabled) return;
    this.emit({ snapping: enabled, snapGuides: [] });
  }

  /** Screen-space-ish snap radius in design px. */
  setSnapTolerance(px: number): void {
    if (!Number.isFinite(px)) return;
    this.snapTolerance = Math.max(0, Math.min(64, px));
  }

  private snapTolerance = SNAP_TOLERANCE_DEFAULT;

  /** Every snap target in the document (anchors, box edges/centres, artboard). */
  snapIndex(excludeIds: string[] = []): SnapIndex {
    // User guides join the index as ordinary lines: a guide that cannot snap is
    // a decoration, and the whole point of placing one is to align to it.
    return buildSnapIndex(this.state.doc, {
      excludeIds,
      guides: axisAlignedGuideLines(this.state.guides, this.state.doc.artboard),
    });
  }

  /* --------------------- rulers, guides & the set-square --------------------- */

  /** Show/hide the ruler strips. Guides survive the toggle. */
  setRulers(enabled: boolean): void {
    if (this.state.rulers === enabled) return;
    this.emit({ rulers: enabled });
  }

  /**
   * Place a guide (dragging out of a ruler). Adding onto an existing guide of
   * the same axis MOVES it — see `domain/guides.addGuide`.
   */
  addGuide(axis: GuideAxis, at: number): void {
    const next = addGuide(this.state.guides, axis, at, this.state.doc.artboard);
    if (next === this.state.guides) return;
    this.emit({ guides: next });
  }

  /**
   * Place a guide at ANY angle — the diagonal a ruler drag cannot express.
   * `point` is where the line passes; the angle is in degrees (0 = horizontal).
   */
  addAngledGuide(angle: number, point: { x: number; y: number }): void {
    const next = addAngledGuide(this.state.guides, { angle, ...point }, this.state.doc.artboard);
    if (next === this.state.guides) return;
    this.emit({ guides: next });
  }

  /** Move one guide while it is dragged (its anchor point follows the pointer). */
  moveGuide(id: string, point: { x: number; y: number }): void {
    const next = moveGuide(this.state.guides, id, point, this.state.doc.artboard);
    if (next === this.state.guides) return;
    this.emit({ guides: next });
  }

  /** Spin a guide around its own anchor — how a horizontal guide becomes diagonal. */
  rotateGuide(id: string, angle: number): void {
    const next = rotateGuide(this.state.guides, id, angle, this.state.doc.artboard);
    if (next === this.state.guides) return;
    this.emit({ guides: next });
  }

  /** Remove one guide (double-click, or dropping it back onto the ruler). */
  removeGuide(id: string): boolean {
    const next = removeGuide(this.state.guides, id);
    if (next.length === this.state.guides.length) return false;
    this.emit({ guides: next });
    return true;
  }

  toggleGuideLock(id: string): void {
    const next = toggleGuideLock(this.state.guides, id);
    if (next.every((guide, index) => guide === this.state.guides[index])) return;
    this.emit({ guides: next });
  }

  clearGuides(): void {
    const next = this.state.guides.filter((guide) => guide.locked === true);
    if (next.length === this.state.guides.length) return;
    this.emit({ guides: next });
  }

  /** Create a locked straightedge at an absolute angle through the dial vertex. */
  addLockedAngledGuide(angle: number, point: { x: number; y: number }): boolean {
    const before = this.state.guides;
    const next = addAngledGuide(before, { angle, ...point }, this.state.doc.artboard);
    const normalizedAngle = ((angle % 180) + 180) % 180;
    const existing = next.find((guide) => {
      const delta = Math.abs((((guide.angle - normalizedAngle) % 180) + 270) % 180 - 90);
      const distance = Math.abs((point.x - guide.x) * Math.sin((guide.angle * Math.PI) / 180) - (point.y - guide.y) * Math.cos((guide.angle * Math.PI) / 180));
      return delta < 0.5 && distance < 0.5;
    });
    if (next.length === before.length && !existing) return false;
    if (existing) {
      const locked = next.map((guide) => guide.id === existing.id ? { ...guide, locked: true } : guide);
      this.emit({ guides: locked });
      return true;
    }
    this.emit({ guides: next });
    return false;
  }

  /** Add a physical drafting triangle at the center of the artboard. */
  addSetSquare(kind: SetSquareKind = "45-45-90"): string | null {
    if (this.state.setSquares.length >= MAX_SET_SQUARES) return null;
    const id = `set-square-${Math.random().toString(36).slice(2, 9)}`;
    const square = createSetSquare(id, {
      x: this.state.doc.artboard.width / 2,
      y: this.state.doc.artboard.height / 2,
    }, kind);
    this.emit({ setSquares: [...this.state.setSquares, square] });
    return id;
  }

  moveSetSquare(id: string, center: { x: number; y: number }): void {
    this.emit({ setSquares: this.state.setSquares.map(s => s.id === id && !s.locked ? normalizeSetSquare({ ...s, cx: center.x, cy: center.y }) : s) });
  }

  rotateSetSquare(id: string, angle: number): void {
    this.emit({ setSquares: this.state.setSquares.map(s => s.id === id && !s.locked ? normalizeSetSquare({ ...s, angle }) : s) });
  }

  resizeSetSquare(id: string, size: number): void {
    const clamped = Math.max(SET_SQUARE_MIN_SIZE, Math.min(SET_SQUARE_MAX_SIZE, size));
    this.emit({ setSquares: this.state.setSquares.map(s => s.id === id && !s.locked ? normalizeSetSquare({ ...s, size: clamped }) : s) });
  }

  toggleSetSquareLock(id: string): void {
    this.emit({ setSquares: this.state.setSquares.map(s => s.id === id ? { ...s, locked: !s.locked } : s) });
  }

  switchSetSquareKind(id: string): void {
    this.emit({ setSquares: this.state.setSquares.map(s => s.id === id && !s.locked ? toggleSetSquareKind(s) : s) });
  }

  removeSetSquare(id: string): void {
    this.emit({ setSquares: this.state.setSquares.filter(s => s.id !== id || s.locked) });
  }

  clearSetSquares(): void {
    const next = this.state.setSquares.filter(s => s.locked);
    if (next.length !== this.state.setSquares.length) this.emit({ setSquares: next });
  }

  /** Turn the angle-assist grid on/off (the "set-square"). */
  setAngleAssist(enabled: boolean): void {
    if (this.state.angleAssist === enabled) return;
    this.emit({ angleAssist: enabled });
  }

  /** Pick the angular grid: 45 (default), 30, 15 or 90 degrees. */
  setAngleAssistIncrement(degrees: number): void {
    const next = normalizeAngleAssist(degrees);
    if (this.state.angleAssistIncrement === next) return;
    this.emit({ angleAssistIncrement: next });
  }

  /**
   * Snap ONE point and report the guides that explain it.
   *
   * The result is returned as data — the engine does not decide what a UI does
   * with it, and the guides are never written into the document.
   */
  smartSnapPoint(
    point: { x: number; y: number },
    options: { excludeIds?: string[]; tolerance?: number; grid?: number; axisLock?: boolean } = {},
  ): SnapResult {
    return snapPointSmart(point, this.snapIndex(options.excludeIds ?? []), {
      tolerance: options.tolerance ?? this.snapTolerance,
      grid: options.grid,
      axisLock: options.axisLock,
      angledGuides: angledGuideLines(this.state.guides, this.state.doc.artboard),
      artboard: this.state.doc.artboard,
    });
  }

  /** Equal-spacing guides for a box against the rest of the document. */
  spacingGuides(
    rect: WorldRect,
    options: { excludeIds?: string[]; axis?: "x" | "y"; tolerance?: number } = {},
  ): Guide[] {
    const exclude = new Set(options.excludeIds ?? []);
    const others = this.state.doc.layers
      .filter((layer) => !layer.hidden && layer.opacity > 0 && !exclude.has(layer.id))
      .map((layer) => ({ x: layer.x, y: layer.y, width: layer.width, height: layer.height }));
    return equalSpacingGuides(rect, others, { tolerance: options.tolerance, axis: options.axis });
  }

  /** Distance readout between two points (Alt-hover measurement). */
  measure(from: { x: number; y: number }, to: { x: number; y: number }) {
    const measured = measureBetween(from, to);
    this.emit({ snapGuides: measured.guides });
    return measured;
  }

  clearSnapGuides(): void {
    if (this.state.snapGuides.length === 0) return;
    this.emit({ snapGuides: [] });
  }

  /**
   * Set the live guides directly. The engine is the single source of truth for
   * what is on screen, so the gesture code that computes guides from a BOX drag
   * (rather than a point) publishes them here instead of keeping its own copy.
   */
  publishSnapGuides(guides: Guide[]): void {
    this.emit({ snapGuides: guides });
  }

  /* --------------------------- numeric field entry --------------------------- */

  /**
   * A numeric inspector field, with Figma-style expressions: `+10`, `-5`, `*2`,
   * `/4`, `50%`, `1/3`.
   *
   * The expression grammar is walked by `domain/numericInput.ts` — a total,
   * side-effect-free parser; `eval` is never involved, and an entry the grammar
   * rejects writes NOTHING and returns false so the caller can keep the text.
   */
  setNumericField(layerId: string, field: NumericField, raw: string): boolean {
    const layer = this.state.doc.layers.find((candidate) => candidate.id === layerId);
    if (!layer || layer.locked) return false;
    const limits = NUMERIC_FIELD_LIMITS[field];
    const current = readLayerNumber(layer, field);
    // NEGATIVE ANGLE ENTRY (P0 regression): the shared parser reads a leading
    // `-` as the RELATIVE shorthand (`-10` = current − 10), which is right for
    // X/Y/W/H but made an exact negative rotation impossible to type — the
    // user asked for -45° and the layer turned to (angle − 45). Rotation is a
    // value the user READS and retypes, so a leading minus in this field is an
    // absolute negative number; `+N` still works as the relative increment.
    const angleAbsoluteNegative = field === "angle" && /^-\s*[0-9.]/.test(raw.trim());
    const parsed = angleAbsoluteNegative
      ? parseNumericInput(raw.trim().replace(/^-\s*/, "0-"), current, limits)
      : parseNumericInput(raw, current, limits);
    if (!parsed.ok) return false;

    if (field === "strokeWidth" || field === "fontSize") {
      this.updateLayer(layerId, { [field]: parsed.value } as Partial<CardLayer>);
      return true;
    }

    // Geometry fields go through the ONE box path, so a width typed into the
    // inspector re-scales a path's anchors exactly like a resize handle does.
    const box = {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      angle: layer.angle ?? 0,
    };
    if (field === "angle") {
      // EXACT ENTRY CONTRACT (P0 regression): inside the supported rotation
      // range the typed value is stored VERBATIM — negatives stay negative and
      // a value past a half turn (e.g. 200°) is no longer silently re-spelled
      // as -160°. Only an angle outside the server's ±360 clamp is reduced to
      // its VISUAL EQUIVALENT (400° → 40°), because that changes nothing on
      // the canvas while keeping the stored document valid.
      box.angle = Math.abs(parsed.value) > 360 ? wrapAngle(parsed.value) : parsed.value;
    }
    else if (field === "width") box.width = parsed.value;
    else if (field === "height") box.height = parsed.value;
    else if (field === "x") box.x = parsed.value;
    else if (field === "y") box.y = parsed.value;
    this.setLayerBox(layerId, box);
    return true;
  }

  /* ------------------------------ boolean ops ------------------------------ */

  /**
   * World-space subpaths of a path layer, with the layer's ROTATION baked in.
   *
   * Regions work in the layer's unrotated frame because they are a hit test on
   * the rendered geometry; a boolean needs the TRUE shape on the artboard, so
   * the rotation is applied here — otherwise intersecting two rotated paths
   * would use the wrong outlines.
   */
  private worldSubPaths(layer: PathLayer): SubPath[] {
    const subpaths = toWorldSubPaths(layer);
    const angle = layer.angle ?? 0;
    if (!angle) return subpaths;
    const origin = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
    const shift = (point: GeoPt): GeoPt => rotatePoint(point, origin, angle);
    return subpaths.map((sub) => ({
      start: shift(sub.start),
      closed: sub.closed,
      segments: sub.segments.map((segment) => ({
        p0: shift(segment.p0),
        c1: shift(segment.c1),
        c2: shift(segment.c2),
        p1: shift(segment.p1),
      })),
    }));
  }

  /** The path layers a boolean op may use, in document (z) order. */
  booleanOperands(): PathLayer[] {
    return this.selectedLayers().filter(
      (layer): layer is PathLayer => layer.kind === "path" && !layer.locked,
    );
  }

  /**
   * UNION / SUBTRACT / INTERSECT / EXCLUDE the selected path layers.
   *
   * ORDER IS MEANING for `subtract`: the BOTTOM-most selected path is the base
   * and every other one is cut out of it, which is the convention a designer
   * already has from Illustrator — and it is deterministic, unlike "whatever the
   * click order happened to be".
   *
   * The result inherits the BASE layer's appearance (fill, stroke, dash, opacity)
   * and its z position; the operands are replaced unless `keepOriginals` is set.
   * A result with a single loop stays a fully node-editable path; a result with
   * holes (or several pieces) is written as one multi-subpath `d`, because the
   * document stores exactly one subpath per path layer. Either way the geometry
   * is exact Bézier, so it stays a boolean operand itself.
   *
   * Returns the new layer's id, or null when the operation had nothing to keep
   * (e.g. intersecting two disjoint shapes) — in which case the document is left
   * untouched rather than silently emptied.
   */
  booleanSelection(op: BooleanOp, options: { keepOriginals?: boolean } = {}): string | null {
    const operands = this.booleanOperands();
    if (operands.length < 2) return null;

    const outcome = booleanContours(
      operands.map((layer) => ({ id: layer.id, subpaths: this.worldSubPaths(layer) })),
      op,
    );
    if (outcome.empty || outcome.anchorLoops.length === 0) return null;

    const base = operands[0];
    const id = `path-${Math.random().toString(36).slice(2, 9)}`;
    const pad = pathPadding(base.strokeWidth ?? 0);
    const shared = {
      kind: "path" as const,
      pathMode: "pen" as const,
      name: `نتیجهٔ ${BOOLEAN_OP_LABELS[op]}`,
      closed: true,
      fill: base.fill ?? base.stroke ?? base.color ?? "#0ea5e9",
      stroke: base.stroke ?? null,
      strokeWidth: base.strokeWidth ?? 0,
      strokeStyle: base.strokeStyle ?? ("solid" as const),
      strokeLinecap: base.strokeLinecap ?? ("round" as const),
      strokeLinejoin: base.strokeLinejoin ?? ("round" as const),
      strokeOpacity: base.strokeOpacity ?? 1,
      strokeDasharray: base.strokeDasharray ?? null,
      strokeDashoffset: base.strokeDashoffset ?? 0,
      opacity: base.opacity,
      angle: 0,
      locked: false,
      hidden: false,
      color: base.color ?? null,
      background: base.background ?? null,
    };

    let created: PathLayer;
    if (outcome.loops.length === 1) {
      created = normalizePathLayer<PathLayer>(
        {
          ...shared,
          id,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          points: outcome.anchorLoops[0],
          fillRule: "nonzero",
        },
        pad,
      );
    } else {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const loop of outcome.loops) {
        for (const point of loop) {
          if (point.x < minX) minX = point.x;
          if (point.y < minY) minY = point.y;
          if (point.x > maxX) maxX = point.x;
          if (point.y > maxY) maxY = point.y;
        }
      }
      const local = outcome.anchorLoops.map((loop) =>
        loop.map((anchor) => ({
          x: anchor.x - minX,
          y: anchor.y - minY,
          hIn: anchor.hIn ? { x: anchor.hIn.x - minX, y: anchor.hIn.y - minY } : null,
          hOut: anchor.hOut ? { x: anchor.hOut.x - minX, y: anchor.hOut.y - minY } : null,
        })),
      );
      created = {
        ...shared,
        id,
        x: minX - pad,
        y: minY - pad,
        width: Math.max(1, maxX - minX + pad * 2),
        height: Math.max(1, maxY - minY + pad * 2),
        points: [],
        rawD: local.map((loop) => pathD(loop, true)).join(" "),
        // The loops never overlap, so either rule is exact; even-odd is the one
        // that does not depend on the orientation surviving a round trip.
        fillRule: "evenodd",
      };
    }

    const ids = new Set(operands.map((layer) => layer.id));
    const originIndex = this.state.doc.layers.findIndex((layer) => layer.id === base.id);
    this.pushHistory();
    let layers: CardLayer[];
    if (options.keepOriginals) {
      layers = [...this.state.doc.layers, created];
    } else {
      layers = this.state.doc.layers.filter((layer) => !ids.has(layer.id));
      layers.splice(originIndex < 0 ? layers.length : Math.min(originIndex, layers.length), 0, created);
    }
    this.emit({
      doc: { ...this.state.doc, layers },
      selection: this.withSelection(id),
      selectionDomain: "object",
      selectedAnchor: null,
    });
    return id;
  }

  undo(): void {
    const previous = this.history.undo(this.currentJson());
    if (previous === null) return;
    const doc = JSON.parse(previous) as CardDocument;
    this.emit({
      doc,
      ...this.selectionAfterRestore(doc),
    });
  }

  redo(): void {
    const next = this.history.redo(this.currentJson());
    if (next === null) return;
    const doc = JSON.parse(next) as CardDocument;
    this.emit({
      doc,
      ...this.selectionAfterRestore(doc),
    });
  }

  /** Selection invariants after an undo/redo restore: keep ids that survive. */
  private selectionAfterRestore(doc: CardDocument): {
    selection: SelectionState;
    canUndo: boolean;
    canRedo: boolean;
    dirty: boolean;
  } {
    const surviving = this.state.selection.ids.filter((id) => doc.layers.some((l) => l.id === id));
    const primary = surviving.includes(this.state.selection.layerId ?? "")
      ? this.state.selection.layerId
      : surviving[surviving.length - 1] ?? null;
    return {
      selection: this.withSelection(primary, surviving),
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      // A history restore can land EXACTLY on the saved revision (undo back to
      // the last save): forcing `true` there lied to the user and re-saved an
      // identical document. Ask the saved revision instead — comparing the
      // RESTORED doc, because `this.state.doc` has not been committed yet.
      dirty: this.isDirtyAgainstSaved(JSON.stringify(doc)),
    };
  }

  /** Reset dirty flag after a successful save. */
  markSaved(): void {
    this.savedJson = this.currentJson();
    if (!this.state.dirty) return;
    this.emit({ dirty: false });
  }

  /** Replace the whole document (e.g. after switching materialized template). */
  replaceDocument(doc: CardDocument): void {
    this.history = new HistoryStack(50);
    this.history.commit(JSON.stringify(doc), { group: null });
    // A replacement is a brand-new revision: it is NOT the saved document.
    this.savedJson = null;
    this.emit({ doc, selection: this.withSelection(null), canUndo: false, canRedo: false, dirty: true });
  }

  /** Export a deep copy (for renderers / serialization). */
  snapshot(): { doc: CardDocument; selection: CardLayer | null } {
    return {
      doc: JSON.parse(JSON.stringify(this.state.doc)) as CardDocument,
      selection: this.getSelected(),
    };
  }
}
