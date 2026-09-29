/**
 * MONEY UNIT CONTRACT — تک نقطه تبدیل واحد پول (سمت کلاینت).
 *
 * نمایش قیمت‌ها همه‌جا «تومان» است (plans.price از سرور = تومان). درگاه
 * ZarinPal «ریال» می‌فهمد. تبدیل فقط از طریق همین توابع انجام شود — هیچ
 * ÷10 یا ×10 پراکنده‌ای در کدنویسی UI مجاز نیست (قفل با money.test.ts).
 *
 * واحد سمت سرور: plans.price = تومان (نمایش)، payment_transactions.amount = ریال
 * (واحد درگاه). صفحه نتیجه پرداخت amount ریالی را از status endpoint می‌گیرد
 * و با همین توابع به تومان نمایشی تبدیل می‌کند.
 */

/** ZarinPal amounts are RIAL; display prices are TOMAN. 1 toman = 10 rial. */
export const RIAL_PER_TOMAN = 10;

/** Display toman → gateway rial. Integer-exact for integer toman values. */
export function tomanToRial(toman: number): number {
  return toman * RIAL_PER_TOMAN;
}

/** Gateway rial → display toman. Inverse of tomanToRial (exact for the ×10 values the backend stores). */
export function tomanFromRial(rial: number): number {
  return rial / RIAL_PER_TOMAN;
}

/** «۲۴۹٬۰۰۰ تومان» — the display format used across the pricing UI. */
export function formatToman(toman: number): string {
  return `${new Intl.NumberFormat("fa-IR").format(toman)} تومان`;
}
