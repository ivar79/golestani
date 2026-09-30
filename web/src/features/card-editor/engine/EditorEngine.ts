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
  ShapeKind,
  StrokeLineCap,
  StrokeLineJoin,
  StrokeStyleKind,
} from "../domain/document";
import { ARTBOARD } from "../domain/document";
import { HistoryStack } from "../domain/history";
import {
  autoSmoothPoints,
  cornerAnchorAt,
  createFreehandPath,
  insertAnchor,
  moveAnchor,
  moveHandle,
  normalizePathLayer,
  pathPadding,
  removeAnchor,
  smoothAnchorAt,
  straightenAllPoints,
  toggleAnchorAt,
} from "../domain/path";
import { brushStrokeLayerGeometry } from "../domain/freehand";
import { clampStrokeWidth } from "../domain/stroke";
import {
  budgetForTier,
  fitRawDToBudget,
  MAX_PATH_POINTS,
  MAX_RAW_D_STRUCTURAL,
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

/** Normalize any angle into (−180, 180] so stored values always satisfy the validator's ±360 clamp. */
export function wrapAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a === -0 ? 0 : a;
}

/** The active tool. `draw` is freehand, `pen` is the Bezier pen. */
export type EditorTool = "select" | "draw" | "pen";

/** Which anchor (and therefore which path layer) the point editor is editing. */
export type AnchorSelection = { layerId: string; index: number };

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
  /** Live pointer samples for the freehand tool (transient, never persisted). */
  workingStroke: { x: number; y: number }[] | null;
  /** Live anchors for the Pen tool (transient, never persisted). */
  penDraft: PathPoint[] | null;
  /** Curvature tool mode: curvature (auto-smooth natural spline) vs corner (sharp polygons). */
  penMode: "curvature" | "corner";
  /**
   * The anchor/handle under edit on a COMMITTED path layer. View state, like
   * `selection`: it lives in the engine but never in undo history.
   */
  selectedAnchor: AnchorSelection | null;
  /**
   * The path layer whose POINTS are being edited (double-click a curve, or the
   * "ویرایش نقاط" button). View state — never in history. Only one path can be
   * point-edited at a time, which is why this is an id and not a flag.
   */
  editingPathId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
};

export class EditorEngine {
  private history = new HistoryStack(50);
  private listeners = new Set<() => void>();
  /** Tier-aware save budget (defaults to the CAPPED policy; host injects the real one). */
  private savePolicy: SavePolicy = { budget: budgetForTier(60), unlimited: false };
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

  /** The rawD budget a NEW stroke should target. */
  private get strokeBudget(): number {
    return this.savePolicy.unlimited ? MAX_RAW_D_STRUCTURAL : this.savePolicy.budget.rawDBytes;
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
      workingStroke: null,
      penDraft: null,
      penMode: "curvature",
      selectedAnchor: null,
      editingPathId: null,
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

  /* ------------------------------ selection ------------------------------ */

  /**
   * Select a layer. Shift-click extends/contracts the multi-select set;
   * a plain click sets a single selection. Null clears everything.
   */
  select(layerId: string | null, additive = false): void {
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
   * `brushStrokeLayerGeometry` re-origins it into a tight layer box, so the
   * stroke is a first-class layer — selectable, movable, resizable — and the
   * committed `rawD` is the exact ribbon the live preview drew. Rendering goes
   * through `resolveLayerPathD` (rawD), so the canvas, autosave, reload and
   * export all show the same stroke.
   */
  addBrushLayer(outline: number[][], color = "#0ea5e9"): string | null {
    const geometry = brushStrokeLayerGeometry(outline);
    if (!geometry) return null;
    // Tier-aware budget fit: unlimited tiers keep the stroke byte-for-byte
    // (their budget IS the structural cap); capped tiers get the lossless
    // optimize ladder first. Either way the geometry is never truncated.
    const { d } = fitRawDToBudget(geometry.d, this.strokeBudget);
    const x = geometry.x;
    const y = geometry.y;
    const width = geometry.width;
    const height = geometry.height;
    const id = `path-${Math.random().toString(36).slice(2, 9)}`;
    const layer: PathLayer = {
      id,
      kind: "path",
      name: "قلم آزاد",
      points: [],
      rawD: d,
      closed: true,
      fill: color,
      stroke: null,
      strokeWidth: 0,
      x,
      y,
      width,
      height,
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
    const layer = createCurvedLineLayer(100, 280, 500, 80, curvature);
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
    const angle = (target.angle ?? 0) * (Math.PI / 180);
    // Layer frame corners in artboard space (about the layer center).
    const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Pointer → layer-local (unrotated) coords, centered at the layer center.
    const dx = pointer.x - center.x;
    const dy = pointer.y - center.y;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;

    const halfW = target.width / 2;
    const halfH = target.height / 2;

    // New local extents: clamp the dragged edge to a readable minimum, keeping
    // the opposite edge fixed (e.g. dragging E leaves W untouched).
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
    // New local center relative to the anchor, then un-rotate to artboard space.
    const localCenterX = (newLeft + newRight) / 2;
    const localCenterY = (newTop + newBottom) / 2;
    const worldCenterX = center.x + localCenterX * cos - localCenterY * sin;
    const worldCenterY = center.y + localCenterX * sin + localCenterY * cos;

    this.transientPatch(layerId, {
      width: newW,
      height: newH,
      x: worldCenterX - newW / 2,
      y: worldCenterY - newH / 2,
    } as Partial<CardLayer>);
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
      this.transientPatch(layer.id, {
        x: anchorX + (layer.x - anchorX) * scaleX,
        y: anchorY + (layer.y - anchorY) * scaleY,
        width: Math.max(MIN, layer.width * scaleX),
        height: Math.max(MIN, layer.height * scaleY),
      } as Partial<CardLayer>);
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
  setLayerBox(layerId: string, box: { x: number; y: number; width: number; height: number; angle?: number }): void {
    const patch: Partial<CardLayer> = { ...box } as Partial<CardLayer>;
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
    this.emit({ canUndo: this.history.canUndo, canRedo: this.history.canRedo, dirty: true });
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
    // Anchor cap (validator MAX_PATH_POINTS): re-simplify the SAME raw samples
    // with a coarser epsilon instead of truncating — the stroke keeps its shape.
    let points = createFreehandPath(working);
    for (const epsilon of [5, 10, 20, 40, 80]) {
      if (points.length <= MAX_PATH_POINTS) break;
      points = createFreehandPath(working, { simplifyEpsilon: epsilon });
    }
    // The layer box is DERIVED from the geometry (never hand-computed), so a
    // freshly drawn stroke and a later-edited one always agree on the box.
    const newLayer = normalizePathLayer<PathLayer>(
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
        closed: false,
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
      this.emit({ penDraft: null });
      return null;
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
      selectedAnchor: { layerId: id, index: 0 },
    });
    return id;
  }

  cancelPen(): void {
    this.emit({ penDraft: null });
  }

  /* ---------------------------- path point editor ---------------------------- */

  /** Focus an anchor (view state — the point editor overlay reads it). */
  selectAnchor(selection: AnchorSelection | null): void {
    this.emit({ selectedAnchor: selection });
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
      this.emit({ editingPathId: null, selectedAnchor: null });
      return;
    }
    const layer = this.editablePath(layerId);
    if (!layer) return;
    this.emit({ editingPathId: layerId, selectedAnchor: { layerId, index: 0 } });
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
    this.transientPatch(layerId, { points: moveAnchor(layer.points, index, position) } as Partial<CardLayer>);
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
  autoSmoothLayer(layerId: string): void {
    const layer = this.editablePath(layerId);
    if (!layer || layer.points.length < 2) return;
    const smoothed = autoSmoothPoints(layer.points, layer.closed);
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
    const normalized = normalizePathLayer({ ...layer, points }, pathPadding(layer.strokeWidth));
    this.updateLayer(layer.id, {
      points: normalized.points,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
    } as Partial<CardLayer>);
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
      dirty: true,
    };
  }

  /** Reset dirty flag after a successful save. */
  markSaved(): void {
    if (!this.state.dirty) return;
    this.emit({ dirty: false });
  }

  /** Replace the whole document (e.g. after switching materialized template). */
  replaceDocument(doc: CardDocument): void {
    this.history = new HistoryStack(50);
    this.history.commit(JSON.stringify(doc), { group: null });
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
