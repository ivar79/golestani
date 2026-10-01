/**
 * Luxury materials, effects and advertising wave presets (Phase 4.5).
 *
 * Professional plan only — gated by subscription entitlements.
 * Includes Frosted Glass (Glassmorphism), Royal Velvet Matte, Luxury Gold Foil,
 * Chrome Silver, Neon Glow, and Advertising Waves / S-Curves for business cards.
 */

import type { PathLayer } from "./document";
import { curveProfilePoints, type CurveProfile } from "./curveLine";

export type LuxuryMaterialKey =
  | "none"
  | "glass"
  | "velvet"
  | "gold"
  | "silver"
  | "neon"
  | "crimson_velvet";

export type LuxuryMaterialDef = {
  key: LuxuryMaterialKey;
  label: string;
  badge: "پرمیوم" | "حرفه‌ای" | "لوکس";
  effect: "glass" | "velvet" | "gold" | "silver" | "neon" | "none";
  previewCss: string;
  fillCss: string;
  strokeCss: string;
  description: string;
};

export const LUXURY_MATERIALS: LuxuryMaterialDef[] = [
  {
    key: "glass",
    label: "شیشه‌ای بلورین",
    badge: "لوکس",
    effect: "glass",
    previewCss: "linear-gradient(135deg, rgba(255,255,255,0.4), rgba(255,255,255,0.1))",
    fillCss: "rgba(255, 255, 255, 0.16)",
    strokeCss: "rgba(255, 255, 255, 0.45)",
    description: "افکت مات شیشه‌ای (Glassmorphism) با بلور زمینه و حاشیه نوری ۱ پیکسلی",
  },
  {
    key: "velvet",
    label: "مخملی رویال",
    badge: "پرمیوم",
    effect: "velvet",
    previewCss: "linear-gradient(135deg, #090d16 0%, #111827 50%, #060910 100%)",
    fillCss: "linear-gradient(135deg, #090d16 0%, #111827 50%, #060910 100%)",
    strokeCss: "#1e293b",
    description: "مشکی و سرمه‌ای مات عمیق بدون بازتاب با حس مخمل درباری",
  },
  {
    key: "gold",
    label: "طلایی متالیک",
    badge: "لوکس",
    effect: "gold",
    previewCss: "linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)",
    fillCss: "linear-gradient(135deg, #BF953F 0%, #FCF6BA 25%, #B38728 50%, #FBF5B7 75%, #AA771C 100%)",
    strokeCss: "#d4af37",
    description: "گرادیان ورق طلای براق ۵ مرحله‌ای با انعکاس نور متالیک",
  },
  {
    key: "silver",
    label: "نقره‌ای کروم",
    badge: "پرمیوم",
    effect: "silver",
    previewCss: "linear-gradient(135deg, #8a8a8a 0%, #e0e0e0 25%, #ffffff 50%, #cccccc 75%, #757575 100%)",
    fillCss: "linear-gradient(135deg, #8a8a8a 0%, #e0e0e0 25%, #ffffff 50%, #cccccc 75%, #757575 100%)",
    strokeCss: "#cbd5e1",
    description: "نقره و استیل صیقلی با درخشش متالیک روشن",
  },
  {
    key: "neon",
    label: "نئون فیروزه‌ای",
    badge: "حرفه‌ای",
    effect: "neon",
    previewCss: "linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)",
    fillCss: "#00f2fe",
    strokeCss: "#00f2fe",
    description: "تابش الکتریکی نئون با هاله نوری درخشان",
  },
  {
    key: "crimson_velvet",
    label: "زرشکی مخملی",
    badge: "لوکس",
    effect: "velvet",
    previewCss: "linear-gradient(135deg, #2b0914 0%, #4a0e23 50%, #1a050c 100%)",
    fillCss: "linear-gradient(135deg, #2b0914 0%, #4a0e23 50%, #1a050c 100%)",
    strokeCss: "#701a35",
    description: "زرشکی سلطنتی مات مناسب کارت‌های پزشکی، حقوقی و کلینیک",
  },
];

/**
 * Calculate anchor handles to bend a 2-point path into an arc based on a curvature percentage (-100 to +100).
 */
export function calculateArcHandles(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  curvature: number,
) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { h0: null, h1: null };

  // Normal perpendicular vector
  const nx = -dy / len;
  const ny = dx / len;

  // Arc bend offset (from -100 to +100)
  const offset = (curvature / 100) * (len * 0.45);

  const cx0 = p0.x + dx / 3 + nx * offset;
  const cy0 = p0.y + dy / 3 + ny * offset;

  const cx1 = p1.x + (dx * 2) / 3 + nx * offset;
  const cy1 = p1.y + (dy * 2) / 3 + ny * offset;

  return {
    h0: { x: cx0, y: cy0 },
    h1: { x: cx1, y: cy1 },
  };
}

/**
 * Generate a curved line / arc path layer.
 *
 * `bend` (a signed sagitta ratio, ±1 = semicircle) is the CANONICAL model —
 * the resolver, the on-canvas bend handle and the export all consume it.
 * `curvature` (a -100..100 percentage) is kept only so documents saved by
 * older builds still type-check; it is normalized onto `bend` at parse time.
 */
export function createCurvedLineLayer(
  x = 100,
  y = 300,
  width = 500,
  height = 100,
  curvature = 40,
  color = "#0ea5e9",
  profile: CurveProfile = "arc",
): PathLayer {
  const id = `path-${Math.random().toString(36).slice(2, 9)}`;
  const points = curveProfilePoints(width, height, profile, Math.min(0.44, Math.abs(curvature) / 100));
  const isArc = profile === "arc";

  return {
    id,
    name:
      profile === "sine"
        ? "موج سینوسی"
        : profile === "sine-asymmetric"
          ? "موج سینوسی نامتقارن"
          : profile === "s"
            ? "موج S"
            : "خط منحنی کمانی",
    kind: "path",
    pathMode: "curve",
    curveProfile: profile,
    x,
    y,
    width,
    height: Math.max(height, 40),
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: null,
    closed: false,
    stroke: color,
    strokeWidth: 4,
    strokeStyle: "solid",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeOpacity: 1,
    fill: null,
    curvature,
    ...(isArc ? { bend: clampBend(curvature / 100) } : {}),
    points,
  };
}

/** Keep a sagitta ratio inside the resolver's supported range. */
export function clampBend(bend: number): number {
  if (!Number.isFinite(bend)) return 0;
  return Math.max(-1.5, Math.min(1.5, bend));
}

/**
 * Generate a wave divider layer (like Karan Gostar / IranTarh accounting cards).
 */
export function createWaveDividerLayer(
  width = 1050,
  height = 260,
  color = "#0ea5e9",
  fill = "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
): PathLayer {
  const id = `path-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    name: "موج جداکننده کاران گستر",
    kind: "path",
    x: 0,
    y: 340,
    width,
    height,
    angle: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    color: null,
    background: null,
    closed: true,
    stroke: color,
    strokeWidth: 0,
    fill,
    points: [
      { x: 0, y: 120, hIn: null, hOut: { x: 320, y: 40 } },
      { x: 680, y: 180, hIn: { x: 440, y: 190 }, hOut: { x: 880, y: 170 } },
      { x: 1050, y: 90, hIn: { x: 960, y: 110 }, hOut: null },
      { x: 1050, y: height, hIn: null, hOut: null },
      { x: 0, y: height, hIn: null, hOut: null },
    ],
  };
}

/**
 * Generate a corner decorative swoosh ribbon.
 */
export function createCornerSwooshLayer(
  x = 650,
  y = 350,
  width = 400,
  height = 250,
  color = "#38bdf8",
): PathLayer {
  const id = `path-${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    name: "روبان هلالی گوشه",
    kind: "path",
    x,
    y,
    width,
    height,
    angle: 0,
    opacity: 0.9,
    locked: false,
    hidden: false,
    color: null,
    background: null,
    closed: false,
    stroke: color,
    strokeWidth: 5,
    strokeStyle: "solid",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    fill: null,
    points: [
      { x: 0, y: height, hIn: null, hOut: { x: 140, y: height - 80 } },
      { x: width, y: 0, hIn: { x: width - 60, y: 120 }, hOut: null },
    ],
  };
}
