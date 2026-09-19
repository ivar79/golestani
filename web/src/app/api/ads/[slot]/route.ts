import { NextResponse, type NextRequest } from "next/server";

/**
 * Cached CDN proxy for the public ad slot.
 *
 * P0 cold-start fix: the Laravel API runs on Render's free tier and spins
 * down after 15 idle minutes (~50s cold start). Every taskbar render used to
 * hit the API directly from the browser — the first visitor after an idle
 * period ate that cold start. This handler moves the fetch server-side and
 * caches the response on Vercel's edge (s-maxage + stale-while-revalidate),
 * so repeat visitors get an instant cached response and the origin API only
 * sees one request per TTL window.
 */

// Ad data changes rarely; five minutes of edge cache is plenty fresh.
const REVALIDATE_SECONDS = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slot: string }> },
) {
  const { slot } = await params;

  const base = (
    process.env.NEXT_PUBLIC_API_URL ?? ""
  ).replace(/\/$/, "");

  // Misconfiguration must fail loudly, not silently render no ads forever.
  if (!base) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_API_URL is not configured" },
      { status: 502 },
    );
  }

  try {
    const upstream = await fetch(`${base}/public/advertisements/${encodeURIComponent(slot)}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    });

    if (!upstream.ok) {
      // Pass the upstream status through but still allow short edge caching
      // so a grumpy origin doesn't turn into a stampede.
      return NextResponse.json(
        { error: `Upstream responded ${upstream.status}` },
        {
          status: upstream.status,
          headers: { "Cache-Control": `public, s-maxage=30, stale-while-revalidate=${REVALIDATE_SECONDS}` },
        },
      );
    }

    const data = await upstream.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": `public, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=600`,
      },
    });
  } catch {
    // Network failure to the origin — serve a short-cached empty list so the
    // taskbar renders (it already treats [] as "render nothing").
    return NextResponse.json([], {
      status: 200,
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  }
}
