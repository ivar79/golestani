// @vitest-environment jsdom
/**
 * Component-level verification of the Card Studio UI gate on the REAL
 * card-maker page:
 *
 *   - a refused business (not an approved designer / no capability) can never
 *     OPEN the layered workspace — not even when a grandfathered layered
 *     design already exists (the old bug: only the save 403'd);
 *   - an ordinary user without the editor capability keeps a disabled entry;
 *   - an approved designer whose OWN business holds the entitlement opens the
 *     full studio normally (click, and auto-open for an existing design).
 *
 * These assertions are UX-only: the server re-authorizes every Level B write,
 * so a passing mirror never grants access.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

// --- module mocks (hoisted by vitest) ---------------------------------------

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  default: apiMock,
  extractApiError: (err: unknown) => (err instanceof Error ? err.message : "خطا"),
  // retryTransient just forwards to run(); tests exercise the happy path, and
  // the retry/backoff behaviour has its own coverage in retryTransient.test.ts.
  retryTransient: <T,>(run: () => Promise<T>) => run(),
}));

const listBusinessesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/businesses", () => ({ listBusinesses: listBusinessesMock }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1 }, loading: false, token: "test-token" }),
}));

vi.mock("@/lib/phase4", () => ({ downloadPrintFile: vi.fn() }));
vi.mock("@/components/layout/AppTaskbar", () => ({ default: () => null }));
vi.mock("@/components/cards/CardCanvas", () => ({
  default: () => <div data-testid="legacy-canvas" />,
}));
vi.mock("@/components/cards/CardExportMenu", () => ({
  default: () => <div data-testid="export-menu" />,
}));
// The layered studio is reached ONLY through this dynamic import.
vi.mock("next/dynamic", () => ({
  default: () => () => <div data-testid="card-studio" />,
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/card-maker",
}));

import CardMakerPage from "../page";
import { FREE_TIER_FALLBACK, type EntitlementPayload, type StudioStatus } from "@/lib/entitlements";
import type { Business } from "@/lib/businesses";

// --- fixtures ----------------------------------------------------------------

const business = { id: 63, name: "کسب‌وکار تست", slug: "test-biz" } as unknown as Business;

/** A structurally valid layered document (what a grandfathered card carries). */
const SAMPLE_DOC = {
  version: 1,
  artboard: { width: 1050, height: 600 },
  background: "#ffffff",
  layers: [],
};

const BLOCKED_NOT_APPROVED: StudioStatus = {
  enforced: true,
  allowed: false,
  bypass: false,
  reason: "not_approved",
  designer_status: "none",
  capability: true,
};

const BLOCKED_NO_CAPABILITY: StudioStatus = {
  enforced: true,
  allowed: false,
  bypass: false,
  reason: "no_capability",
  designer_status: "approved",
  capability: false,
};

const ALLOWED_DESIGNER: StudioStatus = {
  enforced: true,
  allowed: true,
  bypass: false,
  reason: "designer",
  designer_status: "approved",
  capability: true,
};

function entitlements(over: Record<string, unknown> = {}): EntitlementPayload {
  return {
    plan: "حرفه‌ای",
    source: "snapshot",
    capabilities: {
      ...FREE_TIER_FALLBACK.capabilities,
      card_editor: true,
      print_file: true,
      ...over,
    },
  };
}

function cardPayload(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    template: "classic",
    theme: "navy",
    font_size: "medium",
    font_family: "sans",
    has_print_file: false,
    design_json: null,
    front_image: null,
    locked: {
      template: [],
      theme: [],
      font_family: [],
      export_format: [],
      print_file: false,
      max_cards: null,
      grandfathered: { template: null, theme: null, font_family: null },
    },
    ...over,
  };
}

function mockCard(payload: Record<string, unknown>) {
  listBusinessesMock.mockResolvedValue([business]);
  apiMock.get.mockResolvedValue({ data: payload });
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no ResizeObserver; the page measures its preview stage with one.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
});

// --- tests -------------------------------------------------------------------

describe("card-maker Studio UI gate", () => {
  it("shows business-list API failures as errors instead of claiming the account has no business", async () => {
    listBusinessesMock.mockRejectedValue(new Error("دسترسی غیرمجاز است."));

    render(<CardMakerPage />);

    expect(await screen.findByText("دریافت کسب‌وکارها ناموفق بود")).toBeTruthy();
    expect(screen.getByText("دسترسی غیرمجاز است.")).toBeTruthy();
    expect(screen.queryByText("کسب‌وکاری یافت نشد")).toBeNull();
  });

  it("refused business with a grandfathered layered card: entry stays disabled and the studio never opens", async () => {
    mockCard(
      cardPayload({
        design_json: SAMPLE_DOC,
        entitlements: entitlements(),
        studio: BLOCKED_NOT_APPROVED,
      }),
    );

    render(<CardMakerPage />);

    // The reason sentence is the signal that the server decision landed.
    await waitFor(() => expect(screen.getByText(/فقط برای طراحان تأییدشده فعال است/)).toBeTruthy());

    const toggle = screen.getByRole("button", { name: "ویژهٔ طراحان تأییدشده" }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    // An existing design must NOT flip the page into editor mode.
    expect(screen.queryByRole("button", { name: "بازگشت به کارت‌ساز" })).toBeNull();
    expect(screen.queryByTestId("card-studio")).toBeNull();
    // Level A stays available.
    expect(screen.getByTestId("legacy-canvas")).toBeTruthy();
  });

  it("ordinary user without the capability: entry stays disabled and no studio mounts", async () => {
    mockCard(
      cardPayload({
        entitlements: entitlements({ card_editor: false }),
        studio: BLOCKED_NO_CAPABILITY,
      }),
    );

    render(<CardMakerPage />);

    await waitFor(() => {
      const toggle = screen.getByRole("button", { name: "اشتراک لازم است" }) as HTMLButtonElement;
      expect(toggle.disabled).toBe(true);
    });
    expect(screen.queryByTestId("card-studio")).toBeNull();
  });

  it("approved designer on the same-business entitlement: clicking opens the full studio", async () => {
    mockCard(
      cardPayload({
        entitlements: entitlements(),
        studio: ALLOWED_DESIGNER,
      }),
    );

    render(<CardMakerPage />);

    const toggle = await screen.findByRole("button", { name: "ورود به استودیو" });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(toggle);

    expect(await screen.findByTestId("card-studio")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "استودیوی طراحی" })).toBeTruthy();
  });

  it("approved designer with an existing layered card: the studio auto-opens (authorized flow preserved)", async () => {
    mockCard(
      cardPayload({
        design_json: SAMPLE_DOC,
        entitlements: entitlements(),
        studio: ALLOWED_DESIGNER,
      }),
    );

    render(<CardMakerPage />);

    expect(await screen.findByTestId("card-studio")).toBeTruthy();
  });
});
