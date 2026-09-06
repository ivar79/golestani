import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Minimal fallback SVG 256x256 tile for offline / network outage
const FALLBACK_SVG_TILE = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="#f8fafc"/>
  <path d="M0 0h256v256H0z" fill="none" stroke="#e2e8f0" stroke-width="1"/>
  <path d="M0 64h256M0 128h256M0 192h256M64 0v256M128 0v256M192 0v256" stroke="#f1f5f9" stroke-width="0.5"/>
</svg>
`);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await params;
  
  // Clean y from extension if passed as y.png
  const cleanY = y.replace(/\.png$/, "");

  // List of tile servers to try (OSM primary, fallback mirrors)
  const tileSources = [
    `https://tile.openstreetmap.org/${z}/${x}/${cleanY}.png`,
    `https://a.tile.openstreetmap.org/${z}/${x}/${cleanY}.png`,
    `https://b.tile.openstreetmap.org/${z}/${x}/${cleanY}.png`,
  ];

  for (const url of tileSources) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000); // 4s timeout

      const res = await fetch(url, {
        headers: {
          "User-Agent": "InCard-App/1.0 (https://incard.ir; contact@incard.ir)",
        },
        signal: controller.signal,
        next: { revalidate: 604800 }, // Cache 7 days in Next.js
      });

      clearTimeout(timeout);

      if (res.ok) {
        const buffer = await res.arrayBuffer();
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": res.headers.get("Content-Type") || "image/png",
            "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
            "X-Tile-Source": "upstream",
          },
        });
      }
    } catch {
      // Continue to next mirror or fallback
    }
  }

  // Graceful fallback for complete network disconnection: returns neutral grid tile
  return new NextResponse(FALLBACK_SVG_TILE, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400",
      "X-Tile-Source": "fallback-offline",
    },
  });
}
