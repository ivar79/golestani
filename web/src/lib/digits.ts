/**
 * Persian/Arabic → ASCII digit conversion for identifier inputs.
 *
 * Mirrors the backend helper (api/app/Support/Digits.php) so the admin login
 * page submits normalized values even before the request leaves the browser.
 * Intentionally NOT applied globally: the OTP flow and PhoneInput manage
 * their own digit behavior.
 */
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toEnglishDigits(value: string): string {
  let out = "";
  for (const ch of value) {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p !== -1) {
      out += String(p);
      continue;
    }
    const a = ARABIC_DIGITS.indexOf(ch);
    if (a !== -1) {
      out += String(a);
      continue;
    }
    out += ch;
  }
  return out;
}

/** Normalize an admin login identifier: English digits + trimmed. */
export function normalizeIdentifier(value: string): string {
  return toEnglishDigits(value).trim();
}
