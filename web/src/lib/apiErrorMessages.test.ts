import { describe, expect, it } from "vitest";
import { AxiosError } from "axios";
import { extractApiError } from "./api";

/**
 * The Persian-UI contract for API failures: framework strings (Laravel
 * "Too Many Attempts." / "Server Error", axios "Request failed with status code
 * 403") must never reach the user. Evidence 2026-10-09: the /businesses throttle
 * bucket returned 429 after ~30 calls/min, and the card-save bar rendered raw
 * axios text "timeout of 15000ms exceeded".
 */
describe("extractApiError", () => {
  it("localizes a 429 instead of leaking Laravel's 'Too Many Attempts.'", () => {
    const error = new AxiosError("Request failed with status code 429");
    error.response = { status: 429, data: { message: "Too Many Attempts." } } as never;

    const message = extractApiError(error);

    expect(message).not.toMatch(/Too Many Attempts/i);
    expect(message).toContain("درخواست‌های زیادی");
    // Regression (measured live 2026-10-12): the send-otp bucket is 3 per
    // 10 MINUTES, but the copy promised «حدود یک دقیقه», so users retried in
    // a minute and were refused again — they read it as a broken login.
    expect(message).toContain("۱۰ دقیقه");
    expect(message).not.toContain("یک دقیقه");
  });

  it("states the server's own wait when the 429 carries Retry-After", () => {
    const error = new AxiosError("Request failed with status code 429");
    error.response = {
      status: 429,
      data: { message: "Too Many Attempts." },
      headers: { "retry-after": "600" },
    } as never;

    expect(extractApiError(error)).toContain("۱۰ دقیقه");

    // The card-write bucket is per-MINUTE, so the same mapper must not promise
    // a ten-minute wait for a bucket that clears in seconds.
    const short = new AxiosError("Request failed with status code 429");
    short.response = {
      status: 429,
      data: { message: "Too Many Attempts." },
      headers: { "retry-after": "45" },
    } as never;

    expect(extractApiError(short)).toContain("۴۵ ثانیه");
  });

  it("localizes a 5xx instead of leaking 'Server Error'", () => {
    const error = new AxiosError("Request failed with status code 500");
    error.response = { status: 500, data: { message: "Server Error" } } as never;

    const message = extractApiError(error);

    expect(message).not.toMatch(/Server Error/i);
    expect(message).toContain("سرور");
  });

  it("keeps the server's own Persian message (e.g. entitlement 403)", () => {
    const error = new AxiosError("Request failed with status code 403");
    error.response = {
      status: 403,
      data: { message: "برای استفاده از این امکانات، اشتراک فعال لازم است." },
    } as never;

    expect(extractApiError(error)).toBe("برای استفاده از این امکانات، اشتراک فعال لازم است.");
  });

  it("keeps validation messages", () => {
    const error = new AxiosError("Request failed with status code 422");
    error.response = {
      status: 422,
      data: { errors: { title: ["عنوان الزامی است."] } },
    } as never;

    expect(extractApiError(error)).toBe("عنوان الزامی است.");
  });

  it("localizes a timeout", () => {
    const error = new AxiosError("timeout of 15000ms exceeded", AxiosError.ECONNABORTED);

    expect(extractApiError(error)).toContain("زمان پاسخ سرور");
  });

  it("never returns axios' English default for an unanswered body", () => {
    const error = new AxiosError("Request failed with status code 403");
    error.response = { status: 403, data: {} } as never;

    const message = extractApiError(error);

    expect(message).not.toMatch(/Request failed/i);
    expect(message).toContain("درخواست ناموفق بود");
  });
});
