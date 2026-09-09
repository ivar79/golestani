"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { ShieldCheck, Eye, EyeOff, ArrowRight, User as UserIcon } from "lucide-react";

export default function AdminLoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, loginAdmin } = useAuth();
  
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already authenticated as admin, jump straight to the admin dashboard
  useEffect(() => {
    if (!authLoading && user && user.roles.includes("admin")) {
      router.replace("/admin");
    }
  }, [authLoading, user, router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!identifier || !password) return;
    setError(null);
    setLoading(true);

    try {
      await loginAdmin(identifier, password);
      router.push("/admin");
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#09111e]/90 p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden">
        {/* Top Accent Line */}
        <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-l from-emerald-500 via-teal-400 to-cyan-500" />

        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            ورود اختصاصی مدیریت
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            درگاه امن ورود مدیران ارشد سامانه اینکارت
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-300">
              شماره موبایل یا ایمیل مدیر
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={loading}
                autoFocus
                dir="ltr"
                placeholder="09000000000 یا admin@golestani.ir"
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 pl-10 text-white text-left placeholder-slate-500 focus:border-cyan-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-cyan-400 outline-none transition-all text-sm font-mono"
              />
              <UserIcon className="absolute left-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">رمز عبور مدیریت</label>
            </div>
            <div className="relative flex items-center">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                dir="ltr"
                placeholder="••••••••••••"
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-3 pl-10 text-white text-left placeholder-slate-500 focus:border-cyan-400 focus:bg-white/[0.07] focus:ring-1 focus:ring-cyan-400 outline-none transition-all text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute left-3.5 text-slate-400 hover:text-white transition-colors"
                title={showPassword ? "مخفی‌سازی رمز" : "نمایش رمز"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-400 text-center leading-relaxed">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !identifier || !password}
            className="w-full py-3.5 rounded-xl bg-gradient-to-l from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-sm shadow-[0_10px_20px_-10px_rgba(16,185,129,0.6)] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98] mt-1"
          >
            {loading ? "در حال اعتبارسنجی..." : "ورود به پنل مدیریت"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowRight className="w-3.5 h-3.5" />
            <span>بازگشت به صفحه اصلی سایت</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
