export interface RoleInfo {
  id: number;
  name: string;
  display_name: string;
}

export interface UserInfo {
  id: number;
  phone: string;
  /** Unique public handle chosen after OTP login; null until the user picks one. */
  username?: string | null;
  /** Profile photo path from the API storage; null until the user uploads one. */
  avatar?: string | null;
  roles: string[];
  created_at?: string;
}

export interface UsernameCheckResponse {
  available: boolean;
  suggestions: string[];
}

export interface UsernameSetResponse {
  message: string;
  username: string;
}

export interface SendOtpResponse {
  message: string;
  expires_in: number;
}

export interface VerifyOtpResponse {
  token: string;
  token_type: string;
  user: UserInfo;
}

export interface LogoutResponse {
  message: string;
}

export interface AvatarUploadResponse {
  message: string;
  /** Public URL of the stored photo (cache-busted). */
  avatar_url: string;
}

export type MeResponse = UserInfo;
