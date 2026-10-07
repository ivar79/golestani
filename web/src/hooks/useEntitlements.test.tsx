// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_TIER_FALLBACK } from "@/lib/entitlements";
import type { EntitlementsResponse } from "./useEntitlements";
import { useEntitlements } from "./useEntitlements";

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock("@/lib/api", () => ({ default: { get: apiGet } }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("useEntitlements", () => {
  it("does not expose the previous business entitlements while another business loads", async () => {
    const paidEntitlements = {
      ...FREE_TIER_FALLBACK,
      capabilities: { ...FREE_TIER_FALLBACK.capabilities, ads: true },
    };
    apiGet.mockResolvedValueOnce({
      data: { entitlements: paidEntitlements, subscription: null },
    });

    const { result, rerender } = renderHook(
      ({ businessId }: { businessId: number }) => useEntitlements(businessId),
      { initialProps: { businessId: 63 } },
    );

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.entitlements.capabilities.ads).toBe(true);

    let resolveNext!: (value: { data: EntitlementsResponse }) => void;
    apiGet.mockImplementationOnce(
      () => new Promise((resolve) => { resolveNext = resolve; }),
    );
    rerender({ businessId: 84 });

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(result.current.ready).toBe(false);
    expect(result.current.entitlements).toEqual(FREE_TIER_FALLBACK);
    expect(result.current.subscription).toBeNull();

    await act(async () => {
      resolveNext({
        data: { entitlements: FREE_TIER_FALLBACK, subscription: null },
      });
    });
    await waitFor(() => expect(result.current.ready).toBe(true));
  });
});
