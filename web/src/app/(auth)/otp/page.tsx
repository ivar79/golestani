"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import { panelPath } from "@/lib/panelPath";
import OtpInput from "@/components/auth/OtpInput";
import { AuthGlass } from "../login/page";

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
    <AuthGlass>
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
          className="group inline-flex w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-transparent py-3.5 text-[15px] font-semibold leading-none text-white transition-[transform,box-shadow,background-color,border-color,color] duration-[180ms] ease-[cubic-bezier(0.22,1,0.36,1)] [background-image:linear-gradient(120deg,#0d9488_0%,#0891b2_100%)] [box-shadow:inset_0_1px_0_rgba(255,255,255,0.25),0_1px_2px_rgba(2,6,23,0.4),0_10px_24px_-12px_rgba(13,148,136,0.55),0_0_20px_-8px_rgba(8,145,178,0.35)] focus-visible:outline-none focus-visible:[box-shadow:0_0_0_3px_rgba(16,185,129,0.35)] hover:-translate-y-px [background-image:linear-gradient(120deg,#0f766e_0%,#0e7490_100%)] hover:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.3),0_2px_4px_rgba(2,6,23,0.35),0_16px_36px_-14px_rgba(13,148,136,0.65),0_0_30px_-8px_rgba(8,145,178,0.5)] active:translate-y-0 active:[box-shadow:inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(2,6,23,0.4),0_6px_18px_-10px_rgba(16,185,129,0.5)] disabled:cursor-not-allowed disabled:opacity-50 disabled:transform-none disabled:[box-shadow:none]"
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
    </AuthGlass>
  );
}
