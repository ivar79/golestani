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

import { useEffect, useMemo, useRef, useState } from "react";
import { Redo2, Undo2, Save, AlertCircle, CheckCircle2, Eye, Layers, Palette, Sliders, Wrench, Sparkles } from "lucide-react";
import type { Business } from "@/lib/businesses";
import { EditorEngine } from "../engine/EditorEngine";
import { createDocumentFromBusiness, type TemplateKey } from "../domain/factory";
import type { CardDocument } from "../domain/document";
import { describeEntitlementErrors, extractEntitlementErrors } from "@/lib/entitlements";
import { EditorStage } from "./EditorStage";
import { LayersPanel, InspectorPanel, Toolbox, BackgroundPanel, DrawingPanel } from "./EditorPanels";
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
  const [activeTab, setActiveTab] = useState<"templates" | "tools" | "inspector" | "layers" | "bg">("tools");
  const saveTimer = useRef<number | null>(null);

  // Automatically switch to inspector tab when a layer is selected. Adjusted
  // DURING RENDER (the React "adjust state when something changes" pattern)
  // instead of inside an effect, so the tab switch costs no extra render pass
  // and cascading renders cannot happen.
  const [lastSelected, setLastSelected] = useState<string | null>(state.selection.layerId);
  if (state.selection.layerId !== lastSelected) {
    setLastSelected(state.selection.layerId);
    if (state.selection.layerId) setActiveTab("inspector");
  }

  const persist = async () => {
    setSaveStatus({ kind: "saving" });
    try {
      // engine.snapshot() reads current state outside render (autosave runs
      // from effects/handlers only — never during render).
      await onSaved(engine.snapshot().doc);
      engine.markSaved();
      setSaveStatus({ kind: "saved" });
    } catch (error) {
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
  };

  // Publish the live document to the host page (vector export input). Runs on
  // committed state only — transient drag frames never leave the editor.
  useEffect(() => {
    onDocumentChange?.(state.doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.doc]);

  // Debounced autosave on FINAL state only (drag commits finish first).
  useEffect(() => {
    if (!state.dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persist(), 1500);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        void persist();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  return (
    <div className="space-y-4">
      {/* macOS MacBook Pro Studio Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/15 bg-gradient-to-r from-slate-900/90 via-[#0c1626]/95 to-slate-900/90 p-3 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          {/* macOS traffic light buttons */}
          <div className="flex items-center gap-1.5 pl-1">
            <span className="h-3 w-3 rounded-full bg-rose-500/80 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
            <span className="h-3 w-3 rounded-full bg-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/80 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
          </div>

          <div className="h-4 w-px bg-white/15 mx-0.5" />

          <button
            type="button"
            onClick={() => engine.undo()}
            disabled={!state.canUndo}
            title="واگرد (Ctrl+Z)"
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:text-white disabled:opacity-40 transition"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => engine.redo()}
            disabled={!state.canRedo}
            title="بازانجام (Ctrl+Y)"
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:text-white disabled:opacity-40 transition"
          >
            <Redo2 className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium mr-1">
            <span className="font-bold text-cyan-300">InkArt Studio</span>
            <span className="text-[10px] text-slate-500">|</span>
            <span className="text-slate-400">کارت ویزیت ۸.۵×۵.۵</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus.kind === "saved" && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> ذخیره شد
            </span>
          )}
          {saveStatus.kind === "saving" && <span className="text-[11px] text-slate-400">در حال ذخیره…</span>}
          {saveStatus.kind === "error" && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-300">
              <AlertCircle className="h-3.5 w-3.5" /> {saveStatus.message}
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
            onClick={() => void persist()}
            disabled={saveStatus.kind === "saving"}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:from-cyan-300 hover:to-sky-400 shadow-lg shadow-cyan-500/20 disabled:opacity-50 transition"
          >
            <Save className="h-3.5 w-3.5" />
            ذخیره طرح
          </button>
        </div>
      </div>

      {/* Stage + tabbed panels (panels hidden in preview mode) */}
      <div className="grid gap-5 lg:grid-cols-[1fr_370px]">
        <EditorStage engine={engine} doc={state.doc} exportRef={exportRef} preview={preview} />
        {preview ? null : (
          <div className="flex flex-col space-y-3">
            {/* 5 Tab Navigation */}
            <div className="grid grid-cols-5 gap-1 rounded-2xl border border-white/10 bg-[#0c1626]/90 p-1.5 shadow-xl backdrop-blur">
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
                onClick={() => setActiveTab("tools")}
                className={`flex flex-col items-center gap-1 rounded-xl py-2 px-0.5 text-[10px] font-bold transition ${
                  activeTab === "tools"
                    ? "bg-cyan-500/20 text-cyan-300 shadow-sm"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                <Wrench className="h-3.5 w-3.5" />
                <span>ابزارها</span>
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

              {activeTab === "tools" && (
                <>
                  <Toolbox engine={engine} onUploadImage={onUploadImage} />
                  <DrawingPanel engine={engine} />
                </>
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
        )}
      </div>
    </div>
  );
}

export default CardStudio;
