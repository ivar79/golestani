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
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-navy-950">
          ورود / ثبت‌نام
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          شماره موبایل خود را وارد کنید تا کد تأیید برایتان پیامک شود.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <PhoneInput value={phone} onChange={setPhone} autoFocus disabled={loading} />

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !isValidPhone}
          className="btn btn-primary w-full py-3"
        >
          {loading ? "در حال ارسال کد..." : "دریافت کد تأیید"}
        </button>
      </form>
    </div>
  );
}
