/**
 * mapSource — resolves which tile source the map should use (task 7/12).
 *
 * Modes:
 *  - "local":  Laravel vector endpoint reading the MBTiles archive (Railway)
 *  - "online": the existing Next.js raster proxy (OSM mirrors, always works)
 *  - "auto":   probe GET {API}/api/map/status once per session; use the
 *              vector endpoint when the archive is present, else online.
 *
 * Auto-mode failures at runtime (tile fetch errors) also downgrade the
 * session to online, so a broken archive never blanks the map.
 */

export type MapSourceMode = "local" | "online" | "auto";

export type ResolvedSource = {
  /** The effective source after auto-resolution / fallbacks. */
  effective: "local" | "online";
  /** True when auto-detection probed the status endpoint. */
  probed: boolean;
};

const STATUS_CACHE_MS = 60_000;

let cachedProbe: { at: number; present: boolean } | null = null;

function apiBase(): string {
  // NEXT_PUBLIC_API_URL includes the /api suffix (see web/src/lib/api.ts).
  return (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
}

/** Build the vector tile URL template for the Laravel MBTiles endpoint. */
export function localVectorTileUrl(): string {
  return `${apiBase()}/map/tile/{z}/{x}/{y}`;
}

/**
 * Build the raster (OSM) tile URL template for the Laravel proxy.
 * Pure PHP backend — the former Node.js proxy route in this app is retired
 * and now only 308-redirects here.
 */
export function rasterTileUrl(): string {
  return `${apiBase()}/map/raster-tile/{z}/{x}/{y}`;
}

/** Ask the backend whether the MBTiles archive is mounted and readable. */
export async function probeLocalArchive(force = false): Promise<boolean> {
  if (!force && cachedProbe && Date.now() - cachedProbe.at < STATUS_CACHE_MS) {
    return cachedProbe.present;
  }
  try {
    const res = await fetch(`${apiBase()}/map/status`, { cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as { mbtiles_present?: boolean };
    cachedProbe = { at: Date.now(), present: data.mbtiles_present === true };
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

/** Runtime downgrade hook — MapView calls this when vector tiles fail. */
export function degradeToOnline(): void {
  cachedProbe = { at: Date.now(), present: false };
}
