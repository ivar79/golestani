// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  extractApiError: (error: unknown) => error instanceof Error ? error.message : "خطای نامشخص",
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

describe("designer dashboard", () => {
  it("offers a direct dashboard link and loads profile only for an approved designer", async () => {
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

    expect(await screen.findByRole("heading", { name: "مدیریت حساب طراح" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /ورود به داشبورد/ }).getAttribute("href")).toBe("/dashboard");
    expect(screen.getByDisplayValue(`${window.location.origin}/dashboard?ref=DES-TEST`)).toBeTruthy();
    expect(apiMock.get).toHaveBeenCalledWith("/designer/profile");
  });

  it("shows pending approval clearly and does not request the protected designer profile", async () => {
    apiMock.get.mockResolvedValue({
      data: { designer_status: "pending", program_enabled: true },
    });

    render(<DesignerPage />);

    expect(await screen.findByRole("heading", { name: "درخواست شما برای عضویت در حال بررسی است" })).toBeTruthy();
    expect(screen.getByText("در انتظار بررسی")).toBeTruthy();
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    expect(apiMock.get).toHaveBeenCalledWith("/designer/program/status");
    expect(screen.getByRole("link", { name: /ورود به داشبورد/ }).getAttribute("href")).toBe("/dashboard");
  });

  it("submits an application only when the program is enabled", async () => {
    apiMock.get.mockResolvedValue({
      data: { designer_status: "none", program_enabled: true },
    });
    apiMock.post.mockResolvedValue({ data: { designer_status: "pending" } });

    render(<DesignerPage />);

    fireEvent.click(await screen.findByRole("button", { name: "ثبت درخواست عضویت" }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/designer/program/request"));
    expect(await screen.findByText("درخواست عضویت ثبت شد و برای بررسی ارسال شد.")).toBeTruthy();
  });
});
