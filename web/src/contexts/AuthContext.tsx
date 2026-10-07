"use client";
import { createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode } from "react";
import { clearSession, readStoredToken, setAuthCookie } from "@/lib/session";
import { TOKEN_KEY } from "@/lib/session";
import { clearPrivateAssetCache } from "@/lib/privateAsset";
import { getMe,logout as logoutApi,sendOtp as sendOtpApi,verifyOtp as verifyOtpApi,loginAdmin as loginAdminApi,uploadAvatar as uploadAvatarApi,deleteAvatar as deleteAvatarApi } from "@/lib/auth";
import axios from "axios";
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
    // Deferred tick (project pattern): keeps setState out of the effect body
    // (react-hooks/set-state-in-effect) and out of the hydration render path.
    const t=window.setTimeout(()=>{
      const stored=readStoredToken();
      if (stored) setToken(stored);
      setHydrated(true);
    },0);
    return()=>{window.clearTimeout(t);};
  },[]);
  useEffect(()=>{
    if (!token) {
      setAuthCookie(false);
      if (hydrated) {
        const t=window.setTimeout(()=>setLoading(false),0);
        return()=>{window.clearTimeout(t);};
      }
      return;
    }
    setAuthCookie(true);
    let active=true;
    /*
     * Auth-state machine on refresh (regression 2026-10-07):
     *   401                    → real logout: clear session, redirect happens
     *                            via the page gates.
     *   network/timeout/5xx    → AUTH UNKNOWN: the stored session is still
     *                            valid, so retry with backoff and keep
     *                            `loading` — pages render their loading state
     *                            instead of a logged-out gate. Previously ONE
     *                            retry ran and then the app rendered every
     *                            gate as "log in", which read as an automatic
     *                            logout on a slow API (ERR_ABORTED on /auth/me).
     *   other 4xx              → give up without clearing the session.
     * While unknown, poll /auth/me every 3s until the API answers; the user
     * then resumes exactly where they were (user demand: refresh must never
     * cost the session).
     */
    const loadUser=async():Promise<void>=>{
      const backoffs=[300,900,2000];
      let attempt=0;
      while(active){
        try{
          const me=await getMe();
          if(active){setUser(me);setLoading(false);}
          return;
        }catch(error){
          if(!active)return;
          if(axios.isAxiosError(error)&&error.response?.status===401){
            clearSession();setToken(null);setUser(null);setLoading(false);
            return;
          }
          const transient=!axios.isAxiosError(error)
            ||!error.response
            ||error.code===axios.AxiosError.ERR_CANCELED
            ||error.response.status>=500;
          if(!transient){setLoading(false);return;}
          const delay=attempt<backoffs.length?backoffs[attempt]:3000;
          attempt++;
          await new Promise((resolve)=>{window.setTimeout(resolve,delay);});
        }
      }
    };
    void loadUser();
    return()=>{active=false;};
  },[token,hydrated]);
  const accept=useCallback((result:VerifyOtpResponse)=>{
    localStorage.setItem(TOKEN_KEY,result.token);setAuthCookie(true);setToken(result.token);setUser(result.user);setLoading(false);return result.user;
  },[]);
  const sendOtp=useCallback(async(phone:string)=>{await sendOtpApi(phone);},[]);
  const verifyOtp=useCallback(async(phone:string,code:string)=>accept(await verifyOtpApi(phone,code)),[accept]);
  const loginAdmin=useCallback(async(identifier:string,password:string)=>accept(await loginAdminApi(identifier,password)),[accept]);
  const logout=useCallback(async()=>{
    try{await logoutApi();}catch{/* Local cleanup still works if the token is expired. */}finally{clearSession();setToken(null);setUser(null);clearPrivateAssetCache();}
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
