import axios from "axios";
export const TOKEN_KEY = "golestani_token";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://golestani-api-production.up.railway.app/api";
const api = axios.create({
  baseURL: API_URL.replace(/\/$/, ""),
  headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
  timeout: 15000,
  withCredentials: false,
});
api.interceptors.request.use(config => {
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  // DELETE requests also need a non-simple Content-Type for the CSRF guard.
  // Let the browser choose multipart boundaries for real uploads.
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    config.headers.delete("Content-Type");
  } else {
    if (!["get", "head", "options"].includes((config.method || "get").toLowerCase())) config.headers.set("Content-Type", "application/json");
  }
  return config;
});
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
