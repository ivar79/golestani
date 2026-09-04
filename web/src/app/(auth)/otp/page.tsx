"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
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
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-white tracking-tight">
          کد تأیید
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-surface-variant/70">
          کد ۵ رقمی ارسال‌شده به شماره{" "}
          <span dir="ltr" className="font-medium text-cyan-400">
            {phone ? maskPhone(phone) : "..."}
          </span>{" "}
          را وارد کنید.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
        <OtpInput value={code} onChange={setCode} disabled={loading} autoFocus />

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400 text-center"
          >
            {error}
          </p>
        )}

        {notice && (
          <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-400 text-center">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || code.length !== 5}
          className="btn btn-primary w-full py-4 rounded-xl text-[15px] font-medium shadow-[0_10px_20px_-10px_rgba(16,185,129,0.6)]"
        >
          {loading ? "در حال بررسی..." : "تأیید و ورود"}
        </button>
      </form>

      <div className="text-center text-[13px] text-surface-variant/60">
        {resendIn > 0 ? (
          <span>
            ارسال مجدد کد تا{" "}
            <span className="font-medium text-cyan-400">
              {resendIn}
            </span>{" "}
            ثانیه دیگر
          </span>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            className="font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            ارسال مجدد کد
          </button>
        )}
      </div>
    </div>
  );
}
