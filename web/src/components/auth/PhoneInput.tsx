"use client";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (char) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(char);
    if (persianIndex !== -1) return String(persianIndex);
    return String(ARABIC_DIGITS.indexOf(char));
  });
}

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
}

export default function PhoneInput({
  value,
  onChange,
  disabled,
  autoFocus,
  id = "phone-input",
}: PhoneInputProps) {
  return (
    <input
      id={id}
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      dir="ltr"
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      placeholder="09xxxxxxxxx"
      aria-label="شماره موبایل"
      onChange={(event) => {
        const cleaned = normalizeDigits(event.target.value)
          .replace(/\D/g, "")
          .slice(0, 11);
        onChange(cleaned);
      }}
      className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3.5 text-center text-[20px] font-mono tracking-[0.25em] text-white outline-none transition focus:border-cyan-400 focus:bg-white/[0.06] focus:ring-2 focus:ring-cyan-400/20 disabled:opacity-50 placeholder:text-slate-500"
    />
  );
}
