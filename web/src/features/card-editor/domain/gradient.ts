/**
 * InKart Gradient Model — two-stop+ CSS gradients for layer fills.
 *
 * Same contract as color.ts: pure functions, no DOM. A gradient is a value
 * object that renders to a CSS string for the canvas and serializes to plain
 * JSON inside the document. Stops are kept sorted + clamped so the document
 * is always renderable even after hand-editing.
 */

export type GradientStop = {
  /** 0..100 — position along the gradient axis. */
  offset: number;
  /** Any CSS color the editor can produce (hex/rgba). */
  color: string;
  /** 0..1 — independent of the color's own alpha. */
  opacity: number;
};

export type Gradient = {
  type: "linear" | "radial";
  /** Degrees 0..360 (clockwise from 12 o'clock). Only used when linear. */
  angle: number;
  stops: GradientStop[];
};

export type GradientInput = Partial<Gradient> & { stops?: GradientStop[] };

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Default two-stop blue→cyan used by the picker's "gradient" swatch. */
export function createGradient(input: GradientInput = {}): Gradient {
  const stops = Array.isArray(input.stops) && input.stops.length >= 2
    ? input.stops.map(sanitizeStop)
    : [
      { offset: 0, color: "#0ea5e9", opacity: 1 },
      { offset: 100, color: "#2563eb", opacity: 1 },
    ];

  return {
    type: input.type === "radial" ? "radial" : "linear",
    angle: clamp(Number.isFinite(input.angle as number) ? (input.angle as number) : 135, 0, 360),
    stops: sortStops(stops),
  };
}

/** Clamp/normalize a single stop (used on every mutation). */
export function sanitizeStop(stop: Partial<GradientStop>): GradientStop {
  const color = typeof stop.color === "string" && stop.color !== "" ? stop.color : "#000000";
  return {
    offset: clamp(round2(typeof stop.offset === "number" ? stop.offset : 0), 0, 100),
    color,
    opacity: clamp(round2(typeof stop.opacity === "number" ? stop.opacity : 1), 0, 1),
  };
}

/** Sort stops ascending by offset, dropping exact duplicates. */
export function sortStops(stops: GradientStop[]): GradientStop[] {
  return stops
    .slice()
    .sort((a, b) => a.offset - b.offset)
    .filter((stop, index, array) => index === 0 || stop.offset !== array[index - 1].offset);
}

/** Insert a stop at the given offset, keeping the list sorted. */
export function addStop(gradient: Gradient, offset: number, color = "#ffffff", opacity = 1): Gradient {
  return {
    ...gradient,
    stops: sortStops([...gradient.stops, sanitizeStop({ offset, color, opacity })]),
  };
}

/** Remove a stop by index; never below the two-stop minimum. */
export function removeStop(gradient: Gradient, index: number): Gradient {
  if (gradient.stops.length <= 2) return gradient;
  return { ...gradient, stops: gradient.stops.filter((_, i) => i !== index) };
}

/** Update one stop, re-sorting and re-clamping. */
export function updateStop(gradient: Gradient, index: number, patch: Partial<GradientStop>): Gradient {
  const stops = gradient.stops.map((stop, i) => (i === index ? sanitizeStop({ ...stop, ...patch }) : stop));
  return { ...gradient, stops: sortStops(stops) };
}

/** Convert a hex color + independent opacity into one CSS color token. */
export function stopToColor(stop: GradientStop): string {
  if (stop.opacity >= 1) return stop.color;
  const alpha = Math.round(stop.opacity * 100) / 100;
  // Hex with alpha channel (#rrggbbaa) — single color token, no rgba() parse.
  if (/^#[0-9a-fA-F]{6}$/.test(stop.color)) {
    const aHex = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return `${stop.color}${aHex}`;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(stop.color)) {
    const expanded = stop.color
      .slice(1)
      .split("")
      .map((c) => c + c)
      .join("");
    const aHex = Math.round(alpha * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${expanded}${aHex}`;
  }
  // Already rgba()/rgb() — fall back to the color as-is (opacity applied by
  // the gradient's own alpha in the renderer).
  return stop.color;
}

/** Render to a CSS gradient string for the canvas/backgrounds. */
export function gradientToCss(gradient: Gradient): string {
  const stops = gradient.stops
    .map((stop) => `${stopToColor(stop)} ${round2(stop.offset)}%`)
    .join(", ");
  return gradient.type === "radial"
    ? `radial-gradient(circle at center, ${stops})`
    : `linear-gradient(${Math.round(gradient.angle)}deg, ${stops})`;
}

/**
 * Round-trip guard: a gradient must survive JSON serialization and re-parse
 * unchanged (document integrity check used by the editor tests).
 */
export function gradientRoundTrips(gradient: Gradient): boolean {
  try {
    const reParsed = JSON.parse(JSON.stringify(gradient)) as Gradient;
    return gradientToCss(reParsed) === gradientToCss(gradient);
  } catch {
    return false;
  }
}
