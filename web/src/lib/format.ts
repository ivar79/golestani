/**
 * Phase 3 approved distance formatting — shared by MiniCard and map popups:
 *   < ۱۰۰۰ متر → "۸۵۰ متر"
 *   ≥ ۱۰۰۰ متر → "۲.۴ کیلومتر" (one decimal, Persian digits)
 * Pure function (no browser globals) so node:test covers it directly.
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters).toLocaleString("fa-IR")} متر`;
  return `${(meters / 1000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} کیلومتر`;
}
