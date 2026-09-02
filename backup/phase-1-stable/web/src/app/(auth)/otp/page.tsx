"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
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
      await verifyOtp(phone, submitted);
      router.push("/");
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
        <h1 className="text-2xl font-bold text-navy-950">
          کد تأیید
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          کد ۵ رقمی ارسال‌شده به شماره{" "}
          <span dir="ltr" className="font-medium">
            {phone ? maskPhone(phone) : "..."}
          </span>{" "}
          را وارد کنید.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <OtpInput value={code} onChange={setCode} disabled={loading} autoFocus />

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
          >
            {error}
          </p>
        )}
        {notice && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || code.length !== 5}
          className="rounded-lg bg-emerald-600 py-3 text-base font-bold text-white shadow-[0_10px_25px_-10px_rgba(5,150,105,0.55)] transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "در حال بررسی..." : "تأیید و ورود"}
        </button>
      </form>

      <div className="text-center text-sm text-zinc-600">
        {resendIn > 0 ? (
          <span>
            ارسال مجدد کد تا{" "}
            <span className="font-medium text-navy-900">
              {resendIn}
            </span>{" "}
            ثانیه دیگر
          </span>
        ) : (
          <button
            type="button"
            onClick={handleResend}
            className="font-medium text-emerald-600 hover:underline"
          >
            ارسال مجدد کد
          </button>
        )}
      </div>
    </div>
  );
}
