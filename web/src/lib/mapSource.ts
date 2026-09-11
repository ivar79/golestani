/**
 * mapSource — resolves which tile source the map should use.
 *
 * Phase 1 (PMTiles):
 *  - "local":  the single-file PMTiles archive served by Laravel at
 *              /api/map/pmtiles with byte ranges (206). protomaps-leaflet
 *              detects the `.pmtiles` URL and issues Range requests itself.
 *  - "online": the Laravel raster proxy (OSM mirrors, always works).
 *  - "auto":   HEAD /api/map/pmtiles once per session; use PMTiles when the
 *              archive is deployed, else the raster proxy.
 *
 * The former per-tile MBTiles endpoint (/api/map/tile/…) is no longer used
 * by the frontend; its Laravel route stays temporarily for the admin tab.
 */

export type MapSourceMode = "local" | "online" | "auto";

export type ResolvedSource = {
  /** The effective source after auto-resolution / fallbacks. */
  effective: "local" | "online";
  /** True when auto-detection probed the archive endpoint. */
  probed: boolean;
};

const PROBE_CACHE_MS = 60_000;

let cachedProbe: { at: number; present: boolean } | null = null;

function apiBase(): string {
  // NEXT_PUBLIC_API_URL includes the /api suffix (see web/src/lib/api.ts).
  return (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
}

/**
 * URL of the single-file PMTiles archive. The path MUST end in ".pmtiles":
 * protomaps-leaflet picks its Range-request source by pathname suffix.
 */
export function localPmtilesUrl(): string {
  return `${apiBase()}/map/basemap.pmtiles`;
}

/**
 * Build the raster (OSM) tile URL template for the Laravel proxy.
 * Pure PHP backend — the former Node.js proxy route in this app is retired
 * and now only 308-redirects here.
 */
export function rasterTileUrl(): string {
  return `${apiBase()}/map/raster-tile/{z}/{x}/{y}`;
}

/** Ask the backend whether the PMTiles archive is deployed and readable. */
export async function probeLocalArchive(force = false): Promise<boolean> {
  if (!force && cachedProbe && Date.now() - cachedProbe.at < PROBE_CACHE_MS) {
    return cachedProbe.present;
  }
  try {
    const res = await fetch(localPmtilesUrl(), { method: "HEAD", cache: "no-store" });
    cachedProbe = { at: Date.now(), present: res.ok };
  } catch {
    cachedProbe = { at: Date.now(), present: false };
  }
  return cachedProbe.present;
}

/** Resolve a user-selected mode to a concrete source. */
export async function resolveMapSource(mode: MapSourceMode): Promise<ResolvedSource> {
  if (mode === "local") return { effective: "local", probed: false };
  if (mode === "online") return { effective: "online", probed: false };
  const present = await probeLocalArchive();
  return { effective: present ? "local" : "online", probed: true };
}

/** Runtime downgrade hook — MapView calls this when PMTiles ranges fail. */
export function degradeToOnline(): void {
  cachedProbe = { at: Date.now(), present: false };
}
