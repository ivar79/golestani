"use client";

/**
 * EntitlementGate — frontend UX mirror of the backend FeatureGate.
 *
 * RESPONSIBILITY SEPARATION:
 *   - Authentication  → AuthContext (who you are)
 *   - Authorization   → Laravel FeatureGate (what you may do — authoritative)
 *   - Subscription    → Laravel (business state, snapshot on the subscription)
 *   - Entitlement     → this provider (read-only mirror for UX)
 *   - Editor UI state → card-maker local state (selections, dirty flags)
 *
 * This component NEVER decides security. It renders locks, badges, disabled
 * states and upgrade CTAs from the backend-provided entitlement payload. If
 * the payload is stale and the backend answers 403 with entitlement_errors,
 * the editor surfaces that through the same UI.
 */

import { createContext, useContext, type ReactNode } from "react";
import { Lock, Sparkles, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import {
  FREE_TIER_FALLBACK,
  allowedValues,
  isAllowedValue,
  isEnabled,
  limitOf,
  type CapabilityMap,
  type EntitlementPayload,
  type CardLockState,
} from "@/lib/entitlements";

const EntitlementContext = createContext<EntitlementPayload>(FREE_TIER_FALLBACK);

export function EntitlementProvider({ value, children }: { value: EntitlementPayload; children: ReactNode }) {
  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

/** Read the current capability payload (UX only — not a security boundary). */
export function useEntitlements(): EntitlementPayload {
  return useContext(EntitlementContext);
}

export function useCapabilities(): CapabilityMap {
  return useContext(EntitlementContext).capabilities;
}

/** Premium badge — marks an entitled-only option. */
export function PremiumBadge({ label = "ویژه" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-black text-amber-300">
      <Sparkles className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}

/**
 * Locked overlay for a picker tile: dims the option, shows the lock +
 * premium badge, and explains why it is unavailable with an upgrade CTA.
 */
export function LockedOverlay({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-xl bg-slate-950/70 p-2 text-center backdrop-blur-[2px]"
      role="note"
      aria-label={`${title} — ${description}`}
    >
      <span className="flex items-center gap-1 text-[10px] font-black text-amber-300">
        <Lock className="h-3 w-3" />
        ویژه
      </span>
      <span className="text-[10px] leading-4 text-slate-300">{title}</span>
      <Link
        href="/pricing"
        className="mt-0.5 inline-flex items-center gap-0.5 rounded-md border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-300 hover:bg-amber-400/20"
      >
        ارتقا
        <ArrowUpRight className="h-2.5 w-2.5" />
      </Link>
      <span className="sr-only">{description}</span>
    </div>
  );
}

/**
 * Usage meter against a numeric entitlement limit (e.g. max_cards).
 * Values come from the backend contract; `used` is client-known state.
 */
export function UsageMeter({ capability, used, labels }: { capability: string; used: number; labels?: Record<string, string> }) {
  const caps = useCapabilities();
  const limit = limitOf(caps, capability);
  if (limit === null) {
    return <span className="text-[10px] text-emerald-300">نامحدود</span>;
  }
  const label = labels?.[capability] ?? capability;
  const full = used >= limit;

  return (
    <span className={`text-[10px] font-semibold ${full ? "text-amber-300" : "text-slate-400"}`}>
      {label}: {used} از {limit === 0 ? "۰" : limit}
      {full && " — سقف پلن فعلی"}
    </span>
  );
}

/** Convenience hooks for the card editor. */
export function useCardEntitlements() {
  const payload = useEntitlements();
  const caps = payload.capabilities;

  return {
    payload,
    canUseTemplate: (t: string) => isAllowedValue(caps, "card_templates", t),
    canUseTheme: (t: string) => isAllowedValue(caps, "card_themes", t),
    canUseFont: (f: string) => isAllowedValue(caps, "card_fonts", f),
    canExport: (f: string) => isAllowedValue(caps, "card_exports", f),
    canUploadPrintFile: () => isEnabled(caps, "print_file"),
    allowedTemplates: () => allowedValues(caps, "card_templates"),
    maxCards: () => limitOf(caps, "max_cards"),
  };
}

/** Type re-export for consumers building lock-aware UIs. */
export type { CardLockState };
