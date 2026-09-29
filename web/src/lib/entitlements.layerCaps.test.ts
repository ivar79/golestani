import { describe, expect, it } from "vitest";
import {
  allowedLayerKinds,
  layerKindAllowed,
  layerLimitState,
  type CapabilityMap,
} from "@/lib/entitlements";

/**
 * Phase 4 capability hardening — pure layer-capability helpers.
 * These mirror the backend contract (card_layer_kinds / max_layers) and are
 * UX-only: the server re-checks every save. Absent keys behave like the
 * pre-hardening allow-all UI so stale payloads never brick the editor.
 */
describe("layerKindAllowed", () => {
  it("grants a listed kind", () => {
    const caps: CapabilityMap = { card_layer_kinds: ["text", "qr"] };
    expect(layerKindAllowed(caps, "text")).toBe(true);
    expect(layerKindAllowed(caps, "qr")).toBe(true);
  });

  it("denies an unlisted kind", () => {
    const caps: CapabilityMap = { card_layer_kinds: ["text", "qr"] };
    expect(layerKindAllowed(caps, "image")).toBe(false);
    expect(layerKindAllowed(caps, "badge")).toBe(false);
    expect(layerKindAllowed(caps, "shape")).toBe(false);
    expect(layerKindAllowed(caps, "path")).toBe(false);
  });

  it("treats an absent key as allow-all (pre-hardening payload)", () => {
    expect(layerKindAllowed({}, "image")).toBe(true);
    expect(layerKindAllowed({ unrelated: true }, "badge")).toBe(true);
  });

  it("denies every kind on an explicitly empty list", () => {
    const caps: CapabilityMap = { card_layer_kinds: [] };
    expect(layerKindAllowed(caps, "text")).toBe(false);
  });
});

describe("allowedLayerKinds", () => {
  it("returns the granted list", () => {
    const caps: CapabilityMap = { card_layer_kinds: ["text", "shape"] };
    expect(allowedLayerKinds(caps)).toEqual(["text", "shape"]);
  });

  it("falls back to the full editor universe when absent", () => {
    expect(allowedLayerKinds({})).toEqual(["text", "image", "qr", "badge", "shape", "path"]);
  });
});

describe("layerLimitState", () => {
  it("reports reached at the cap", () => {
    const caps: CapabilityMap = { max_layers: 3 };
    expect(layerLimitState(caps, 3)).toEqual({ state: "reached" });
    expect(layerLimitState(caps, 5)).toEqual({ state: "reached" });
  });

  it("reports remaining below the cap", () => {
    const caps: CapabilityMap = { max_layers: 3 };
    expect(layerLimitState(caps, 2)).toEqual({ state: "ok", remaining: 1 });
    expect(layerLimitState(caps, 0)).toEqual({ state: "ok", remaining: 3 });
  });

  it("treats null as unlimited", () => {
    const caps: CapabilityMap = { max_layers: null };
    expect(layerLimitState(caps, 999)).toEqual({ state: "ok", remaining: null });
  });

  it("treats an absent key as unlimited (pre-hardening payload)", () => {
    expect(layerLimitState({}, 60)).toEqual({ state: "ok", remaining: null });
  });
});
