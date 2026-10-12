import { describe, expect, it } from "vitest";
import { isAdvertisementVisible, visibleAdsFor, type Advertisement } from "./ads";

/**
 * Phase 5 moderation freshness (finding 5): the public ad payload can arrive
 * from an edge/client cache that was filled BEFORE a moderation change, so the
 * UI re-checks the same rules the server applies. These tests pin that mirror —
 * including the day-granular schedule semantics that must match `whereDate()`.
 */

const NOW = new Date(2026, 9, 11, 12, 0, 0); // local noon — day boundaries are local on purpose

/** A LOCAL midnight N days from the fixture date (timezone-proof test data). */
const localDay = (dayOffset: number) => new Date(2026, 9, 11 + dayOffset, 0, 0, 0).toISOString();

function ad(overrides: Partial<Advertisement> = {}): Advertisement {
  return {
    id: 1,
    business_id: 10,
    slot: "home_banner",
    title: "آگهی",
    target_url: "https://example.com",
    image_path: null,
    status: "approved",
    starts_at: null,
    ends_at: null,
    admin_note: null,
    ...overrides,
  };
}

describe("isAdvertisementVisible", () => {
  it("accepts an approved ad of the same slot with no schedule window", () => {
    expect(isAdvertisementVisible(ad(), "home_banner", NOW)).toBe(true);
  });

  it("refuses anything that is not approved in the payload", () => {
    for (const status of ["pending", "rejected", "suspended"] as const) {
      expect(isAdvertisementVisible(ad({ status }), "home_banner", NOW)).toBe(false);
    }
  });

  it("refuses an ad that belongs to another placement", () => {
    expect(isAdvertisementVisible(ad({ slot: "search_top" }), "home_banner", NOW)).toBe(false);
  });

  it("refuses a future ad and an ad whose window has ended", () => {
    expect(isAdvertisementVisible(ad({ starts_at: localDay(1) }), "home_banner", NOW)).toBe(false);
    expect(isAdvertisementVisible(ad({ ends_at: localDay(-2) }), "home_banner", NOW)).toBe(false);
  });

  it("still accepts an ad whose window starts or ends TODAY (day-granular, like the server)", () => {
    expect(isAdvertisementVisible(ad({ starts_at: localDay(0) }), "home_banner", NOW)).toBe(true);
    expect(isAdvertisementVisible(ad({ ends_at: localDay(0) }), "home_banner", NOW)).toBe(true);
  });
});

describe("visibleAdsFor", () => {
  it("keeps only eligible rows and never more than four positions", () => {
    const payload = [
      ad({ id: 1, business_id: 1 }),
      ad({ id: 2, business_id: 2 }),
      ad({ id: 3, business_id: 3 }),
      ad({ id: 4, business_id: 4 }),
      ad({ id: 5, business_id: 5 }),
      ad({ id: 6, business_id: 6, status: "pending" }),
    ];

    const visible = visibleAdsFor(payload, "home_banner", NOW);

    expect(visible.map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
  });

  it("gives one business at most one position even in a stale multi-ad payload", () => {
    const payload = [
      ad({ id: 1, business_id: 7 }),
      ad({ id: 2, business_id: 7 }),
      ad({ id: 3, business_id: 7 }),
      ad({ id: 4, business_id: 8 }),
      ad({ id: 5, business_id: 9 }),
    ];

    expect(visibleAdsFor(payload, "home_banner", NOW).map((entry) => entry.id)).toEqual([1, 4, 5]);
  });

  it("returns nothing when every row is ineligible", () => {
    const payload = [ad({ status: "rejected" }), ad({ ends_at: localDay(-30) })];

    expect(visibleAdsFor(payload, "home_banner", NOW)).toEqual([]);
  });
});
