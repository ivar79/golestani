import { NextResponse, type NextRequest } from "next/server";

/**
 * Cached proxy for the deterministic business QR endpoint.
 *
 * The QR for a slug never changes (same slug → same SVG), so the response is
 * fully cacheable. Serving it through Vercel's edge keeps repeat dashboard and
 * public-page renders off the Render API — which on the free tier cold-starts
 * after ~15 idle minutes and previously left QR <img> tags hanging.
 */

// QR per slug is deterministic — cache hard; slug changes create new URLs.
const CACHE_CONTROL = "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const base = (
    process.env.NEXT_PUBLIC_API_URL ?? ""
  ).replace(/\/$/, "");

  if (!base) {
    return new NextResponse("NEXT_PUBLIC_API_URL is not configured", { status: 502 });
  }

  try {
    const upstream = await fetch(
      `${base}/public/businesses/${encodeURIComponent(slug)}/qr`,
      { next: { revalidate: 86400 } },
    );

    if (!upstream.ok) {
      return new NextResponse(`Upstream responded ${upstream.status}`, {
        status: upstream.status,
        headers: { "Cache-Control": "public, s-maxage=30" },
      });
    }

    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        // Pass the upstream type through (SVG / PNG — whichever the API emits).
        "Content-Type": upstream.headers.get("content-type") ?? "image/svg+xml",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  } catch {
    return new NextResponse("QR service unavailable", {
      status: 502,
      headers: { "Cache-Control": "public, s-maxage=30" },
    });
  }
}
