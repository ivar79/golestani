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
import { describeEntitlementErrors, extractEntitlementErrors, limitOf } from "@/lib/entitlements";
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
  const [activeTab, setActiveTab] = useState<"templates" | "inspector" | "layers" | "bg">("templates");
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
    if (state.selection.layerId) setActiveTab("inspector");
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
        // control must never look like a transient error. A 422 is a structural
        // rejection (the document does not satisfy today's validator); its body
        // names the failing rule for the developer, the user gets a calm hint.
        const status = (error as { response?: { status?: number } })?.response?.status;
        setSaveStatus({
          kind: "error",
          message:
            describeEntitlementErrors(extractEntitlementErrors(error)) ??
            (status === 422
              ? "سند کارت با ساختار مجاز سرور همخوانی نیست — بخشی از طرح ذخیره نشد."
              : error instanceof Error
                ? error.message
                : "ذخیره‌سازی ناموفق بود."),
        });
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
    <div className="space-y-3">
      {/* Studio header: compact (56px), information-dense, no decoration.
          Save status comes from the REAL persistence state (SaveQueue + dirty flag). */}
      <div className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/[0.08] bg-[#0a1019]/90 p-2.5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => engine.undo()}
            disabled={!state.canUndo}
            title="واگرد (Ctrl+Z)"
            aria-label="واگرد"
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 hover:text-white disabled:opacity-40 transition"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => engine.redo()}
            disabled={!state.canRedo}
            title="بازانجام (Ctrl+Y)"
            aria-label="بازانجام"
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 hover:text-white disabled:opacity-40 transition"
          >
            <Redo2 className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium mr-1">
            <span className="font-semibold tracking-tight text-white">InkArt Studio</span>
            <span className="h-1 w-1 rounded-full bg-emerald-400/80" />
            <span className="text-[10px] text-slate-500">Card Designer</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus.kind === "saved" && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> ذخیره شد
            </span>
          )}
          {saveStatus.kind === "saving" && (
            <span className="flex items-center gap-1 text-[11px] text-slate-400">
              <RotateCcw className="h-3.5 w-3.5 animate-spin" /> در حال ذخیره…
            </span>
          )}
          {saveStatus.kind === "error" && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {saveStatus.message}
              <button
                type="button"
                onClick={() => void persistRef.current()}
                title="تلاش دوباره برای ذخیره طرح"
                className="flex items-center gap-1 rounded-lg border border-rose-400/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-200 hover:bg-rose-500/20 transition"
              >
                <RotateCcw className="h-3 w-3" /> تلاش دوباره
              </button>
            </span>
          )}
          {state.dirty && saveStatus.kind === "idle" && <span className="text-[11px] text-amber-300">تغییرات ذخیره‌نشده…</span>}
          <button
            type="button"
            onClick={() => setPreview((p) => !p)}
            title={preview ? "خروج از پیش‌نمایش" : "پیش‌نمایش کارت"}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
              preview ? "border-cyan-400 bg-cyan-500/20 text-cyan-200" : "border-white/10 bg-white/5 text-slate-300 hover:text-white"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            {preview ? "ویرایش" : "پیش‌نمایش"}
          </button>
          <button
            type="button"
            onClick={() => void persistRef.current()}
            disabled={!state.dirty && saveStatus.kind !== "error"}
            title="ذخیره طرح (Ctrl+S)"
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:from-cyan-300 hover:to-sky-400 shadow-lg shadow-cyan-500/20 disabled:opacity-50 transition"
          >
            <Save className="h-3.5 w-3.5" />
            ذخیره طرح
          </button>
        </div>
      </div>

      {/* Studio workspace: vertical tool rail (right, RTL-first) + canvas + inspector.
          The rail replaces the old horizontal "ابزارها" tab — tools stay one click
          away while the inspector keeps its full height. min-w-0 lets the stage
          shrink instead of overflowing at narrow widths. */}
      <div className="relative flex items-stretch justify-between gap-3 rounded-[26px] border border-white/[0.06] bg-[radial-gradient(circle_at_50%_18%,rgba(28,45,65,0.22),transparent_48%),#070c14] p-2 shadow-[0_30px_90px_rgba(0,0,0,0.34)]">
        <div className="min-w-0 flex-1">
          <EditorStage engine={engine} doc={state.doc} exportRef={exportRef} preview={preview} />
        </div>
        {preview ? null : (
          <div className="flex shrink-0 gap-3">
            {/* Vertical tool rail — the drag/gate logic lives in Toolbox itself. */}
            <Toolbox engine={engine} onUploadImage={onUploadImage} />

            {/* Tabbed panels (templates/inspector/layers/background) */}
            <div className="flex w-[300px] flex-col space-y-2.5">
              <div className="grid grid-cols-4 gap-1 rounded-[18px] border border-white/[0.08] bg-[#0b121d]/80 p-1 shadow-[0_16px_40px_rgba(0,0,0,0.25)] backdrop-blur-2xl">
                <button
                  type="button"
                  onClick={() => setActiveTab("templates")}
                  className={`flex flex-col items-center gap-1 rounded-xl py-2 px-0.5 text-[10px] font-bold transition ${
                    activeTab === "templates"
                      ? "bg-amber-500/25 text-amber-300 shadow-sm ring-1 ring-amber-400/40"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span>قالب‌ها</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("inspector")}
                  className={`relative flex flex-col items-center gap-1 rounded-xl py-2 px-0.5 text-[10px] font-bold transition ${
                    activeTab === "inspector"
                      ? "bg-cyan-500/20 text-cyan-300 shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Sliders className="h-3.5 w-3.5" />
                  <span>ویژگی‌ها</span>
                  {state.selection.layerId && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("layers")}
                  className={`flex flex-col items-center gap-1 rounded-xl py-2 px-0.5 text-[10px] font-bold transition ${
                    activeTab === "layers"
                      ? "bg-cyan-500/20 text-cyan-300 shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>لایه‌ها ({state.doc.layers.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("bg")}
                  className={`flex flex-col items-center gap-1 rounded-xl py-2 px-0.5 text-[10px] font-bold transition ${
                    activeTab === "bg"
                      ? "bg-cyan-500/20 text-cyan-300 shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Palette className="h-3.5 w-3.5" />
                  <span>پس‌زمینه</span>
                </button>
              </div>

              {/* Active Tab Content */}
              <div className="space-y-4">
                {activeTab === "templates" && (
                  <TemplatesPanel engine={engine} business={business} />
                )}

                {activeTab === "inspector" && (
                  <>
                    {state.selection.layerId ? (
                      <InspectorPanel engine={engine} onUploadImage={onUploadImage} />
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-[#0c1626]/80 p-6 text-center text-slate-400">
                        <Sliders className="mx-auto mb-2 h-8 w-8 text-cyan-400/60" />
                        <p className="text-xs font-semibold text-white">لایه‌ای انتخاب نشده است</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          برای ویرایش ویژگی‌ها، یک المان را روی بوم یا از لیست لایه‌ها انتخاب کنید.
                        </p>
                      </div>
                    )}
                  </>
                )}

                {activeTab === "layers" && (
                  <LayersPanel engine={engine} doc={state.doc} />
                )}

                {activeTab === "bg" && (
                  <BackgroundPanel engine={engine} />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CardStudio;
