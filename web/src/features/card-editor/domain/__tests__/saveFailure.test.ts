import { describe, expect, it } from "vitest";
import { AxiosError } from "axios";
import { describeSaveFailure, isAmbiguousSaveFailure, saveFailureDiagnostics } from "../saveFailure";

/**
 * The card-save failure contract.
 *
 * Regression under test (measured live 2026-10-09): the studio save bar showed
 * the raw axios string "timeout of 15000ms exceeded" in the Persian UI, and a
 * timed-out write is ambiguous — the server may have applied it.
 */
function answered(status: number, data: unknown): AxiosError {
  const error = new AxiosError(`Request failed with status code ${status}`);
  error.response = { status, data } as never;
  return error;
}

describe("describeSaveFailure", () => {
  it("names the studio reason for a designer-gate refusal", () => {
    const error = answered(403, { studio_errors: { design_json: "not_approved" } });

    expect(describeSaveFailure(error)).toContain("طراحان تأییدشده");
  });

  it("names the missing capability for an entitlement refusal", () => {
    const error = answered(403, { entitlement_errors: { card_editor: "locked" } });

    expect(describeSaveFailure(error)).toContain("پلن فعلی شما");
  });

  it("localizes a 429 throttle answer", () => {
    const message = describeSaveFailure(answered(429, { message: "Too Many Attempts." }));

    expect(message).not.toMatch(/Too Many/i);
    expect(message).toContain("تعداد درخواست‌ها زیاد است");
    // The old copy said «حدود یک دقیقه» (regression measured 2026-10-12).
    expect(message).toContain("۱۰ دقیقه");
    expect(message).not.toContain("یک دقیقه");
  });

  it("keeps the calm hint for a structural 422 rejection", () => {
    expect(describeSaveFailure(answered(422, { message: "The design json field is invalid." })))
      .toContain("ساختار مجاز سرور");
  });

  it("reports an unanswered (timed-out) save as ambiguous — never as success or failure", () => {
    const error = new AxiosError("timeout of 15000ms exceeded", AxiosError.ECONNABORTED);
    const message = describeSaveFailure(error);

    expect(isAmbiguousSaveFailure(error)).toBe(true);
    expect(message).not.toMatch(/timeout of 15000ms/i);
    expect(message).toContain("نتیجه قطعی نیست");
    expect(message).toContain("تلاش دوباره");
  });

  it("does NOT treat a real HTTP answer as ambiguous", () => {
    expect(isAmbiguousSaveFailure(answered(500, {}))).toBe(false);
    expect(isAmbiguousSaveFailure(answered(403, {}))).toBe(false);
  });

  it("does not treat a deliberate client cancel as an ambiguous write", () => {
    expect(isAmbiguousSaveFailure(new AxiosError("canceled", AxiosError.ERR_CANCELED))).toBe(false);
  });

  it("does not call a plain engine error an ambiguous write", () => {
    const error = new Error("Cannot read properties of undefined (reading 'layers')");

    expect(isAmbiguousSaveFailure(error)).toBe(false);
    const message = describeSaveFailure(error);
    expect(message).not.toMatch(/layers/);
    expect(message).toContain("ذخیره‌سازی ناموفق بود");
  });

  it("shows the server's own message when it answered through the shared mapper", () => {
    expect(describeSaveFailure(answered(403, { message: "این کارت متعلق به این کسب‌وکار نیست." })))
      .toBe("این کارت متعلق به این کسب‌وکار نیست.");
  });
});

describe("saveFailureDiagnostics", () => {
  it("logs only selected fields — never the request config that holds the token", () => {
    const error = answered(403, { message: "forbidden" });
    (error as unknown as { config?: unknown }).config = {
      headers: { Authorization: "Bearer SECRET-TOKEN" },
    };

    const diagnostics = saveFailureDiagnostics(error);

    expect(Object.keys(diagnostics).sort()).toEqual(["code", "message", "name", "status"]);
    expect(JSON.stringify(diagnostics)).not.toContain("SECRET-TOKEN");
  });
});
