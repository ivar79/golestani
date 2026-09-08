"use client";
import { createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode } from "react";
import { TOKEN_KEY } from "@/lib/api";
import { getMe,logout as logoutApi,sendOtp as sendOtpApi,verifyOtp as verifyOtpApi,loginAdmin as loginAdminApi } from "@/lib/auth";
import type { UserInfo, VerifyOtpResponse } from "@/types/auth";
interface AuthContextValue {
  token:string|null; user:UserInfo|null; loading:boolean;
  sendOtp:(phone:string)=>Promise<void>;
  verifyOtp:(phone:string,code:string)=>Promise<UserInfo>;
  loginAdmin:(identifier:string,password:string)=>Promise<UserInfo>;
  logout:()=>Promise<void>;
}
// Route hint only, never put the bearer secret into an additional JS cookie.
// API authorization is always enforced by Laravel, not this hint.
function routeHint(present:boolean):void {
  const secure=location.protocol==="https:"?"; Secure":"";
  document.cookie=`golestani_token=${present?"present":""}; path=/; max-age=${present?604800:0}; SameSite=Lax${secure}`;
}
const Context=createContext<AuthContextValue|null>(null);
export function AuthProvider({children}:{children:ReactNode}) {
  const [token,setToken]=useState<string|null>(null),[user,setUser]=useState<UserInfo|null>(null),[loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;const stored=localStorage.getItem(TOKEN_KEY);routeHint(Boolean(stored));
    if(!stored){setLoading(false);return;}
    setToken(stored);
    getMe().then(me=>{if(active)setUser(me);}).catch(()=>{if(active){localStorage.removeItem(TOKEN_KEY);routeHint(false);setToken(null);setUser(null);}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  const accept=useCallback((result:VerifyOtpResponse)=>{
    localStorage.setItem(TOKEN_KEY,result.token);routeHint(true);setToken(result.token);setUser(result.user);return result.user;
  },[]);
  const sendOtp=useCallback(async(phone:string)=>{await sendOtpApi(phone);},[]);
  const verifyOtp=useCallback(async(phone:string,code:string)=>accept(await verifyOtpApi(phone,code)),[accept]);
  const loginAdmin=useCallback(async(identifier:string,password:string)=>accept(await loginAdminApi(identifier,password)),[accept]);
  const logout=useCallback(async()=>{
    try{await logoutApi();}catch{/* Local cleanup still works if the token is expired. */}finally{localStorage.removeItem(TOKEN_KEY);routeHint(false);setToken(null);setUser(null);}
  },[]);
  const value=useMemo(()=>({token,user,loading,sendOtp,verifyOtp,loginAdmin,logout}),[token,user,loading,sendOtp,verifyOtp,loginAdmin,logout]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth():AuthContextValue {const ctx=useContext(Context);if(!ctx)throw new Error("useAuth must be used within AuthProvider");return ctx;}
