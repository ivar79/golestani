"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { TOKEN_KEY } from "@/lib/api";
import {
  getMe,
  logout as logoutApi,
  sendOtp as sendOtpApi,
  verifyOtp as verifyOtpApi,
  loginAdmin as loginAdminApi,
} from "@/lib/auth";
import type { UserInfo } from "@/types/auth";

interface AuthContextValue {
  token: string | null;
  user: UserInfo | null;
  loading: boolean;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, code: string) => Promise<UserInfo>;
  loginAdmin: (identifier: string, password: string) => Promise<UserInfo>;
  logout: () => Promise<void>;
}

// Lightweight cookie so Next.js middleware can route-guard without a server call.
const TOKEN_COOKIE = "golestani_token";
const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

function setTokenCookie(token: string | null): void {
  if (typeof document === "undefined") return;
  // P0: Secure only over HTTPS so local HTTP development keeps working.
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (token) {
    document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${SEVEN_DAYS_SECONDS}; SameSite=Lax${secure}`;
  } else {
    document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0; SameSite=Lax${secure}`;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(() =>
    typeof window !== "undefined" && Boolean(window.localStorage.getItem(TOKEN_KEY)),
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (!stored) return;
    setTokenCookie(stored);
    getMe()
      .then((me) => setUser(me))
      .catch(() => {
        window.localStorage.removeItem(TOKEN_KEY);
        setTokenCookie(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const sendOtp = useCallback(async (phone: string) => {
    await sendOtpApi(phone);
  }, []);

  const loginAdmin = useCallback(async (identifier: string, password: string) => {
    const result = await loginAdminApi(identifier, password);
    window.localStorage.setItem(TOKEN_KEY, result.token);
    setTokenCookie(result.token);
    setToken(result.token);
    setUser(result.user);
    return result.user;
  }, []);

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    const result = await verifyOtpApi(phone, code);
    window.localStorage.setItem(TOKEN_KEY, result.token);
    setTokenCookie(result.token);
    setToken(result.token);
    setUser(result.user);
    // Return the fresh user so callers (e.g. OTP redirect) can route by role
    // immediately, without waiting for the state update to propagate.
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch {
      // The token may already be invalid; local cleanup happens regardless.
    }
    window.localStorage.removeItem(TOKEN_KEY);
    setTokenCookie(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ token, user, loading, sendOtp, verifyOtp, loginAdmin, logout }),
    [token, user, loading, sendOtp, verifyOtp, loginAdmin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}