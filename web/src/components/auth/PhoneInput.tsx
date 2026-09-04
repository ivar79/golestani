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
}

export default function PhoneInput({
  value,
  onChange,
  disabled,
  autoFocus,
}: PhoneInputProps) {
  return (
    <input
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
      className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-center text-[22px] tracking-[0.3em] text-white outline-none transition focus:border-cyan-500/50 focus:ring-4 focus:ring-cyan-500/10 disabled:opacity-50 placeholder:text-surface-variant/20"
    />
  );
}
