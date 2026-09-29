import { NextResponse, type NextRequest } from "next/server";

/**
 * Cached proxy for the deterministic business QR endpoint.
 *
 * The QR for a slug never changes (same slug → same SVG), so the response is
 * fully cacheable. Serving it through Vercel's edge keeps repeat dashboard and
 * public-page renders off the Render API — which on the free tier cold-starts
 * after ~15 idle minutes and previously left QR <img> tags hanging.
 *
 * It is ALSO the single QR source for the card renderer (editor stage, export
 * surface and public card). Two reasons: the renderer no longer depends on the
 * authenticated axios client (so an unauthenticated public page can draw it),
 * and the SVG is same-origin, which is what lets `html-to-image` inline it when
 * rasterizing an export.
 *
 * AUTH ISOLATION: an approved business's QR is public, but an unapproved one is
 * owner-only upstream. A caller-supplied Authorization header is therefore
 * forwarded AND the response is made uncacheable, so a draft QR can never be
 * served from a shared cache to an anonymous visitor.
 */

// QR per slug is deterministic — cache hard for the public case.
const CACHE_CONTROL = "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const base = (
    process.env.NEXT_PUBLIC_API_URL ?? ""
  ).replace(/\/$/, "");

  if (!base) {
    return new NextResponse("NEXT_PUBLIC_API_URL is not configured", { status: 502 });
  }

  const authorization = request.headers.get("authorization");
  const headers: Record<string, string> = {};
  if (authorization) headers.Authorization = authorization;

  try {
    const upstream = await fetch(
      `${base}/public/businesses/${encodeURIComponent(slug)}/qr`,
      authorization
        ? { headers, cache: "no-store" }
        : { headers, next: { revalidate: 86400 } },
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
        "Cache-Control": authorization ? "private, no-store" : CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("QR service unavailable", {
      status: 502,
      headers: { "Cache-Control": "public, s-maxage=30" },
    });
  }
}
