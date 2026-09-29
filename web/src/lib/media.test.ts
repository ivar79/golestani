import { describe, expect, it } from "vitest";
import { mediaSrc, upstreamMediaUrl } from "./media";

/**
 * Card media must resolve SAME-ORIGIN so `html-to-image` can read pixels when
 * rasterizing an export. These are the pure-function guarantees behind that.
 */
describe("mediaSrc", () => {
  it("maps a stored system path to the same-origin proxy", () => {
    expect(mediaSrc("/storage/cards/images/logo.png")).toBe("/api/media/storage/cards/images/logo.png");
  });

  it("accepts the prefix without a leading slash", () => {
    expect(mediaSrc("storage/cards/images/logo.png")).toBe("/api/media/storage/cards/images/logo.png");
  });

  it("is idempotent for already-proxied paths", () => {
    // A document can never contain this, but double-resolution must not nest.
    expect(mediaSrc("/api/media/storage/cards/images/logo.png")).toBeNull();
  });

  it("refuses anything that is not a system storage path", () => {
    expect(mediaSrc("https://evil.test/logo.png")).toBeNull();
    expect(mediaSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(mediaSrc("blob:http://localhost/abc")).toBeNull();
    expect(mediaSrc("cards/images/logo.png")).toBeNull();
    expect(mediaSrc("/uploads/logo.png")).toBeNull();
  });

  it("refuses traversal and query/fragment tricks", () => {
    expect(mediaSrc("/storage/../secret")).toBeNull();
    expect(mediaSrc("/storage/%2e%2e/secret")).toBeNull();
    expect(mediaSrc("/storage/logo.png?x=1")).toBeNull();
    expect(mediaSrc("/storage/logo.png#f")).toBeNull();
    expect(mediaSrc("/storage/logo\\..\\secret")).toBeNull();
  });

  it("refuses empty and over-long values", () => {
    expect(mediaSrc("")).toBeNull();
    expect(mediaSrc("   ")).toBeNull();
    expect(mediaSrc(null)).toBeNull();
    expect(mediaSrc(undefined)).toBeNull();
    expect(mediaSrc(`/storage/${"a".repeat(500)}.png`)).toBeNull();
  });
});

describe("upstreamMediaUrl", () => {
  it("strips the /api suffix so storage is fetched from the app root", () => {
    expect(upstreamMediaUrl("https://api.example.test/api", "storage/a.png")).toBe(
      "https://api.example.test/storage/a.png",
    );
  });

  it("strips a versioned /api/v1 suffix too", () => {
    expect(upstreamMediaUrl("https://api.example.test/api/v1", "storage/a.png")).toBe(
      "https://api.example.test/storage/a.png",
    );
  });

  it("keeps a subdirectory deployment prefix", () => {
    expect(upstreamMediaUrl("https://example.test/backend/api", "storage/a.png")).toBe(
      "https://example.test/backend/storage/a.png",
    );
  });

  it("refuses a missing base, traversal and non-storage paths", () => {
    expect(upstreamMediaUrl("", "storage/a.png")).toBeNull();
    expect(upstreamMediaUrl("not-a-url", "storage/a.png")).toBeNull();
    expect(upstreamMediaUrl("https://api.example.test/api", "storage/../secret")).toBeNull();
    expect(upstreamMediaUrl("https://api.example.test/api", "cards/a.png")).toBeNull();
  });
});
