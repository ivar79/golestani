import api from "./api";
import axios from "axios";

/**
 * Resolve an API-relative storage path (e.g. "avatars/01J.jpg") to a full URL.
 * The API base is `…/api`, storage lives one level up on the same host.
 */
export function avatarUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const base = api.getUri().replace(/\/api\/?$/, "");
  return `${base}/storage/${path.replace(/^\//, "")}`;
}
import type {
  AvatarUploadResponse,
  LogoutResponse,
  MeResponse,
  SendOtpResponse,
  UsernameCheckResponse,
  UsernameSetResponse,
  VerifyOtpResponse,
} from "@/types/auth";

export async function sendOtp(phone: string): Promise<SendOtpResponse> {
  const { data } = await api.post<SendOtpResponse>("/auth/send-otp", { phone });
  return data;
}

export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResponse> {
  const { data } = await api.post<VerifyOtpResponse>("/auth/verify-otp", { phone, code });
  return data;
}

export async function logout(): Promise<LogoutResponse> {
  const { data } = await api.post<LogoutResponse>("/auth/logout");
  return data;
}

export async function getMe(): Promise<MeResponse> {
  const { data } = await api.get<MeResponse>("/auth/me");
  return data;
}

/** Live availability probe for the username picker (throttled server-side). */
export async function checkUsername(username: string): Promise<UsernameCheckResponse> {
  const { data } = await api.get<UsernameCheckResponse>("/auth/username/check", {
    params: { u: username.toLowerCase().trim() },
  });
  return data;
}

/** Claim the unique handle. 409 (taken) is returned as data, not thrown. */
export async function setUsername(username: string): Promise<
  | { ok: true; username: string; message: string }
  | { ok: false; message: string; suggestions: string[] }
> {
  try {
    const { data } = await api.post<UsernameSetResponse>("/auth/username", {
      username: username.toLowerCase().trim(),
    });
    return { ok: true, username: data.username, message: data.message };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 409) {
      const body = err.response.data as { message?: string; suggestions?: string[] };
      return { ok: false, message: body.message ?? "این نام کاربری قبلاً گرفته شده است.", suggestions: body.suggestions ?? [] };
    }
    throw err;
  }
}

export async function loginAdmin(identifier: string, password: string): Promise<VerifyOtpResponse> {
  const { data } = await api.post<VerifyOtpResponse>("/auth/admin/login", { identifier, password });
  return data;
}

/** Upload (or replace) the profile photo; returns the cache-busted public URL. */
export async function uploadAvatar(file: File): Promise<AvatarUploadResponse> {
  const form = new FormData();
  form.append("avatar", file);
  const { data } = await api.post<AvatarUploadResponse>("/auth/avatar", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deleteAvatar(): Promise<{ message: string }> {
  // ApiRequestSafety only lets bodyless mutations through when they declare a
  // JSON content type — a bare DELETE has none and would 415.
  const { data } = await api.delete<{ message: string }>("/auth/avatar", {
    headers: { "Content-Type": "application/json" },
    data: {},
  });
  return data;
}

