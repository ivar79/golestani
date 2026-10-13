// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

/**
 * Card-media proxy contract (regression guard for "the uploaded image shows as
 * an empty grey rounded box").
 *
 * Every surface that displays card artwork — the editor stage, the export
 * rasterizer and the public card — renders `mediaSrc(layer.src)`, i.e. this
 * route. An uploaded image must therefore come back from here as real image
 * bytes: when the API origin refuses `/storage/...` (the reported cause: a
 * public/storage symlink that did not resolve inside the API container, so
 * Laravel's signed local-disk route answered 403), the `<img>` fails, the
 * renderer draws its placeholder, and the user sees an empty box instead of
 * their logo.
 *
 * These assertions pin both halves: the happy path is a 200 with the upstream
 * image body, and a refusal is never laundered into something the renderer would
 * mistake for an image.
 */

const OLD_ENV = { ...process.env };
const originalFetch = global.fetch;

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

beforeEach(() => {
  process.env = { ...OLD_ENV };
  process.env.NEXT_PUBLIC_API_URL = "https://api.example/api";
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...OLD_ENV };
  vi.restoreAllMocks();
});

describe("GET /api/media/[...path]", () => {
  it("serves an uploaded card image same-origin with the upstream bytes", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(bytes, { status: 200, headers: { "content-type": "image/png" } }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const response = await GET({} as never, ctx(["storage", "cards", "images", "logo.png"]));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

    // The document path is the API origin's static storage path — the route maps
    // `/api/media/storage/…` back onto it.
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example/storage/cards/images/logo.png");
  });

  it("propagates an upstream refusal instead of faking an image", async () => {
    // The exact shape of the reported failure: the API origin answered 403 for
    // an existing upload. The proxy must not turn that into a 200.
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;

    const response = await GET({} as never, ctx(["storage", "cards", "images", "logo.png"]));

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).not.toContain("image/");
  });

  it("refuses the private template namespace, which needs an owner session", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const response = await GET({} as never, ctx(["storage", "templates", "users", "9", "x.png"]));

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is not usable as a general-purpose relay", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    // Traversal, a non-image type and a missing API base are all refused before
    // any upstream request is made.
    expect((await GET({} as never, ctx(["storage", "..", "etc", "passwd"]))).status).toBe(400);
    expect((await GET({} as never, ctx(["etc", "passwd"]))).status).toBe(400);

    delete process.env.NEXT_PUBLIC_API_URL;
    expect((await GET({} as never, ctx(["storage", "cards", "images", "logo.png"]))).status).toBe(502);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
