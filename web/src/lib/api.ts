import axios from "axios";
import { clearSession, readStoredToken } from "@/lib/session";
// Backwards-compatible re-export: existing imports of TOKEN_KEY keep working.
export { TOKEN_KEY } from "@/lib/session";
// Host URLs must come from NEXT_PUBLIC_API_URL only (Vercel now, Liara later).
// No hardcoded host fallback: the dead Railway fallback used to swallow
// misconfiguration and send user traffic to a 404.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
const api = axios.create({
  baseURL: API_URL.replace(/\/$/, ""),
  headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
  timeout: 15000,
  withCredentials: false,
});
api.interceptors.request.use(config => {
  // Always the CURRENT TAB's token (sessionStorage-backed). Never read the
  // shared localStorage slot directly: that is how a request could silently
  // start running as another tab's account.
  const token = readStoredToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Non-GET requests need a non-simple Content-Type for the backend CSRF
  // guard (ApiRequestSafety). axios only SENDS the Content-Type header when a
  // body exists, so body-less DELETE/PUT calls were rejected with 415 in the
  // real browser (masked as pass in jsdom-less unit tests). Give them an
  // empty JSON object so the header is actually transmitted.
  // FormData keeps the browser-chosen multipart boundary for uploads; a
  // file-bearing PUT must be sent as POST with the Laravel _method=PUT
  // spoofing field (PHP parses multipart bodies only for POST).
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    config.headers.delete("Content-Type");
  } else {
    const method = (config.method || "get").toLowerCase();
    if (!["get", "head", "options"].includes(method)) {
      if (config.data === undefined || config.data === null) config.data = {};
      config.headers.set("Content-Type", "application/json");
    }
  }
  return config;
});
// Global 401 handling: a rejected/expired token must end the client session
// and route the user to the right login page — one handler for the whole app,
// so parallel error handling never diverges.
// - /admin* pages authenticate through /admin/login (password flow).
// - Everything else authenticates through /login (OTP flow).
// /login and /otp are exempt: those pages already run their own redirect
// logic and a 401 bounce there could loop.
api.interceptors.response.use(
  response => response,
  error => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && typeof window !== "undefined") {
      clearSession();
      const path = window.location.pathname;
      const onAuthPage = path === "/login" || path === "/otp" || path === "/admin/login";
      if (!onAuthPage) window.location.assign(path.startsWith("/admin") ? "/admin/login" : "/login");
    }
    return Promise.reject(error);
  },
);
/**
 * Retry a request ONLY when the API did not answer (network drop, timeout,
 * 5xx — e.g. a cold serverless database). 4xx answers (401/403/422/429) are
 * real answers and are never retried. Used by admin reads so one dropped
 * request no longer turns the whole panel into "connection lost".
 */
export async function retryTransient<T>(run: () => Promise<T>, delays: number[] = [600, 1800]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const transient = axios.isAxiosError(error) && (!error.response || error.response.status >= 500);
      if (!transient || attempt >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

export function extractApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { errors?: Record<string, string[]>; message?: string } | undefined;
    if (data?.errors) {
      const messages = Object.values(data.errors).flat();
      if (messages.length) return messages.join(" • ");
    }
    if (data?.message) return data.message;
    if (error.code === "ECONNABORTED") return "زمان پاسخ سرور تمام شد؛ قبل از تلاش مجدد اطلاعات را بازخوانی کنید.";
    if (!error.response) return "ارتباط با سرور برقرار نشد.";
  }
  return error instanceof Error ? error.message : "خطای ناشناخته‌ای رخ داد.";
}
export default api;
