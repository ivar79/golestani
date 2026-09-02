import axios from "axios";

export const TOKEN_KEY = "golestani_token";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api",
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
    const data = error.response?.data as { message?: string } | undefined;
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
