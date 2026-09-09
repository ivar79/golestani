"use client";
import { createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode } from "react";
import { clearSession, readStoredToken, setAuthCookie } from "@/lib/session";
import { TOKEN_KEY } from "@/lib/session";
import { getMe,logout as logoutApi,sendOtp as sendOtpApi,verifyOtp as verifyOtpApi,loginAdmin as loginAdminApi } from "@/lib/auth";
import type { UserInfo, VerifyOtpResponse } from "@/types/auth";
interface AuthContextValue {
  token:string|null; user:UserInfo|null; loading:boolean;
  sendOtp:(phone:string)=>Promise<void>;
  verifyOtp:(phone:string,code:string)=>Promise<UserInfo>;
  loginAdmin:(identifier:string,password:string)=>Promise<UserInfo>;
  logout:()=>Promise<void>;
}
// Context value kept out of render dependency churn via useMemo below.
const Context=createContext<AuthContextValue|null>(null);
export function AuthProvider({children}:{children:ReactNode}) {
  // Lazy initializers read localStorage once during the first render instead
  // of calling setState synchronously inside an effect (react-hooks lint).
  // The provider is client-side ("use client") and mounts after hydration, so
  // the read is browser-only in practice; useStorageValue guards SSR anyway.
  const [token,setToken]=useState<string|null>(()=>readStoredToken());
  const [user,setUser]=useState<UserInfo|null>(null);
  const [loading,setLoading]=useState<boolean>(()=>Boolean(readStoredToken()));
  useEffect(()=>{
    // Persisted token already seeded into state by the lazy initializers.
    if (!token) { setAuthCookie(false); return; }
    setAuthCookie(true);
    let active=true;
    getMe().then(me=>{if(active)setUser(me);}).catch(()=>{if(active){clearSession();setToken(null);setUser(null);}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[token]);
  const accept=useCallback((result:VerifyOtpResponse)=>{
    localStorage.setItem(TOKEN_KEY,result.token);setAuthCookie(true);setToken(result.token);setUser(result.user);setLoading(false);return result.user;
  },[]);
  const sendOtp=useCallback(async(phone:string)=>{await sendOtpApi(phone);},[]);
  const verifyOtp=useCallback(async(phone:string,code:string)=>accept(await verifyOtpApi(phone,code)),[accept]);
  const loginAdmin=useCallback(async(identifier:string,password:string)=>accept(await loginAdminApi(identifier,password)),[accept]);
  const logout=useCallback(async()=>{
    try{await logoutApi();}catch{/* Local cleanup still works if the token is expired. */}finally{clearSession();setToken(null);setUser(null);}
  },[]);
  const value=useMemo(()=>({token,user,loading,sendOtp,verifyOtp,loginAdmin,logout}),[token,user,loading,sendOtp,verifyOtp,loginAdmin,logout]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth():AuthContextValue {const ctx=useContext(Context);if(!ctx)throw new Error("useAuth must be used within AuthProvider");return ctx;}
