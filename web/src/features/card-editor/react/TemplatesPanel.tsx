"use client";

/**
 * TemplatesPanel — the data-driven template gallery.
 *
 * GATING CONTRACT: entitlement decisions come ONLY from capabilities
 * (`allowedValues(caps, "card_templates")` / `isEnabled(caps,
 * "custom_templates")`). Plan names are NEVER inspected — a plan display
 * name can change any time without touching this file.
 *
 * APPLY CONTRACT: every apply goes through the server
 * (`applyTemplate()` → clone + NEW layer ids + placeholder fill), then the
 * document is installed via `engine.applyTemplateDoc` as ONE history
 * record. Applying over a non-empty card asks for confirmation first.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Lock, Check, User, Upload, Trash2 } from "lucide-react";
import Link from "next/link";
import type { EditorEngine } from "../engine/EditorEngine";
import { applyTemplate, fetchGallery, type GalleryTemplate } from "../domain/templateClient";
import type { CardLayer } from "../domain/document";
import type { Business } from "@/lib/businesses";
import { useEntitlements, PremiumBadge } from "@/components/cards/FeatureGate";
import { allowedValues, isEnabled } from "@/lib/entitlements";

function authHeadersJson(): Record<string, string> {
  if (typeof window === "undefined") return {};
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${window.localStorage.getItem("golestani_token") ?? ""}`,
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  all: "همه",
  persian: "👑 سنتی و VIP",
  business: "کسب‌وکار",
  modern: "مدرن",
  general: "عمومی",
  personal: "قالب‌های من",
};

export function TemplatesPanel({
  engine,
  business,
  onApplied,
}: {
  engine: EditorEngine;
  business: Business;
  /** Optional hook for the host (e.g. mark dirty after apply). */
  onApplied?: () => void;
}) {
  const entitlements = useEntitlements();
  const allowedTemplateIds = useMemo(
    () => new Set(allowedValues(entitlements.capabilities, "card_templates")),
    [entitlements.capabilities],
  );
  const canPersonal = isEnabled(entitlements.capabilities, "custom_templates");

  const [gallery, setGallery] = useState<GalleryTemplate[]>([]);
  const [personal, setPersonal] = useState<GalleryTemplate[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [designerStatus, setDesignerStatus] = useState<string | null>(null);

  const reloadPersonal = useCallback(async () => {
    if (!canPersonal) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api"}/my/templates`, {
        headers: authHeadersJson(),
        cache: "no-store",
      });
      if (res.ok) setPersonal(((await res.json()) as { templates?: GalleryTemplate[] }).templates ?? []);
    } catch {
      /* personal list is optional UX */
    }
  }, [canPersonal]);

  // Load the shared gallery + my private templates (personal section only
  // rendered when the capability exists — the endpoint would 403 anyway).
  // State updates happen in promise callbacks, never synchronously.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchGallery(business.id)
        .then((templates) => {
          if (!cancelled) setGallery(templates);
        })
        .catch(() => {
          if (!cancelled) setError("بارگذاری گالری قالب‌ها ناموفق بود.");
        });
      void reloadPersonal();
      if (canPersonal) {
        fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api"}/designer/program/status`, {
          headers: authHeadersJson(),
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((b: { designer_status?: string } | null) => {
            if (!cancelled) setDesignerStatus(b?.designer_status ?? null);
          })
          .catch(() => undefined);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [business.id, canPersonal, reloadPersonal]);

  const all = useMemo(() => [...gallery, ...personal], [gallery, personal]);
  const categories = useMemo(() => {
    const set = new Set<string>(["all"]);
    for (const t of all) set.add(t.source === "personal" ? "personal" : t.category);
    return [...set];
  }, [all]);

  const filtered = all.filter((t) => {
    if (activeCategory === "all") return true;
    if (activeCategory === "personal") return t.source === "personal";
    return t.category === activeCategory;
  });

  /** UX mirror of the server gate — apply still re-authorizes server-side. */
  const entitled = (t: GalleryTemplate): boolean =>
    t.source === "personal" ? canPersonal : t.entitled || allowedTemplateIds.has(t.id);

  const applyTemplateToCard = async (template: GalleryTemplate) => {
    if (!entitled(template)) return;
    const state = engine.snapshot();
    const hasContent = state.doc.layers.some((l: CardLayer) => !l.locked && !l.hidden);
    if (hasContent && !window.confirm("اعمال قالب، لایه‌های فعلی کارت را جایگزین می‌کند. ادامه می‌دهید؟")) {
      return;
    }

    setBusyId(template.id);
    setError(null);
    try {
      const res = await applyTemplate({
        source: template.source,
        id: template.id,
        businessId: business.id,
      });
      // ONE history record; the server already regenerated every layer id.
      engine.applyTemplateDoc(res.document.background, res.document.layers);
      setAppliedId(template.id);
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "اعمال قالب ناموفق بود.");
    } finally {
      setBusyId(null);
    }
  };

  /** Save the CURRENT document as one of MY private templates. */
  const saveAsPersonal = async () => {
    const name = window.prompt("نام قالب شخصی:");
    if (!name?.trim()) return;
    setBusyId("__save_personal");
    setError(null);
    try {
      const doc = engine.snapshot().doc;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api"}/my/templates`, {
        method: "POST",
        headers: authHeadersJson(),
        body: JSON.stringify({ business_id: business.id, name_fa: name.trim(), design_json: doc }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { message?: string }).message ?? "ذخیره قالب ناموفق بود.");
      await reloadPersonal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ذخیره قالب ناموفق بود.");
    } finally {
      setBusyId(null);
    }
  };

  /** Request to join the designer program (status → pending). */
  const requestDesignerProgram = async () => {
    setBusyId("__program");
    setError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api"}/designer/program/request`, {
        method: "POST",
        headers: authHeadersJson(),
        body: JSON.stringify({}),
      });
      const body = (await res.json()) as { designer_status?: string; message?: string };
      if (!res.ok) throw new Error(body.message ?? "درخواست ناموفق بود.");
      setDesignerStatus(body.designer_status ?? "pending");
    } catch (e) {
      setError(e instanceof Error ? e.message : "درخواست ناموفق بود.");
    } finally {
      setBusyId(null);
    }
  };

  /** Delete one of MY private templates (soft; assets survive). */
  const deletePersonal = async (template: GalleryTemplate) => {
    if (!window.confirm(`حذف قالب «${template.name_fa}»؟`)) return;
    setBusyId(template.id);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "/api"}/my/templates/${template.id}`, {
        method: "DELETE",
        headers: authHeadersJson(),
      });
      await reloadPersonal();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0c1626]/80 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <span>قالب‌های آماده</span>
          </h3>
          <p className="text-[10px] text-slate-400 mt-0.5">
            یک قالب را انتخاب کنید و آن را متناسب با هویت کسب‌وکار ویرایش کنید.
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">{error}</p>
      )}

      {/* Dynamic category tabs */}
      <div className="grid gap-1 rounded-xl bg-black/30 p-1 text-[11px] font-bold" style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}>
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActiveCategory(category)}
            className={`rounded-lg py-1.5 transition ${
              activeCategory === category ? "bg-cyan-500/25 text-cyan-200 shadow-sm" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {CATEGORY_LABELS[category] ?? category}
          </button>
        ))}
      </div>

      {/* Personal-template + designer-program actions */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
        {canPersonal ? (
          <>
            <button
              type="button"
              disabled={busyId === "__save_personal"}
              onClick={saveAsPersonal}
              className="flex items-center gap-1 rounded-lg border border-violet-400/40 bg-violet-500/15 px-2.5 py-1.5 text-[11px] font-bold text-violet-300 hover:bg-violet-500/25 disabled:opacity-50"
            >
              <Upload className="h-3 w-3" />
              <span>ذخیره در قالب‌های شخصی</span>
            </button>
            {designerStatus === "approved" ? (
              <span className="rounded-lg bg-sky-500/15 px-2.5 py-1.5 text-[11px] font-bold text-sky-300">
                برای ثبت قالب در گالری عمومی، به پنل طراح بروید.
              </span>
            ) : designerStatus === "pending" ? (
              <span className="rounded-lg bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-bold text-amber-300">
                درخواست همکاری در انتظار بررسی است.
              </span>
            ) : (
              <button
                type="button"
                disabled={busyId === "__program"}
                onClick={requestDesignerProgram}
                className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-bold text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
              >
                درخواست عضویت در برنامه طراحان
              </button>
            )}
          </>
        ) : (
          <Link
            href="/pricing"
            className="flex items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-bold text-amber-300 hover:bg-amber-500/25"
          >
            <Lock className="h-3 w-3" />
            <span>قالب اختصاصی شخصی — نیازمند اشتراک</span>
          </Link>
        )}
      </div>

      {/* Templates list */}
      <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
        {filtered.map((item) => {
          const allowed = entitled(item);
          const isApplied = appliedId === item.id;
          const isPersonal = item.source === "personal";

          return (
            <div
              key={`${item.source}-${item.id}`}
              className={`relative overflow-hidden rounded-xl border p-3 transition ${
                allowed
                  ? "border-white/10 bg-white/[0.04] hover:border-cyan-400/50 hover:bg-white/[0.08]"
                  : "border-white/5 bg-white/[0.02] opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {isPersonal && <User className="h-3 w-3 text-violet-300" />}
                    <span className="text-xs font-bold text-white truncate">{item.name_fa}</span>
                    {isPersonal && (
                      <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] font-bold text-violet-300">
                        قالب من
                      </span>
                    )}
                    {!isPersonal && item.origin === "designer" && (
                      <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
                        اثر طراح
                      </span>
                    )}
                    {!allowed && !isPersonal && <PremiumBadge label="نیازمند اشتراک" />}
                  </div>
                  {item.description && (
                    <p className="mt-1 text-[11px] leading-4 text-slate-400 line-clamp-2">{item.description}</p>
                  )}
                </div>

                {/* Background swatch (background extracted from design_json server-side) */}
                <div
                  className="h-12 w-20 shrink-0 rounded-lg border border-white/20 shadow-md flex items-center justify-center text-[9px] font-bold text-white/90"
                  style={{ background: item.background }}
                >
                  کارت ۸.۵×۵.۵
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2">
                <span className="text-[10px] text-slate-400">
                  {isPersonal ? "قالب اختصاصی شما — قابل ویرایش کامل" : "سند لایه‌ای قابل ویرایش"}
                </span>
                <div className="flex items-center gap-1.5">
                {isPersonal && (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => deletePersonal(item)}
                    className="flex items-center gap-1 rounded-lg bg-rose-500/10 px-2 py-1.5 text-[11px] font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                    aria-label="حذف قالب شخصی"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
                {allowed ? (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => applyTemplateToCard(item)}
                    className="flex items-center gap-1 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition disabled:opacity-50"
                  >
                    {busyId === item.id ? (
                      <span>…</span>
                    ) : (
                      <>
                        {isApplied && <Check className="h-3.5 w-3.5" />}
                        <span>{isApplied ? "اعمال شد ✓" : "اعمال روی کارت"}</span>
                      </>
                    )}
                  </button>
                ) : (
                  <Link
                    href="/pricing"
                    className="flex items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-bold text-amber-300 hover:bg-amber-500/25 transition"
                  >
                    <Lock className="h-3 w-3" />
                    <span>ارتقای اشتراک</span>
                  </Link>
                )}
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="py-6 text-center text-[11px] text-slate-500">قالبی در این دسته نیست.</p>
        )}
      </div>
    </div>
  );
}
