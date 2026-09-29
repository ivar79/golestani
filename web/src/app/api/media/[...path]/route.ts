import { NextResponse, type NextRequest } from "next/server";
import { upstreamMediaUrl } from "@/lib/media";

/**
 * Same-origin media proxy for card document assets.
 *
 * Card documents store `/storage/…` paths; those files are served by the API
 * origin. Proxying them through this route makes them same-origin, which is
 * what lets `html-to-image` rasterize image layers for export (cross-origin
 * pixels are unreadable without CORS, and static storage files never reach
 * Laravel's CORS middleware).
 *
 * Strictness: only `storage/…` image paths are proxied, traversal is refused,
 * non-image upstream content types are rejected, and responses are cached hard
 * because card media is content-addressed by an immutable stored filename.
 */

const ALLOWED_PATH = /^storage\/[A-Za-z0-9._\-/]+$/;
const CACHE_CONTROL = "public, max-age=0, s-maxage=31536000, stale-while-revalidate=604800";
const SHORT_CACHE = "public, s-maxage=30";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const relative = (path ?? []).join("/");

  if (!ALLOWED_PATH.test(relative) || relative.includes("..")) {
    return new NextResponse("Invalid media path", { status: 400 });
  }

  const upstream = upstreamMediaUrl(process.env.NEXT_PUBLIC_API_URL ?? "", relative);
  if (!upstream) {
    return new NextResponse("NEXT_PUBLIC_API_URL is not configured", { status: 502 });
  }

  try {
    const response = await fetch(upstream, { headers: { Accept: "image/*" } });

    if (!response.ok) {
      return new NextResponse(`Upstream responded ${response.status}`, {
        status: response.status,
        headers: { "Cache-Control": SHORT_CACHE },
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    // Only images are proxied: a document can never point at something else,
    // and this stops the route being used as a general-purpose fetch relay.
    if (!contentType.startsWith("image/")) {
      return new NextResponse("Unsupported media type", {
        status: 415,
        headers: { "Cache-Control": SHORT_CACHE },
      });
    }

    const body = await response.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Media service unavailable", {
      status: 502,
      headers: { "Cache-Control": SHORT_CACHE },
    });
  }
}
