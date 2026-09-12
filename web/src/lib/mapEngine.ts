/**
 * موتور رندر نقشه — دو موتور سوییچ‌پذیر:
 *
 *   neshan  → SDK رسمی نشان (@neshan-maps-platform/maplibre-sdk) با تایل‌های
 *             میزبانی‌شدهٔ نشان، لیبل فارسی و استایل‌های آماده. موتور اصلی؛
 *             نیازمند NEXT_PUBLIC_NESHAN_MAP_KEY.
 *   online  → fallback لیفلت + رستر عمومی OSM؛ همیشه کار می‌کند (بدون کلید).
 *
 * اولویت انتخاب:
 *   ۱. پارامتر URL ?mapsource=neshan|online  (override دیباگ/ادمین)
 *   ۲. NEXT_PUBLIC_MAP_ENGINE در web/.env.local
 *   ۳. پیش‌فرض خودکار: neshan اگر کلید نشان موجود باشد، وگرنه online
 */
export type MapEngine = "neshan" | "online";

/** کلید پلتفرم نشان — از platform.neshan.org دریافت و در web/.env.local گذاشته می‌شود. */
export const neshanApiKey: string = (process.env.NEXT_PUBLIC_NESHAN_MAP_KEY ?? "").trim();

export const neshanKeyPresent = neshanApiKey.length > 0;

/** نام استایل آمادهٔ نشان (dark|light|monochrome_light|monochrome_dark|pastel) یا URL کامل JSON. */
export const neshanStyle: string =
  (process.env.NEXT_PUBLIC_NESHAN_MAP_STYLE ?? "").trim() || "dark";

/** URL استایل میزبانی‌شدهٔ نشان؛ اگر مقدار env خودش URL باشد همان استفاده می‌شود. */
export function neshanStyleUrl(): string {
  if (/^https?:\/\//i.test(neshanStyle)) return neshanStyle;
  return `https://static.neshan.org/sdk/maplibre/styles/${neshanStyle}.json`;
}

/** URL قالب تایل رستر OSM برای fallback (با attribution اجباری OSM). */
export function osmRasterUrl(): string {
  return process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
}

export const osmAttribution =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

const VALID: MapEngine[] = ["neshan", "online"];

/**
 * موتور فعال را برمی‌گرداند. روی سرور (بدون window) فقط env/پیش‌فرض بررسی
 * می‌شود؛ پارامتر URL در سمت کلاینت خوانده می‌شود.
 */
export function resolveMapEngine(): MapEngine {
  // ۱. override از URL (فقط کلاینت)
  if (typeof window !== "undefined") {
    try {
      const q = new URLSearchParams(window.location.search).get("mapsource");
      if (q && (VALID as string[]).includes(q)) return q as MapEngine;
    } catch {
      /* ignore */
    }
  }
  // ۲. تنظیم صریح build/env
  const raw = (process.env.NEXT_PUBLIC_MAP_ENGINE ?? "").trim().toLowerCase();
  if ((VALID as string[]).includes(raw)) return raw as MapEngine;
  // ۳. پیش‌فرض خودکار
  return neshanKeyPresent ? "neshan" : "online";
}
