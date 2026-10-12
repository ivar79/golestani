import { NextResponse, type NextRequest } from "next/server";

/**
 * VERCEL CRON → DEPLOYED API EXPIRY SWEEP (Phase 5 finding A).
 *
 * The Laravel API runs on Render's free web-service plan, which has no process
 * executing Laravel's scheduler (and Render Cron Job services start at
 * $1/month), so the deployed environment needs an outside timer. Vercel Cron
 * is included in every Vercel plan, the frontend already deploys here, and it
 * runs this handler — which calls the token-guarded Laravel endpoint that runs
 * exactly the same sweep as `php artisan subscriptions:expire`.
 *
 * Scheduled in `web/vercel.json` (daily, 00:10 UTC).
 *
 * SECURITY
 *  - Vercel signs cron invocations automatically: when CRON_SECRET is set on
 *    the project, Vercel sends `Authorization: Bearer $CRON_SECRET`. We verify
 *    it before doing any work, so the route is not a public trigger.
 *  - Fail closed: without CRON_SECRET (route protection) or CRON_TOKEN (the
 *    shared secret the API requires) the handler answers 404 and never calls
 *    the API. Nothing here is reachable as an open proxy.
 *  - The shared secret stays server-side; it is never echoed or logged, and
 *    the response carries only the number of settled rows — no customer data.
 *  - The sweep is idempotent, so a retry or a double trigger is harmless.
 */

export const dynamic = "force-dynamic";

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const cronToken = process.env.CRON_TOKEN ?? "";
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

  // Unconfigured => the route does not exist as far as callers are concerned.
  if (!cronSecret || !cronToken || !base) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (presented === "" || !constantTimeEquals(presented, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const upstream = await fetch(`${base}/internal/cron/expire-subscriptions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Cron-Token": cronToken,
      },
      cache: "no-store",
    });

    const payload = (await upstream.json().catch(() => null)) as
      | { ok?: boolean; expired?: number }
      | null;

    if (!upstream.ok || payload?.ok !== true) {
      // Surface the status only — never the upstream body or the token.
      return NextResponse.json(
        { error: `Upstream responded ${upstream.status}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, expired: payload.expired ?? 0 });
  } catch {
    return NextResponse.json({ error: "Upstream unreachable" }, { status: 502 });
  }
}
