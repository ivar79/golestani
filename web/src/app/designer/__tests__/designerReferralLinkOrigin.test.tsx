// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://designer.example.com"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
const authMock = vi.hoisted(() => ({
  user: { id: 17, phone: "09120000000" },
  loading: false,
}));
const listBusinessesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  default: apiMock,
  extractApiError: (error: unknown) => (error instanceof Error ? error.message : "خطای نامشخص"),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authMock }));
vi.mock("@/lib/businesses", () => ({ listBusinesses: listBusinessesMock }));
vi.mock("@/components/layout/AppTaskbar", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import DesignerPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
  authMock.user = { id: 17, phone: "09120000000" };
  authMock.loading = false;
  listBusinessesMock.mockResolvedValue([]);
});

afterEach(cleanup);

describe("designer referral link origin", () => {
  it("shows the site's actual address instead of a hard-coded localhost fallback", async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === "/designer/program/status") {
        return Promise.resolve({ data: { designer_status: "approved", program_enabled: true } });
      }
      if (url === "/designer/profile") {
        return Promise.resolve({
          data: {
            display_name: "طراح آزمایشی",
            slug: "designer-test",
            referral_code: "DES-TEST",
            attributed_businesses_count: 0,
            portfolios: [],
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<DesignerPage />);

    expect(await screen.findByDisplayValue("https://designer.example.com/dashboard?ref=DES-TEST")).toBeTruthy();
  });
});
