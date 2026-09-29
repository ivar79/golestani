"use client";

/**
 * TemplatesPanel — Template Gallery with Tiered Access & Cultural Masterpieces.
 *
 * Tiering Contract:
 *   - Free Plan: 3 Simple Starter Templates
 *   - Starter Plan: 6 Commercial Standard Templates
 *   - Pro Plan: All VIP Masterpieces (Persian Carpet, Persian Architecture,
 *               Gol-o-Morgh, Laser-Cut Wood, Western Classical, Eastern Zen)
 */

import { useState } from "react";
import { Sparkles, Lock, Check } from "lucide-react";
import { TEMPLATES_CATALOG, type TemplateDef, type TemplateTier } from "../domain/templatesCatalog";
import type { EditorEngine } from "../engine/EditorEngine";
import type { Business } from "@/lib/businesses";
import { useEntitlements, PremiumBadge } from "@/components/cards/FeatureGate";
import Link from "next/link";

export function TemplatesPanel({
  engine,
  business,
}: {
  engine: EditorEngine;
  business: Business;
}) {
  const entitlements = useEntitlements();
  const plan = (entitlements.plan || "Free").toLowerCase();
  const isPro = plan !== "free" && plan !== "starter";
  const isStarterOrPro = plan !== "free";

  const [activeCategory, setActiveCategory] = useState<"all" | "persian" | "starter" | "free">("all");
  const [appliedId, setAppliedId] = useState<string | null>(null);

  const canUseTemplate = (tier: TemplateTier): boolean => {
    if (tier === "free") return true;
    if (tier === "starter") return isStarterOrPro;
    return isPro;
  };

  const filteredTemplates = TEMPLATES_CATALOG.filter((t) => {
    if (activeCategory === "free") return t.tier === "free";
    if (activeCategory === "starter") return t.tier === "starter";
    if (activeCategory === "persian") return t.tier === "pro";
    return true;
  });

  const applyTemplate = (template: TemplateDef) => {
    if (!canUseTemplate(template.tier)) return;

    const newLayers = template.buildLayers(business);
    engine.applyTemplateDoc(template.background, newLayers);
    setAppliedId(template.id);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0c1626]/80 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-cyan-400" />
            <span>گالری قالب‌های آماده و شاهکارهای هنری</span>
          </h3>
          <p className="text-[10px] text-slate-400 mt-0.5">
            انتخاب هر قالب، لایه‌ها و ترکیب رنگ کارت شما را در ۱ ثانیه آماده می‌کند.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/30 p-1 text-[11px] font-bold">
        <button
          type="button"
          onClick={() => setActiveCategory("all")}
          className={`rounded-lg py-1.5 transition ${
            activeCategory === "all" ? "bg-cyan-500/25 text-cyan-200 shadow-sm" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          همه ({TEMPLATES_CATALOG.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveCategory("persian")}
          className={`rounded-lg py-1.5 transition ${
            activeCategory === "persian" ? "bg-amber-500/25 text-amber-200 shadow-sm" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          👑 سنتی و VIP
        </button>
        <button
          type="button"
          onClick={() => setActiveCategory("starter")}
          className={`rounded-lg py-1.5 transition ${
            activeCategory === "starter" ? "bg-cyan-500/25 text-cyan-200 shadow-sm" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          استارتر (۶)
        </button>
        <button
          type="button"
          onClick={() => setActiveCategory("free")}
          className={`rounded-lg py-1.5 transition ${
            activeCategory === "free" ? "bg-emerald-500/25 text-emerald-200 shadow-sm" : "text-slate-400 hover:text-slate-200"
          }`}
        >
          رایگان (۳)
        </button>
      </div>

      {/* Templates List */}
      <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
        {filteredTemplates.map((item) => {
          const allowed = canUseTemplate(item.tier);
          const isApplied = appliedId === item.id;

          return (
            <div
              key={item.id}
              className={`relative overflow-hidden rounded-xl border p-3 transition ${
                allowed
                  ? "border-white/10 bg-white/[0.04] hover:border-cyan-400/50 hover:bg-white/[0.08]"
                  : "border-white/5 bg-white/[0.02] opacity-70"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white truncate">{item.name}</span>
                    {item.tier === "pro" && <PremiumBadge label="ویژه VIP" />}
                    {item.tier === "starter" && (
                      <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
                        استارتر
                      </span>
                    )}
                    {item.tier === "free" && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                        رایگان
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-slate-400">{item.description}</p>
                </div>

                {/* Preview color swatch box */}
                <div
                  className="h-12 w-20 shrink-0 rounded-lg border border-white/20 shadow-md flex items-center justify-center text-[9px] font-bold text-white/90"
                  style={{ background: item.background }}
                >
                  کارت ۸.۵×۵.۵
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2">
                <span className="text-[10px] text-slate-400">تعداد لایه‌ها: ۵ الی ۸ لایه وکتور</span>
                {allowed ? (
                  <button
                    type="button"
                    onClick={() => applyTemplate(item)}
                    className="flex items-center gap-1 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition"
                  >
                    {isApplied ? <Check className="h-3.5 w-3.5" /> : null}
                    <span>{isApplied ? "اعمال شد ✓" : "اعمال روی کارت"}</span>
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
          );
        })}
      </div>
    </div>
  );
}
