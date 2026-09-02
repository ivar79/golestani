import api from "./api";
import type {
  LogoutResponse,
  MeResponse,
  SendOtpResponse,
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
