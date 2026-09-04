"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const { loginAdmin } = useAuth();
  
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
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
    <div className="flex flex-col gap-8 w-full max-w-sm mx-auto mt-20 p-8 bg-surface-variant/10 rounded-2xl border border-white/5">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-white tracking-tight">
          ورود مدیریت
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-surface-variant/70">
          برای دسترسی به پنل ادمین وارد شوید.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-2">
          <label className="text-[13px] text-surface-variant/80">شماره موبایل یا ایمیل</label>
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={loading}
            autoFocus
            dir="ltr"
            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-left focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[13px] text-surface-variant/80">رمز عبور</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            dir="ltr"
            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-left focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none transition-all"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400 text-center">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !identifier || !password}
          className="btn btn-primary w-full py-4 rounded-xl text-[15px] font-medium shadow-[0_10px_20px_-10px_rgba(0,108,74,0.6)]"
        >
          {loading ? "در حال ورود..." : "ورود"}
        </button>
      </form>
    </div>
  );
}
