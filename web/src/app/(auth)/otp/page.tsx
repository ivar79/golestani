"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { panelPath } from "@/lib/panelPath";
import OtpInput from "@/components/auth/OtpInput";

const PHONE_KEY = "golestani_login_phone";

function maskPhone(value: string): string {
  return `${value.slice(0, 4)}•••${value.slice(7)}`;
}

export default function OtpPage() {
  const router = useRouter();
  const { verifyOtp, sendOtp } = useAuth();
  const [phone] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(PHONE_KEY),
  );
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(120);

  useEffect(() => {
    if (!phone) router.replace("/login");
  }, [phone, router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  async function handleVerify(submitted: string) {
    if (!phone) return;
    setError(null);
    setLoading(true);
    try {
      const verifiedUser = await verifyOtp(phone, submitted);
      // Route by role using the user returned from verify (context state lags one
      // tick behind): admin → /admin, designer → /designer, others → /dashboard.
      router.push(panelPath(verifiedUser?.roles) ?? "/");
    } catch (err) {
      setError(extractApiError(err));
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!phone || resendIn > 0 || loading) return;
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await sendOtp(phone);
      setNotice("کد تأیید مجدداً ارسال شد.");
      setResendIn(120);
      setCode("");
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (code.length === 5) {
      handleVerify(code);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          کد تأیید یک‌بار مصرف
        </h1>
        <div className="mt-2 flex items-center justify-center flex-wrap gap-1.5 text-[14px] text-slate-300">
          <span>کد ارسال‌شده به</span>
          <span dir="ltr" className="font-mono font-medium text-cyan-400">
            {phone ? maskPhone(phone) : "..."}
          </span>
          <span className="text-slate-500">|</span>
          <Link
            href="/login"
            className="text-[13px] font-medium text-cyan-400 hover:text-cyan-300 underline underline-offset-4"
          >
            تغییر شماره
          </Link>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col items-center gap-2">
          <label className="text-[13px] font-medium text-slate-300 mb-1">
            کد ۵ رقمی را وارد کنید
          </label>
          <OtpInput value={code} onChange={setCode} disabled={loading} autoFocus />
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-300"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
            <span>{notice}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || code.length !== 5}
          className="btn btn-primary w-full py-3.5 rounded-xl text-[15px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? "در حال بررسی..." : "تأیید و ورود"}
        </button>
      </form>

      <div className="pt-2 border-t border-white/[0.06] text-center text-[13px] text-slate-400">
        {resendIn > 0 ? (
          <span>
            امکان ارسال مجدد کد تا{" "}
            <span className="font-mono font-medium text-cyan-400">
              {resendIn}
            </span>{" "}
            ثانیه دیگر
          </span>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            className="font-medium text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
          >
            ارسال مجدد کد تأیید
          </button>
        )}
      </div>
    </div>
  );
}
