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
  /** The upcoming plan change (downgrade), or null. Set by FeatureGate::payload. */
  scheduled?: ScheduledPlanChange | null;
};

/** Per-field lock info from BusinessCardController@show. */
export type CardLockState = {
  template: string[];
  theme: string[];
  font_family: string[];
  export_format: string[];
  print_file: boolean;
  max_cards: number | null;
  /** Layered-document capability mirrors (Phase 4 hardening). */
  layer_kinds?: string[];
  max_layers?: number | null;
  max_premium_elements?: number | null;
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
    card_layer_kinds: ["text", "image", "qr", "badge", "shape", "path"],
    card_premium_layer_kinds: [],
    max_layers: 60,
    max_premium_elements: null,
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

/* ------------------------------------------------------------------ *
 * Layered-document capability helpers (Phase 4 hardening — pure fns).
 * UX only: the backend re-checks every save and answers 403 with
 * entitlement_errors when the mirror here is stale.
 * ------------------------------------------------------------------ */

/** May a layer of this kind be ADDED under the current capability map? */
export function layerKindAllowed(caps: CapabilityMap, kind: string): boolean {
  const kinds = caps["card_layer_kinds"];
  // Absent key = pre-hardening payload → behave like the old allow-all UI.
  // An explicitly EMPTY list means nothing is granted.
  if (kinds === undefined || kinds === null) return true;
  if (!Array.isArray(kinds)) return true;
  return kinds.map(String).includes(kind);
}

/** Layer kinds the capability map grants (editor toolbox universe). */
export function allowedLayerKinds(caps: CapabilityMap): string[] {
  const kinds = caps["card_layer_kinds"];
  if (!Array.isArray(kinds)) return ["text", "image", "qr", "badge", "shape", "path"];
  return kinds.map(String);
}

export type LayerLimitState =
  | { state: "ok"; remaining: number | null }
  | { state: "reached" };

/** May another layer be added given the current count? null limit = unlimited. */
export function layerLimitState(caps: CapabilityMap, count: number): LayerLimitState {
  const limit = limitOf(caps, "max_layers");
  if (limit === null) return { state: "ok", remaining: null };
  return count >= limit ? { state: "reached" } : { state: "ok", remaining: limit - count };
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

/**
 * The `scheduled` block the backend adds to the entitlement payload: the plan
 * waiting to take over when the current period ends (a downgrade).
 */
export type ScheduledPlanChange = {
  id: number;
  plan_id: number;
  plan_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
};

/** Human-readable labels for the server's entitlement_error keys. */
const ENTITLEMENT_ERROR_LABELS: Record<string, string> = {
  card_editor: "ویرایشگر پیشرفته کارت",
  design_layer_kinds: "نوع لایه",
  design_fonts: "قلم به‌کاررفته در طرح",
  max_layers: "سقف تعداد لایه",
  max_premium_elements: "سقف عناصر ویژه",
  template: "قالب",
  theme: "پالت رنگ",
  font_family: "قلم",
  export_format: "فرمت خروجی",
  export_design: "خروجی طرح ویژه",
  print_file: "فایل طرح چاپی",
  max_cards: "تعداد کارت",
};

/**
 * Turn the server's machine-readable entitlement errors into ONE sentence the
 * user can act on, naming what is actually locked. Returns null when the
 * failure was not an entitlement one (so the caller shows its own message).
 *
 * The server is the authority: a rejected save/export must tell the user WHICH
 * capability refused it rather than surfacing a generic failure.
 */
export function describeEntitlementErrors(
  errors: Record<string, string> | null | undefined,
): string | null {
  if (!errors) return null;
  const keys = Object.keys(errors);
  if (keys.length === 0) return null;
  const labels = keys.map((key) => ENTITLEMENT_ERROR_LABELS[key] ?? key);
  return `در پلن فعلی شما این موارد فعال نیست: ${labels.join("، ")}. برای ادامه پلن را ارتقا دهید.`;
}

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
