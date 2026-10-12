// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_TIER_FALLBACK, type EntitlementPayload } from "@/lib/entitlements";

/**
 * Phase 5 «توضیحات کامل‌تر خدمات» (finding D) — the editor must reflect the
 * PLAN limit instead of a hard-coded 500, and it must show that limit plainly
 * so the user understands what the current plan allows. The server enforces
 * the same number, so this test only pins the UX mirror.
 */

const { getBusinessShowcases } = vi.hoisted(() => ({ getBusinessShowcases: vi.fn() }));

vi.mock("@/lib/businesses", () => ({
  getBusinessShowcases,
  uploadShowcase: vi.fn(),
  updateShowcase: vi.fn(),
  deleteShowcase: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ extractApiError: (error: unknown) => String(error) }));

import { ShowcasePanel } from "@/components/dashboard/ShowcasePanel";

function payload(overrides: Record<string, unknown>): EntitlementPayload {
  return {
    ...FREE_TIER_FALLBACK,
    plan: "پلن تست",
    capabilities: {
      ...FREE_TIER_FALLBACK.capabilities,
      showcase: true,
      max_showcases: 10,
      ...overrides,
    },
  };
}

describe("ShowcasePanel — plan-based description limit", () => {
  // The project has no jest-dom/auto-cleanup setup file, so unmount between
  // cases explicitly (otherwise the previous render's DOM leaks into queries).
  afterEach(() => cleanup());

  beforeEach(() => {
    getBusinessShowcases.mockReset();
    getBusinessShowcases.mockResolvedValue([]);
  });

  it("caps the editable description at the PLAN limit and shows a counter", async () => {
    render(<ShowcasePanel businessId={1} entitlements={payload({ max_description_length: 1200 })} />);

    const field = await screen.findByPlaceholderText(/حداکثر ۱۲۰۰ کاراکتر|حداکثر 1200 کاراکتر/);
    expect(field.getAttribute("maxlength")).toBe("1200");
    expect(screen.getByText(/0 از 1200 کاراکتر/)).toBeTruthy();
  });

  it("falls back to the free-tier limit when the payload carries no override", async () => {
    render(<ShowcasePanel businessId={1} entitlements={payload({ max_description_length: 500 })} />);

    const field = await screen.findByPlaceholderText(/حداکثر 500 کاراکتر/);
    expect(field.getAttribute("maxlength")).toBe("500");
  });

  it("removes the cap entirely when the plan explicitly grants an unlimited length", async () => {
    render(<ShowcasePanel businessId={1} entitlements={payload({ max_description_length: null })} />);

    const field = await screen.findByPlaceholderText(/بدون محدودیت طول/);
    expect(field.getAttribute("maxlength")).toBeNull();
    expect(screen.queryByText(/از 1200 کاراکتر/)).toBeNull();
  });
});
