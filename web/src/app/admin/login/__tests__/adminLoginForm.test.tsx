// @vitest-environment jsdom
/**
 * Admin sign-in form contract (regressions reported 2026-10-09):
 *
 *   1. the identifier field advertised a real-looking admin credential
 *      ("09000000000 یا admin@golestani.ir") — a username/identifier hint that
 *      must not ship, and placeholders are not labels anyway;
 *   2. the submit button was `disabled` unless React state held both fields, so
 *      browser / password-manager autofill (which can fill the DOM without
 *      firing onChange) left the user unable to submit until they clicked.
 *
 * Standards followed: <label for> + id per input, `autocomplete="username"` /
 * `"current-password"`, and a submit button that is disabled only while a
 * request is in flight (web.dev sign-in form best practices).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const loginAdminMock = vi.hoisted(() => vi.fn());
const pushMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false, loginAdmin: loginAdminMock }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children }: { children?: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@/lib/api", () => ({
  extractApiError: (error: unknown) => (error instanceof Error ? error.message : "خطای نامشخص"),
}));

import AdminLoginPage from "../page";

beforeEach(() => {
  vi.clearAllMocks();
  loginAdminMock.mockResolvedValue(undefined);
});

afterEach(cleanup);

function fields() {
  return {
    identifier: screen.getByLabelText("شماره موبایل یا ایمیل مدیر") as HTMLInputElement,
    password: screen.getByLabelText("رمز عبور مدیریت") as HTMLInputElement,
    submit: screen.getByRole("button", { name: "ورود به پنل مدیریت" }) as HTMLButtonElement,
  };
}

describe("admin login form", () => {
  it("never advertises a real-looking admin identifier", () => {
    const { container } = render(<AdminLoginPage />);

    expect(container.innerHTML).not.toContain("golestani.ir");
    expect(container.innerHTML).not.toContain("09000000000");
    const { identifier, password } = fields();
    expect(identifier.getAttribute("placeholder")).toBeNull();
    expect(password.getAttribute("placeholder")).toBeNull();
  });

  it("exposes the standard autofill contract", () => {
    render(<AdminLoginPage />);
    const { identifier, password } = fields();

    expect(identifier.getAttribute("name")).toBe("username");
    expect(identifier.getAttribute("autocomplete")).toBe("username");
    expect(password.getAttribute("name")).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
  });

  it("keeps the submit button usable before any field is filled", () => {
    render(<AdminLoginPage />);

    const { submit, identifier, password } = fields();
    expect(identifier.value).toBe("");
    expect(password.value).toBe("");
    expect(submit.disabled).toBe(false);
  });

  it("submits an autofilled value that never fired onChange", async () => {
    render(<AdminLoginPage />);
    const { identifier, password, submit } = fields();

    // Browser autofill writes the DOM value directly — no React onChange.
    identifier.value = "۰۹۱۲۳۴۵۶۷۸۹";
    password.value = "super-secret";

    fireEvent.click(submit);

    await waitFor(() => expect(loginAdminMock).toHaveBeenCalledTimes(1));
    // Persian digits are normalized before submit (same contract as the backend).
    expect(loginAdminMock).toHaveBeenCalledWith("09123456789", "super-secret");
    expect(pushMock).toHaveBeenCalledWith("/admin");
  });

  it("explains what is missing instead of silently doing nothing", async () => {
    render(<AdminLoginPage />);

    fireEvent.click(fields().submit);

    expect(await screen.findByRole("alert")).toHaveProperty("textContent");
    expect(screen.getByRole("alert").textContent).toContain("رمز عبور را وارد کنید");
    expect(loginAdminMock).not.toHaveBeenCalled();
  });
});
