// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

/**
 * Vercel Cron handler (Phase 5 finding A): it must be impossible to use this
 * route as an open proxy that triggers writes on the API.
 *  - unconfigured (no CRON_SECRET / CRON_TOKEN / API base) => 404, no upstream call
 *  - wrong/missing Vercel bearer => 401, no upstream call
 *  - correct bearer => POST to the token-guarded Laravel endpoint with the
 *    shared secret, and the response exposes only the settled-row count.
 */

const OLD_ENV = { ...process.env };

function request(authorization?: string): Request {
  return new Request("https://app.example/api/cron/expire-subscriptions", {
    headers: authorization ? { authorization } : {},
  });
}

const originalFetch = global.fetch;

beforeEach(() => {
  process.env = { ...OLD_ENV };
  delete process.env.CRON_SECRET;
  delete process.env.CRON_TOKEN;
  delete process.env.NEXT_PUBLIC_API_URL;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...OLD_ENV };
  vi.restoreAllMocks();
});

describe("Vercel cron: expire subscriptions", () => {
  it("is not reachable while any of its secrets is unconfigured", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    process.env.NEXT_PUBLIC_API_URL = "https://api.example/api";
    process.env.CRON_SECRET = "vercel-secret";
    // CRON_TOKEN deliberately missing.

    const response = await GET(request("Bearer vercel-secret") as never);

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a wrong or missing Vercel bearer before touching the API", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    process.env.NEXT_PUBLIC_API_URL = "https://api.example/api";
    process.env.CRON_SECRET = "vercel-secret";
    process.env.CRON_TOKEN = "shared-token";

    expect((await GET(request() as never)).status).toBe(401);
    expect((await GET(request("Bearer nope") as never)).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs to the token-guarded sweep endpoint and reports the settled count", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, expired: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    process.env.NEXT_PUBLIC_API_URL = "https://api.example/api";
    process.env.CRON_SECRET = "vercel-secret";
    process.env.CRON_TOKEN = "shared-token";

    const response = await GET(request("Bearer vercel-secret") as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, expired: 2 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example/api/internal/cron/expire-subscriptions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Cron-Token"]).toBe("shared-token");
  });

  it("reports an upstream failure without leaking the upstream body", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "internal detail", secret: "leak" }), { status: 403 }),
    ) as unknown as typeof fetch;

    process.env.NEXT_PUBLIC_API_URL = "https://api.example/api";
    process.env.CRON_SECRET = "vercel-secret";
    process.env.CRON_TOKEN = "shared-token";

    const response = await GET(request("Bearer vercel-secret") as never);

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).not.toContain("internal detail");
    expect(body).not.toContain("shared-token");
  });
});
