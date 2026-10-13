/**
 * saveFailure — the ONE place that turns a failed card save into Persian copy.
 *
 * Extracted from CardStudio so the message contract is unit-testable without a
 * mounted editor (measured bug 2026-10-09: a 15s axios timeout rendered the RAW
 * axios string "timeout of 15000ms exceeded" inside the Persian save bar).
 *
 * Rules (priority order):
 *   1. a studio refusal names the real reason (never "generic failure");
 *   2. an entitlement refusal names the missing capability;
 *   3. throttle / structural rejection get calm, actionable sentences;
 *   4. a request that never got an HTTP answer is reported as AMBIGUOUS — the
 *      save may or may not have landed server-side, so we never claim success
 *      or failure outright (the manual retry re-sends the same document);
 *   5. anything else falls back to the shared Persian error mapper.
 */

import axios from "axios";
import { extractApiError, rateLimitWaitHint } from "@/lib/api";
import {
  describeEntitlementErrors,
  describeStudioErrors,
  extractEntitlementErrors,
  extractStudioErrors,
} from "@/lib/entitlements";

function statusOf(error: unknown): number | undefined {
  return (error as { response?: { status?: number } })?.response?.status;
}

/**
 * True when the write's outcome is genuinely UNKNOWN: it went out on the wire
 * but no HTTP answer came back (timeout / dropped connection), so the server
 * may have applied it anyway. Requires an AXIOS transport failure — a plain
 * engine/JS error never reached the network and must not be called ambiguous.
 * A deliberate client cancel (ERR_CANCELED) is not ambiguous either: it never
 * counted as an attempted save.
 */
export function isAmbiguousSaveFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.response !== undefined) return false; // the server answered
  return error.code !== axios.AxiosError.ERR_CANCELED;
}

/**
 * Dev-only diagnostics for a failed save.
 *
 * FIELD-SELECTED on purpose: the raw axios error object carries its request
 * config, which contains the Authorization header — dumping the error would
 * put a bearer token in the browser console. Status/code/name/message are
 * enough to tell a throttle from a timeout from a refusal.
 */
export function saveFailureDiagnostics(error: unknown): Record<string, string | number | null> {
  return {
    status: statusOf(error) ?? null,
    code: (error as { code?: string })?.code ?? null,
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  };
}

/** The user-facing sentence for a failed save. Always Persian, never raw. */
export function describeSaveFailure(error: unknown): string {
  const status = statusOf(error);

  const studio = describeStudioErrors(extractStudioErrors(error));
  if (studio) return studio;

  const entitlement = describeEntitlementErrors(extractEntitlementErrors(error));
  if (entitlement) return entitlement;

  if (status === 429) {
    return `تعداد درخواست‌ها زیاد است؛ ${rateLimitWaitHint(error)} صبر کنید و دوباره تلاش کنید.`;
  }
  if (status === 422) {
    return "سند کارت با ساختار مجاز سرور همخوانی نیست — بخشی از طرح ذخیره نشد.";
  }

  if (isAmbiguousSaveFailure(error)) {
    return "پاسخ سرور برای ذخیرهٔ طرح دریافت نشد؛ نتیجه قطعی نیست و ممکن است ذخیره شده باشد. با «تلاش دوباره» همین طرح (نسخهٔ فعلی شما) دوباره ارسال و جایگزین می‌شود.";
  }

  if (status !== undefined) return extractApiError(error);

  // A non-HTTP failure (engine/JS error): technical strings are not UI copy.
  return "ذخیره‌سازی ناموفق بود؛ دوباره تلاش کنید.";
}
