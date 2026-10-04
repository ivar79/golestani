/**
 * QR asset registry regressions.
 *
 * The QR of a NOT-YET-APPROVED business is owner-only on the API, so the
 * anonymous same-origin proxy answers 404 and the layer used to show its empty
 * placeholder — the "QR tool does nothing" report. The registry lets an owner
 * session register the authenticated data URL, which the renderer AND the
 * exporter consult FIRST, while public pages keep the cached proxy path
 * untouched.
 */
import { afterEach, describe, expect, it } from "vitest";
import { clearQrAssets, qrSlug, qrSrcFor, registerQrAsset, registeredQrSrc } from "../qrAssets";

afterEach(() => clearQrAssets());

describe("qrSrcFor", () => {
  it("returns the cached same-origin proxy for a payload nobody registered", () => {
    expect(qrSrcFor("my-shop")).toBe("/api/qr/my-shop");
  });

  it("percent-encodes the slug so a payload can never break out of the path", () => {
    expect(qrSrcFor("a b/c?d")).toBe("/api/qr/a%20b%2Fc%3Fd");
  });

  it("returns null for an empty payload (the honest placeholder state)", () => {
    expect(qrSrcFor("")).toBeNull();
    expect(qrSrcFor("   ")).toBeNull();
    expect(qrSrcFor(null)).toBeNull();
    expect(qrSrcFor(undefined)).toBeNull();
  });

  it("prefers the owner-session asset once it is registered", () => {
    registerQrAsset("my-shop", "data:image/svg+xml;base64,AAAA");
    expect(qrSrcFor("my-shop")).toBe("data:image/svg+xml;base64,AAAA");
    expect(registeredQrSrc("my-shop")).toBe("data:image/svg+xml;base64,AAAA");
    // A different payload keeps the public proxy — no cross-business leakage.
    expect(qrSrcFor("other-shop")).toBe("/api/qr/other-shop");
  });

  it("ignores empty registrations and trims the payload it keys on", () => {
    registerQrAsset("", "data:image/svg+xml;base64,AAAA");
    registerQrAsset("my-shop", "");
    expect(registeredQrSrc("my-shop")).toBeUndefined();
    registerQrAsset("  my-shop  ", "data:image/svg+xml;base64,BBBB");
    expect(qrSrcFor("my-shop")).toBe("data:image/svg+xml;base64,BBBB");
  });

  it("normalizes the slug the same way for keys and lookups", () => {
    expect(qrSlug("  my-shop ")).toBe("my-shop");
    expect(qrSlug(null)).toBe("");
  });
});
