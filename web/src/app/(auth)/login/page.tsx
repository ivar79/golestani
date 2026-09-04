"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import PhoneInput from "@/components/auth/PhoneInput";

const PHONE_KEY = "golestani_login_phone";

export default function LoginPage() {
  const router = useRouter();
  const { sendOtp } = useAuth();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidPhone = /^09\d{9}$/.test(phone);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!isValidPhone) {
      setError("شماره موبایل معتبر نیست. (مثال: 09123456789)");
      return;
    }

    setLoading(true);
    try {
      await sendOtp(phone);
      sessionStorage.setItem(PHONE_KEY, phone);
      router.push("/otp");
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-white tracking-tight">
          ورود یا ثبت‌نام
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-surface-variant/70">
          شماره موبایل خود را وارد کنید تا کد تأیید برایتان پیامک شود.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <PhoneInput value={phone} onChange={setPhone} autoFocus disabled={loading} />

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400 text-center"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !isValidPhone}
          className="btn btn-primary w-full py-4 rounded-xl text-[15px] font-medium shadow-[0_10px_20px_-10px_rgba(16,185,129,0.6)]"
        >
          {loading ? "در حال ارسال کد..." : "دریافت کد تأیید"}
        </button>
      </form>
    </div>
  );
}
