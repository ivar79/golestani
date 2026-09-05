import axios from "axios";

export const TOKEN_KEY = "golestani_token";

// Fallback directly to Railway API URL if NEXT_PUBLIC_API_URL is missing during build/runtime
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://golestani-api-production.up.railway.app/api";

const api = axios.create({
  baseURL: API_URL,
  headers: { Accept: "application/json" },
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export function extractApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as any;

    // Handle Laravel Validation Errors (422)
    if (data?.errors && typeof data.errors === "object") {
      const firstKey = Object.keys(data.errors)[0];
      if (firstKey && Array.isArray(data.errors[firstKey])) {
        return data.errors[firstKey][0];
      }
    }

    if (data?.message) return data.message;

    if (error.code === "ECONNABORTED") {
      return "زمان پاسخ سرور به پایان رسید.";
    }
    if (!error.response) {
      return "خطا در ارتباط با سرور. لطفاً اتصال اینترنت را بررسی کنید.";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "خطای ناشناخته‌ای رخ داد.";
}

export default api;