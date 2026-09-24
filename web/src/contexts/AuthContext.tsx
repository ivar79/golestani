"use client";
import { createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode } from "react";
import { clearSession, readStoredToken, setAuthCookie } from "@/lib/session";
import { TOKEN_KEY } from "@/lib/session";
import { getMe,logout as logoutApi,sendOtp as sendOtpApi,verifyOtp as verifyOtpApi,loginAdmin as loginAdminApi,uploadAvatar as uploadAvatarApi,deleteAvatar as deleteAvatarApi } from "@/lib/auth";
import type { UserInfo, VerifyOtpResponse } from "@/types/auth";
interface AuthContextValue {
  token:string|null; user:UserInfo|null; loading:boolean;
  sendOtp:(phone:string)=>Promise<void>;
  verifyOtp:(phone:string,code:string)=>Promise<UserInfo>;
  loginAdmin:(identifier:string,password:string)=>Promise<UserInfo>;
  logout:()=>Promise<void>;
  /** Re-fetch /auth/me — used after the user claims a username. */
  refreshUser:()=>Promise<void>;
  /** Upload (or replace) the profile photo then re-fetch the user. */
  uploadAvatar:(file:File)=>Promise<void>;
  /** Remove the profile photo then re-fetch the user. */
  removeAvatar:()=>Promise<void>;
}
// Context value kept out of render dependency churn via useMemo below.
const Context=createContext<AuthContextValue|null>(null);
export function AuthProvider({children}:{children:ReactNode}) {
  // Hydration-safe session adoption: client components ARE server-rendered in
  // the App Router, so the first client render must match the server HTML.
  // Both start with an empty session; the persisted token is adopted in the
  // mount effect below (one post-hydration transition instead of a mismatch).
  const [token,setToken]=useState<string|null>(null);
  const [user,setUser]=useState<UserInfo|null>(null);
  const [loading,setLoading]=useState<boolean>(true);
  const [hydrated,setHydrated]=useState<boolean>(false);
  useEffect(()=>{
    // Adopt the persisted token once, after hydration, so SSR/client agree.
    const stored=readStoredToken();
    if (stored) setToken(stored);
    setHydrated(true);
  },[]);
  useEffect(()=>{
    if (!token) { setAuthCookie(false); if (hydrated) setLoading(false); return; }
    setAuthCookie(true);
    let active=true;
    getMe().then(me=>{if(active)setUser(me);}).catch(()=>{if(active){clearSession();setToken(null);setUser(null);}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[token,hydrated]);
  const accept=useCallback((result:VerifyOtpResponse)=>{
    localStorage.setItem(TOKEN_KEY,result.token);setAuthCookie(true);setToken(result.token);setUser(result.user);setLoading(false);return result.user;
  },[]);
  const sendOtp=useCallback(async(phone:string)=>{await sendOtpApi(phone);},[]);
  const verifyOtp=useCallback(async(phone:string,code:string)=>accept(await verifyOtpApi(phone,code)),[accept]);
  const loginAdmin=useCallback(async(identifier:string,password:string)=>accept(await loginAdminApi(identifier,password)),[accept]);
  const logout=useCallback(async()=>{
    try{await logoutApi();}catch{/* Local cleanup still works if the token is expired. */}finally{clearSession();setToken(null);setUser(null);}
  },[]);
  const refreshUser=useCallback(async()=>{
    try{const me=await getMe();setUser(me);}catch{/* Keep the stale user; the next full reload fixes it. */}
  },[]);
  const uploadAvatar=useCallback(async(file:File)=>{await uploadAvatarApi(file);await refreshUser();},[refreshUser]);
  const removeAvatar=useCallback(async()=>{await deleteAvatarApi();await refreshUser();},[refreshUser]);
  const value=useMemo(()=>({token,user,loading,sendOtp,verifyOtp,loginAdmin,logout,refreshUser,uploadAvatar,removeAvatar}),[token,user,loading,sendOtp,verifyOtp,loginAdmin,logout,refreshUser,uploadAvatar,removeAvatar]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth():AuthContextValue {const ctx=useContext(Context);if(!ctx)throw new Error("useAuth must be used within AuthProvider");return ctx;}
