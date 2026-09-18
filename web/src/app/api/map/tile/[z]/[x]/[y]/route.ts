import { NextResponse, type NextRequest } from "next/server";

/**
 * Retired Node.js tile proxy (was: fetch OSM raster with Buffer + mirrors).
 *
 * All tile serving now lives on the Laravel API (PHP 8.3) as the single
 * backend of this stack:
 *   - vector (MBTiles):  GET {API}/api/map/tile/{z}/{x}/{y}
 *   - raster (OSM):      GET {API}/api/map/raster-tile/{z}/{x}/{y}
 *
 * This handler keeps legacy client URLs alive with a permanent redirect —
 * zero Node runtime logic, zero I/O, just a 308. Leaflet follows redirects
 * transparently, so old cached clients keep working until they refresh.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z, x, y } = await params;
  const { searchParams } = new URL(request.url);
  const query = searchParams.toString();

  const base = (
    process.env.NEXT_PUBLIC_API_URL ??
    ""
  ).replace(/\/$/, "");

  // No API host configured: fail loudly (502) instead of redirecting to a
  // relative garbage URL that would 404 against the frontend origin.
  if (!base) return new NextResponse("NEXT_PUBLIC_API_URL is not configured", { status: 502 });
  return NextResponse.redirect(
    new URL(`${base}/map/raster-tile/${z}/${x}/${y}${query ? `?${query}` : ""}`),
    308,
  );
}
