"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
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
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          ورود یا ثبت‌نام
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-300">
          برای دسترسی به پنل یا ساخت کارت هوشمند، شماره خود را وارد کنید.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label htmlFor="phone-input" className="text-[13px] font-medium text-slate-200">
              شماره تلفن همراه
            </label>
            <span className="text-[11px] text-slate-400">پیش‌شماره ۰۹</span>
          </div>
          <PhoneInput
            id="phone-input"
            value={phone}
            onChange={setPhone}
            autoFocus
            disabled={loading}
          />
          <span className="text-[12px] text-slate-400">
            کد تأیید ۵ رقمی یک‌بار مصرف به این شماره پیامک خواهد شد.
          </span>
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

        <button
          type="submit"
          disabled={loading || !isValidPhone}
          className="btn btn-primary w-full py-3.5 rounded-xl text-[15px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {loading ? "در حال ارسال کد..." : "دریافت کد تأیید"}
        </button>
      </form>

      <div className="pt-2 border-t border-white/[0.06] text-center">
        <p className="text-[12px] text-slate-400 leading-relaxed">
          با ورود یا ثبت‌نام در اینکارت، شرایط و قوانین سامانه را می‌پذیرید.
        </p>
      </div>
    </div>
  );
}
