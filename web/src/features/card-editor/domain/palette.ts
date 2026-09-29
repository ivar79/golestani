/**
 * The editor's quick-pick colour swatches.
 *
 * ONE source: previously the panels each carried a copy, which meant a shape's
 * stroke swatches and a text layer's colour swatches could drift apart. Every
 * colour control now reads this list.
 */

export const EDITOR_PALETTE = [
  "#0b1c33",
  "#0ea5e9",
  "#10b981",
  "#d97706",
  "#e11d48",
  "#ffffff",
  "#64748b",
  "#052e22",
] as const;
