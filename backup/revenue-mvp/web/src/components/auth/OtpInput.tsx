"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (char) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(char);
    if (persianIndex !== -1) return String(persianIndex);
    return String(ARABIC_DIGITS.indexOf(char));
  });
}

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

export default function OtpInput({
  value,
  onChange,
  length = 5,
  disabled,
  autoFocus,
}: OtpInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const setDigit = (index: number, digit: string) => {
    const chars = value.split("");
    while (chars.length < length) chars.push("");
    chars[index] = digit;
    onChange(chars.join("").slice(0, length));
  };

  const focusInput = (index: number) => {
    inputsRef.current[Math.max(0, Math.min(index, length - 1))]?.focus();
  };

  const handleChange = (index: number, raw: string) => {
    const digits = normalizeDigits(raw).replace(/\D/g, "");
    if (!digits) {
      setDigit(index, "");
      return;
    }
    if (digits.length > 1) {
      const chars = value.split("");
      while (chars.length < length) chars.push("");
      for (let i = 0; i < digits.length && index + i < length; i += 1) {
        chars[index + i] = digits[i];
      }
      onChange(chars.join("").slice(0, length));
      focusInput(index + digits.length);
      return;
    }
    setDigit(index, digits);
    if (index < length - 1) focusInput(index + 1);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace") {
      if (value[index]) {
        setDigit(index, "");
      } else if (index > 0) {
        setDigit(index - 1, "");
        focusInput(index - 1);
      }
    } else if (event.key === "ArrowLeft") {
      focusInput(index - 1);
    } else if (event.key === "ArrowRight") {
      focusInput(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = normalizeDigits(event.clipboardData.getData("text"))
      .replace(/\D/g, "")
      .slice(0, length);
    if (!pasted) return;
    onChange(pasted);
    focusInput(pasted.length);
  };

  return (
    <div dir="ltr" className="flex items-center justify-center gap-2 sm:gap-3">
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(element) => {
            inputsRef.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          aria-label={`رقم ${index + 1} کد تأیید`}
          value={value[index] ?? ""}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          className="h-14 w-12 rounded-lg border border-navy-200 bg-white text-center text-2xl font-semibold text-navy-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-zinc-100 sm:h-16 sm:w-14 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      ))}
    </div>
  );
}
