"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { AlertCircle, ShieldCheck, Smartphone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { extractApiError } from "@/lib/api";
import PhoneInput from "@/components/auth/PhoneInput";

const PHONE_KEY = "golestani_login_phone";

/**
 * AuthGlass — پنل شیشه‌ای مشترک /login و /otp (مرجع: تصویر طراحی).
 *
 * bg-[#071120]/55 + بلور متوسط + باریکهٔ نورانی cyan در بالا و رگهٔ
 * طلایی کم‌رنگ در پایین لبه — دقیقاً حس شیشهٔ مرجع، بدون نئون و بدون
 * افکت سه‌بعدی.
 */
export function AuthGlass({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-[#071120]/55 shadow-[0_24px_70px_-28px_rgba(2,6,23,0.8)] backdrop-blur-md">
      {/* hairline top-light (cyan) */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-cyan-200/40 to-transparent"
        aria-hidden="true"
      />
      {/* faint gold inner edge, bottom-left — per reference */}
      <div
        className="pointer-events-none absolute inset-y-0 start-0 w-px bg-gradient-to-b from-transparent via-[#c8a44d]/25 to-transparent"
        aria-hidden="true"
      />

      <div className="relative p-7 sm:p-8">{children}</div>
    </div>
  );
}

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
    <AuthGlass>
      {/* Header row: brand tile on the physical LEFT, title on the RIGHT (RTL) */}
      <div className="flex items-start justify-between gap-4">
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-cyan-400/30">
          <Image src="/incart-logo.webp" alt="لوگوی اینکارت" width={48} height={48} className="h-full w-full object-cover" />
        </div>
        <div className="text-right">
          <p className="text-[12px] text-slate-400">به اینکارت خوش آمدید</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white">
            ورود یا <span className="text-cyan-400">ثبت‌نام</span>
          </h1>
        </div>
      </div>

      <p className="mt-5 text-[14px] leading-relaxed text-slate-300">
        برای دسترسی به پنل یا ساخت کارت هوشمند، شماره خود را وارد کنید.
      </p>

      {/* Form — OTP logic unchanged */}
      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <label htmlFor="phone-input" className="text-[13px] font-medium text-slate-200">
            شماره تلفن همراه
          </label>
          <PhoneInput
            id="phone-input"
            value={phone}
            onChange={setPhone}
            autoFocus
            disabled={loading}
            leadingIcon={<Smartphone className="h-5 w-5" />}
          />
          <span className="flex items-center gap-1.5 text-[12px] text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
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
          className="auth-cta mt-1 w-full rounded-2xl py-3.5 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{loading ? "در حال ارسال کد..." : "دریافت کد تأیید"}</span>
          <span className="btn-arrow text-lg leading-none" aria-hidden="true">
            ←
          </span>
        </button>
      </form>

      {/* Divider with centre dot — per reference */}
      <div className="relative mt-7 border-t border-white/[0.09]">
        <span className="absolute -top-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-cyan-300/70 bg-[#071120]" />
      </div>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[12px] leading-relaxed text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
        با ورود یا ثبت‌نام در اینکارت، شرایط و قوانین سامانه را می‌پذیرید.
      </p>
    </AuthGlass>
  );
}
