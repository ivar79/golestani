/**
 * Entitlement contract mirror — تک منبع فرانت‌اند.
 *
 * Mirrors the backend contract (config/entitlements.php + FeatureGate::payload
 * + BusinessCardController@show). The frontend uses these values ONLY for UX
 * (locked overlays, upgrade CTAs, usage meters) — the backend stays the
 * security authority and re-checks every request. Never trust these values
 * for anything security-relevant.
 */

/** Capability types the backend catalog supports. */
export type EntitlementType = "bool" | "int" | "list";

/** Full capability map resolved by the backend (all catalog keys present). */
export type CapabilityMap = Record<string, boolean | number | null | string[]>;

/** Backend FeatureGate::payload shape. */
export type EntitlementPayload = {
  plan: string;
  /** snapshot | legacy_live | free — informational only. */
  source: "snapshot" | "legacy_live" | "free" | (string & {});
  capabilities: CapabilityMap;
};

/** Per-field lock info from BusinessCardController@show. */
export type CardLockState = {
  template: string[];
  theme: string[];
  font_family: string[];
  export_format: string[];
  print_file: boolean;
  max_cards: number | null;
  /** Values grandfathered onto the stored card (re-savable but locked for new use). */
  grandfathered: { template: string | null; theme: string | null; font_family: string | null };
};

/** GET /api/plans response (public pricing page). */
export type PublicPlan = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  duration_days: number;
  features: Record<string, unknown> | null;
  sort_order: number;
  is_featured: boolean;
  is_public: boolean;
  is_active: boolean;
};

export type PublicPlansResponse = {
  free_tier: {
    name: string;
    label: string;
    description: string;
    capabilities: CapabilityMap;
  };
  labels: Record<string, { label: string; type: EntitlementType; group: string }>;
  plans: PublicPlan[];
};

/** Fallback used ONLY while the API payload is loading (never for authz). */
export const FREE_TIER_FALLBACK: EntitlementPayload = {
  plan: "Free",
  source: "free",
  capabilities: {
    card_editor: true,
    card_templates: ["classic", "local"],
    card_themes: ["navy", "emerald"],
    card_fonts: ["sans", "vazir"],
    card_exports: ["png"],
    print_file: false,
    max_cards: 1,
    max_showcases: 0,
    max_ads: 0,
    showcase: false,
    ads: false,
  },
};

export function allowedValues(caps: CapabilityMap, key: string): string[] {
  const value = caps[key];
  return Array.isArray(value) ? value.map(String) : [];
}

export function isAllowedValue(caps: CapabilityMap, key: string, value: string): boolean {
  return allowedValues(caps, key).includes(value);
}

export function isEnabled(caps: CapabilityMap, key: string): boolean {
  return caps[key] === true;
}

/** Numeric limit; null = unlimited. */
export function limitOf(caps: CapabilityMap, key: string): number | null {
  const value = caps[key];
  if (value === null || value === undefined) return null;
  return Math.max(0, Number(value));
}

export function isLimitReached(caps: CapabilityMap, key: string, used: number): boolean {
  const limit = limitOf(caps, key);
  return limit !== null && used >= limit;
}

/**
 * Server entitlement 403 body — machine-readable per-field reasons that the
 * UI renders with the same upgrade treatment as local locks (stale-cap safety).
 */
export type EntitlementErrorBody = {
  message?: string;
  entitlement_errors?: Record<string, string>;
  entitlements?: EntitlementPayload;
};

export function extractEntitlementErrors(error: unknown): Record<string, string> | null {
  const data = (error as { response?: { data?: EntitlementErrorBody } })?.response?.data;
  return data?.entitlement_errors && Object.keys(data.entitlement_errors).length > 0
    ? data.entitlement_errors
    : null;
}

/**
 * Render a plan's feature list from the SERVER catalog labels — the pricing
 * page must never hardcode feature names or values.
 */
export function planFeatureLines(
  planFeatures: Record<string, unknown> | null | undefined,
  labels: PublicPlansResponse["labels"],
): { key: string; label: string; state: "on" | "off" | "value" }[] {
  if (!planFeatures || !labels) return [];
  return Object.entries(labels).map(([key, meta]) => {
    const raw = planFeatures[key];
    if (meta.type === "list") {
      const values = Array.isArray(raw) ? raw.length : 0;
      return { key, label: meta.label, state: values > 0 ? "value" : "off" };
    }
    if (meta.type === "int") {
      const n = raw === null || raw === undefined ? null : Number(raw);
      return { key, label: meta.label, state: n === null ? "value" : n > 0 ? "value" : "off" };
    }
    return { key, label: meta.label, state: raw === true ? "on" : "off" };
  });
}
