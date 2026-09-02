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
      className="w-full rounded-lg border border-navy-200 bg-white px-4 py-3 text-center text-lg tracking-widest text-navy-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-zinc-100"
    />
  );
}
