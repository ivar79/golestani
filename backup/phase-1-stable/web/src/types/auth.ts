export interface RoleInfo {
  id: number;
  name: string;
  display_name: string;
}

export interface UserInfo {
  id: number;
  phone: string;
  roles: string[];
  created_at?: string;
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

export type MeResponse = UserInfo;
