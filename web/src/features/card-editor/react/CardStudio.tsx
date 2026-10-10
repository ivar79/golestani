"use client";

/**
 * CardStudio — top-level surface of the layered card editor.
 *
 * - Undo/redo topbar with dirty indicator and explicit "ذخیره" (autosave
 *   is debounced 1.5s on FINAL state only — never during drags).
 * - Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z redo,
 *   Ctrl/Cmd+S save (tooltip contract; typing keys are never hijacked).
 * - Template materialization: when the user enters the editor while a
 *   template-based card exists, the template is materialized into layers
 *   via the factory (existing designs are preserved, never reset).
 * - Save PUTs design_json together with the scalar fields so the existing
 *   entitlement/grandfathering contract keeps governing template/theme/font.
 * - Image layers: `onUploadImage` persists the picked file through the
 *   card endpoint's existing multipart media flow and returns a system
 *   /storage/… path (blob URLs can never round-trip the whitelist).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Redo2, Undo2, Save, AlertCircle, CheckCircle2, Eye, RotateCcw, Layers, Palette, Sliders, Sparkles } from "lucide-react";
import type { Business } from "@/lib/businesses";
import { EditorEngine } from "../engine/EditorEngine";
import { createDocumentFromBusiness, type TemplateKey } from "../domain/factory";
import type { CardDocument } from "../domain/document";
import { SaveQueue } from "../domain/saveQueue";
import { auditDocument, budgetForTier } from "../domain/saveLimits";
import { limitOf } from "@/lib/entitlements";
import { describeSaveFailure, saveFailureDiagnostics } from "../domain/saveFailure";
import { EditorStage } from "./EditorStage";
import { useEntitlements } from "@/components/cards/FeatureGate";
import { LayersPanel, InspectorPanel, Toolbox, BackgroundPanel } from "./EditorPanels";
import { TemplatesPanel } from "./TemplatesPanel";
import { useCardEditor } from "./useCardEditor";

type SaveStatus = { kind: "idle" | "saving" | "saved" | "error"; message?: string };

export function CardStudio({
  business,
  template,
  theme,
  fontFamily,
  designJson,
  onSaved,
  onUploadImage,
  onDocumentChange,
  exportRef,
}: {
  business: Business;
  template: TemplateKey;
  theme: string;
  fontFamily: string;
  designJson: CardDocument | null;
  onSaved: (designJson: CardDocument) => void | Promise<void>;
  /** Persist a picked image via the card media flow; resolves to a system /storage/… path. */
  onUploadImage?: (file: File) => Promise<string>;
  /**
   * The live document, published on every committed change. The vector exports
   * (SVG/PDF) are serialized from the DOCUMENT, not from the DOM, so the host
   * page needs the current one — including edits not yet autosaved.
   */
  onDocumentChange?: (doc: CardDocument) => void;
  /** Forwarded to the artboard element so the host page can export it (html-to-image). */
  exportRef?: React.Ref<HTMLDivElement>;
}) {
  const engine = useMemo(() => {
    const initial = designJson ?? createDocumentFromBusiness(business, { template, theme, fontFamily });
    return new EditorEngine(initial);
    // Rebuild only when the business changes — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

  const state = useCardEditor(engine);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [preview, setPreview] = useState(false);
  const [leftTab, setLeftTab] = useState<"layers" | "templates">("layers");
  const [rightTab, setRightTab] = useState<"inspector" | "bg">("inspector");
  const saveTimer = useRef<number | null>(null);
  // Saves are SERIALIZED: at most one request on the wire, the newest document
  // always queued next — so an out-of-order response can never write an older
  // revision over newer edits.
  const saveQueue = useMemo(() => new SaveQueue(), []);

  // Entitlement context (UX mirror — the server re-checks every save).
  const entitlements = useEntitlements();
  const maxLayersEntitlement = limitOf(entitlements.capabilities, "max_layers");

  // Inject the tier policy into the engine: an UNLIMITED tier (max_layers
  // === null — FeatureGate's canonical "no real cap" signal, never a plan
  // name) keeps stroke geometry byte-for-byte; capped tiers get the gentle
  // optimize ladder. Re-applied whenever the payload changes (snapshot
  // refresh, plan change) — a no-op when the value is identical.
  useEffect(() => {
    engine.setSavePolicy(maxLayersEntitlement);
  }, [engine, maxLayersEntitlement]);

  // Automatically switch to inspector tab when a layer is selected. Adjusted
  // DURING RENDER (the React "adjust state when something changes" pattern)
  // instead of inside an effect, so the tab switch costs no extra render pass
  // and cascading renders cannot happen.
  const [lastSelected, setLastSelected] = useState<string | null>(state.selection.layerId);
  if (state.selection.layerId !== lastSelected) {
    setLastSelected(state.selection.layerId);
    if (state.selection.layerId) setRightTab("inspector");
  }

  /**
   * Enqueue a save through the serialized queue.
   *
   * Truthfulness contract (the header never lies about persistence):
   *   - a result from a SUPERSEDED save never touches save state;
   *   - the document is marked clean ONLY when nothing changed during the
   *     request — an edit that landed mid-flight keeps the dirty flag so the
   *     autosave timer re-fires instead of a false "ذخیره شد";
   *   - on failure the local document is untouched (no rollback) and the user
   *     gets a Retry button — the engine state is always the latest work.
   */
  const persist = useCallback(() => {
    saveQueue.save(async (guard) => {
      // engine.snapshot() reads current state outside render (autosave runs
      // from effects/handlers only — never during render). Snapshotting at RUN
      // time means a queued save always carries the newest document.
      const payload = engine.snapshot().doc;

      // Pre-flight audit — the honest gate. A document the server validator
      // would refuse is NEVER put on the wire: the user gets a specific,
      // actionable notice instead of a bare 422.
      const budget = budgetForTier(maxLayersEntitlement);
      const audit = auditDocument(payload, budget);
      if (!audit.ok) {
        setSaveStatus({ kind: "error", message: audit.violations.join(" ") });
        return;
      }

      const payloadJson = JSON.stringify(payload);
      setSaveStatus({ kind: "saving" });
      try {
        await onSaved(payload);
        // A newer save started while this one was on the wire — its result owns
        // the header, a stale completion must not flip the status.
        if (!guard.isCurrent()) return;
        // Only mark clean when the document has not moved since the snapshot.
        if (JSON.stringify(engine.snapshot().doc) === payloadJson) {
          engine.markSaved();
          setSaveStatus({ kind: "saved" });
        } else {
          // Edits landed mid-flight: the dirty flag stays on, the autosave
          // timer re-fires, and the header shows the truthful amber hint.
          setSaveStatus({ kind: "idle" });
        }
      } catch (error) {
        if (!guard.isCurrent()) return;
        // The server is the entitlement authority: when it refuses a save, say
        // WHICH capability refused it instead of a generic failure. A locked
        // control must never look like a transient error, and a timeout never
        // claims success or failure outright (the outcome is ambiguous). That
        // whole contract lives in domain/saveFailure.ts so it is unit-tested
        // without mounting the editor.
        setSaveStatus({ kind: "error", message: describeSaveFailure(error) });
        // Dev-only, field-selected diagnostics (never the error object: its
        // axios config holds the Authorization header).
        if (process.env.NODE_ENV === "development") {
          console.error("[CardStudio][save]", saveFailureDiagnostics(error));
        }
      }
    });
  }, [engine, onSaved, saveQueue, maxLayersEntitlement]);

  // Always-current reference (the keyboard/autosave effects bind once).
  // The write lives in an effect — the react-hooks rule forbids ref writes
  // during render, and effect order guarantees persistRef is fresh before
  // the autosave effect below schedules anything.
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  // Publish the live document to the host page (vector export input). Runs on
  // committed state only — transient drag frames never leave the editor.
  useEffect(() => {
    onDocumentChange?.(state.doc);
  }, [state.doc, onDocumentChange]);

  // Debounced autosave on FINAL state only (drag commits finish first).
  useEffect(() => {
    if (!state.dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persistRef.current(), 1500);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state.dirty, state.doc]);

  // Warn on exit with unsaved changes (existing pattern in card-maker).
  useEffect(() => {
    if (!state.dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.dirty]);

  // Keyboard shortcuts (topbar tooltip contract). Guard: no modifier
  // conflicts with plain typing; Ctrl/Cmd+S is browser-default-prevented.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) engine.redo();
        else engine.undo();
      } else if (key === "y") {
        e.preventDefault();
        engine.redo();
      } else if (key === "s") {
        e.preventDefault();
        void persistRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [engine]);

  return (
    <div dir="rtl" className="ik-studio flex min-w-0 flex-col gap-2 text-slate-100">
      <header className="sticky top-0 z-40 flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-[#15171c]/95 px-3 py-2 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-cyan-300/20 bg-cyan-300/10 text-[11px] font-black text-cyan-200">IK</span>
          <span className="max-w-44 truncate text-sm font-semibold text-slate-100">{business.name}</span>
          <span className="hidden text-xs text-slate-500 sm:inline">· کارت</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => engine.undo()} disabled={!state.canUndo} title="واگرد · Ctrl+Z" aria-label="واگرد" className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] text-slate-300 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-30"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={() => engine.redo()} disabled={!state.canRedo} title="بازانجام · Ctrl+Y" aria-label="بازانجام" className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] text-slate-300 transition hover:bg-white/[0.07] hover:text-white disabled:opacity-30"><Redo2 className="h-4 w-4" /></button>
          <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
          {saveStatus.kind === "saved" && <span className="flex items-center gap-1 text-[11px] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> ذخیره شد</span>}
          {saveStatus.kind === "saving" && <span className="flex items-center gap-1 text-[11px] text-slate-400"><RotateCcw className="h-3.5 w-3.5 animate-spin" /> در حال ذخیره</span>}
          {saveStatus.kind === "error" && <span className="flex items-center gap-1.5 text-[11px] text-rose-300"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="max-w-44 truncate">{saveStatus.message}</span><button type="button" onClick={() => void persistRef.current()} title="تلاش دوباره برای ذخیره" aria-label="تلاش دوباره برای ذخیره" className="flex h-7 w-7 items-center justify-center rounded-md border border-rose-400/30 hover:bg-rose-500/10"><RotateCcw className="h-3.5 w-3.5" /></button></span>}
          {state.dirty && saveStatus.kind === "idle" && <span className="hidden text-[11px] text-amber-300 sm:inline">ذخیره‌نشده</span>}
          <button type="button" onClick={() => setPreview((p) => !p)} title={preview ? "خروج از پیش‌نمایش" : "پیش‌نمایش"} aria-label={preview ? "خروج از پیش‌نمایش" : "پیش‌نمایش"} className={preview ? "flex h-8 items-center gap-1.5 rounded-md border border-cyan-300/40 bg-cyan-300/10 px-2.5 text-xs text-cyan-100" : "flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs text-slate-300 transition hover:bg-white/[0.06] hover:text-white"}>
            <Eye className="h-3.5 w-3.5" /><span className="hidden sm:inline">{preview ? "ویرایش" : "پیش‌نمایش"}</span>
          </button>
          <button type="button" onClick={() => void persistRef.current()} disabled={!state.dirty && saveStatus.kind !== "error"} title="ذخیره · Ctrl+S" className="flex h-8 items-center gap-1.5 rounded-md bg-cyan-300 px-3 text-xs font-bold text-[#101318] transition hover:bg-cyan-200 disabled:opacity-35"><Save className="h-3.5 w-3.5" /><span>ذخیره</span></button>
        </div>
      </header>
      <div dir="ltr" className="relative grid min-w-0 grid-cols-1 gap-2 md:h-[calc(100vh-8.75rem)] md:min-h-[560px] md:grid-cols-[236px_minmax(0,1fr)_292px] xl:grid-cols-[258px_minmax(0,1fr)_316px]">
        {!preview && <aside dir="rtl" className="order-2 flex min-h-[230px] min-w-0 flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#17191f] md:order-1 md:h-full">
          <div className="flex items-center gap-1 border-b border-white/[0.08] p-2">
            <button type="button" onClick={() => setLeftTab("layers")} aria-pressed={leftTab === "layers"} className={leftTab === "layers" ? "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-white/[0.09] px-2 text-xs text-white" : "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-slate-400 transition hover:text-slate-200"}><Layers className="h-3.5 w-3.5" /> لایه‌ها</button>
            <button type="button" onClick={() => setLeftTab("templates")} aria-pressed={leftTab === "templates"} className={leftTab === "templates" ? "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-white/[0.09] px-2 text-xs text-white" : "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-slate-400 transition hover:text-slate-200"}><Sparkles className="h-3.5 w-3.5" /> قالب‌ها</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">{leftTab === "layers" ? <LayersPanel engine={engine} doc={state.doc} /> : <TemplatesPanel engine={engine} business={business} />}</div>
        </aside>}
        <section className="order-1 flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#111318] md:order-2 md:h-full">
          {preview ? <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3"><EditorStage engine={engine} doc={state.doc} exportRef={exportRef} preview={preview} onUploadImage={onUploadImage} /></div> : <div dir="ltr" className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[48px_minmax(0,1fr)]"><Toolbox engine={engine} onUploadImage={onUploadImage} qrPayload={business.slug} /><div className="min-h-[360px] min-w-0 overflow-hidden md:min-h-0"><EditorStage engine={engine} doc={state.doc} exportRef={exportRef} preview={preview} onUploadImage={onUploadImage} /></div></div>}
        </section>
        {!preview && <aside dir="rtl" className="order-3 flex min-h-[280px] min-w-0 flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#17191f] md:h-full">
          <div className="flex items-center border-b border-white/[0.08] p-2">
            <button type="button" onClick={() => setRightTab("inspector")} aria-pressed={rightTab === "inspector"} className={rightTab === "inspector" ? "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-white/[0.09] px-2 text-xs text-white" : "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-slate-400 transition hover:text-slate-200"}><Sliders className="h-3.5 w-3.5" /> ویژگی‌ها{state.selection.layerId && <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />}</button>
            <button type="button" onClick={() => setRightTab("bg")} aria-pressed={rightTab === "bg"} className={rightTab === "bg" ? "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-white/[0.09] px-2 text-xs text-white" : "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-slate-400 transition hover:text-slate-200"}><Palette className="h-3.5 w-3.5" /> پس‌زمینه</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            {rightTab === "inspector" && (state.selection.layerId ? <InspectorPanel engine={engine} onUploadImage={onUploadImage} businessSlug={business.slug} /> : <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-white/10 px-4 py-6 text-center text-slate-400"><Sliders className="h-6 w-6 text-slate-500" /><p className="text-xs font-medium text-slate-200">ویژگی‌ها</p><p className="text-[11px] leading-5">برای مشاهده تنظیمات، یک لایه را انتخاب کنید.</p></div>)}
            {rightTab === "bg" && <BackgroundPanel engine={engine} />}
          </div>
        </aside>}
      </div>
    </div>
  );
}

export default CardStudio;
