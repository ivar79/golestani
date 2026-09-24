/**
 * موتور رندر نقشه — لایهٔ مقاوم دو-تأمینی (Provider Manager)
 *
 *   neshan  → SDK رسمی نشان (@neshan-maps-platform/maplibre-sdk) با تایل‌های
 *             میزبانی‌شدهٔ نشان، لیبل فارسی و استایل‌های آماده. موتور اصلی؛
 *             نیازمند NEXT_PUBLIC_NESHAN_MAP_KEY.
 *   online  → fallback لیفلت + رستر عمومی (پیش‌فرض OSM)؛ منبع تایل کاملاً
 *             مستقل از نشان و با NEXT_PUBLIC_LEAFLET_TILE_URL قابل تعویض.
 *
 * اولویت انتخاب موتور:
 *   ۱. پارامتر URL ?mapsource=neshan|online  (override دیباگ/ادمین)
 *   ۲. NEXT_PUBLIC_MAP_ENGINE در web/.env.local
 *   ۳. پیش‌فرض خودکار: neshan اگر کلید نشان موجود باشد، وگرنه online
 *
 * لایهٔ مقاوم‌سازی (fallback دوطرفه بدون حلقهٔ بی‌نهایت):
 *   - خرابی راه‌اندازی نشان → سقوط فوری به لیفلت (MapView این را مدیریت می‌کند).
 *   - خرابی تایل/استایل فقط بعد از TILE_FAILURE_THRESHOLD خطای بحرانی در
 *     TILE_FAILURE_WINDOW_MS «خرابی موتور» اعلام می‌شود؛ یک خطای تکی گذرا سبب
 *     تعویض موتور نمی‌شود.
 *   - بعد از هر سقوط، شمارنده سقوط ذخیره می‌شود؛ پس از RETRY_COOLDOWN_MS تلاش
 *     دوبارهٔ نشان مجاز است (حداکثر MAX_NESHAN_FAILURES بار) و در نهایت حالت
 *     پایدار fallback با پیام کاربرپسند + «تلاش مجدد» دستی می‌ماند.
 *   - موفقیتِ دوبارهٔ نشان، شمارنده‌ها را صفر می‌کند (recovery).
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

/**
 * منبع تایل موتور fallback — عمداً کاملاً مستقل از نشان (OpenStreetMap عمومی
 * به‌عنوان پیش‌فرض، با attribution اجباری). قابل تعویض با
 * NEXT_PUBLIC_LEAFLET_TILE_URL تا برای بارِ production یک تأمین‌کنندهٔ مجاز و
 * مقیاس‌پذیر (طبق سیاست استفادهٔ تایل‌ها) تنظیم شود، بدون هیچ تغییری در کد.
 * (نام قدیمی NEXT_PUBLIC_MAP_TILE_URL هم برای سازگاری خوانده می‌شود.)
 */
export function osmRasterUrl(): string {
  return (
    process.env.NEXT_PUBLIC_LEAFLET_TILE_URL ??
    process.env.NEXT_PUBLIC_MAP_TILE_URL ??
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  );
}

export const osmAttribution =
  process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

const VALID: MapEngine[] = ["neshan", "online"];

// ---------------------------------------------------------------------------
// ماشین وضعیت تأمین‌کننده (provider state machine) — خالص و قابل تست
// ---------------------------------------------------------------------------

/** خطای راه‌اندازی/پیکربندی: سقوط فوری به fallback. */
export const FAILURE_KIND_INIT = "init" as const;
/** خطای تایل/استایل: فقط پس از چند تکرار در پنجرهٔ کوتاه خرابی اعلام می‌شود. */
export const FAILURE_KIND_TILE = "tile" as const;

export type FailureKind = typeof FAILURE_KIND_INIT | typeof FAILURE_KIND_TILE;

/** چند خطای بحرانی تایل در پنجرهٔ زمانی قبل از اعلام خرابی موتور. */
export const TILE_FAILURE_THRESHOLD = 3;
/** پنجرهٔ زمانی شمارش خطاهای تایل (میلی‌ثانیه). */
export const TILE_FAILURE_WINDOW_MS = 20_000;
/** فاصلهٔ حداقلی بین تلاش‌های مجاز نشان پس از سقوط (میلی‌ثانیه). */
export const RETRY_COOLDOWN_MS = 60_000;
/** حداکثر تعداد سقوط نشان قبل از پایدارشدن روی fallback. */
export const MAX_NESHAN_FAILURES = 3;

export type ProviderHealth = {
  /** تعداد سقوط‌های ثبت‌شدهٔ نشان (init یا tile-تأییدشده). */
  neshanFailures: number;
  /** زمان‌های (epoch ms) خطاهای تایل در پنجرهٔ فعلی. */
  tileFailures: number[];
  /** آخرین زمان تلاش برای نشان (epoch ms) — برای cooldown. */
  lastNeshanAttempt: number | null;
};

export const INITIAL_PROVIDER_HEALTH: ProviderHealth = {
  neshanFailures: 0,
  tileFailures: [],
  lastNeshanAttempt: null,
};

/** آیا الان وقت تلاش مجدد برای نشان است؟ (cooldown — منطق خالص بدون DOM) */
export function canRetryNeshan(health: ProviderHealth, nowMs: number): boolean {
  if (health.lastNeshanAttempt == null) return true;
  return nowMs - health.lastNeshanAttempt >= RETRY_COOLDOWN_MS;
}

/**
 * ثبت یک خطای تایل (برای هر تأمین‌کننده‌ای). فقط وقتی TILE_FAILURE_THRESHOLD
 * خطا در TILE_FAILURE_WINDOW_MS جمع شود true برمی‌گرداند — یعنی «خرابی
 * تأیید شد». یک خطای تکی گذرا فقط شمارش می‌شود و false برمی‌گرداند.
 */
export function recordTileFailure(health: ProviderHealth, nowMs: number): boolean {
  const recent = health.tileFailures.filter((t) => nowMs - t <= TILE_FAILURE_WINDOW_MS);
  recent.push(nowMs);
  health.tileFailures = recent;
  return recent.length >= TILE_FAILURE_THRESHOLD;
}

/**
 * ثبت یک خرابی موتور نشان. قواعد:
 *  - init → سقوط فوری (fallback فوری، بدون انتظار پنجره).
 *  - tile → فقط وقتی TILE_FAILURE_THRESHOLD خطا در TILE_FAILURE_WINDOW_MS
 *    جمع شود خرابی حساب می‌شود (خطای تکی گذرا نادیده گرفته می‌شود).
 * خروجی true یعنی «خرابی تأیید شد»؛ false یعنی فقط شمارش شد.
 */
export function recordNeshanFailure(
  health: ProviderHealth,
  kind: FailureKind,
  nowMs: number,
): boolean {
  if (kind === FAILURE_KIND_TILE) {
    return recordTileFailure(health, nowMs);
  }
  health.neshanFailures += 1;
  health.lastNeshanAttempt = nowMs;
  return true;
}

/** پس از تشخیص خرابی، پنجرهٔ تایل خالی می‌شود (شمارش از نو). */
export function resetTileFailureWindow(health: ProviderHealth): void {
  health.tileFailures = [];
}

/** بازیابی موفق نشان: کل شمارنده‌ها صفر می‌شود. */
export function markNeshanRecovered(health: ProviderHealth): void {
  health.neshanFailures = 0;
  health.tileFailures = [];
  health.lastNeshanAttempt = Date.now();
}

/** آیا نشان پس از سقوط‌های مکرر دیگر نباید خودکار تلاش شود؟ */
export function neshanExhausted(health: ProviderHealth): boolean {
  return health.neshanFailures >= MAX_NESHAN_FAILURES;
}

/**
 * انتخاب center/zoom مؤثر: اگر دیدِ ذخیره‌شده از موتور قبلی موجود باشد همان
 * استفاده می‌شود (حفظ وضعیت هنگام fallback)؛ وگرنه props صفحه.
 */
export function pickRestoredView(
  restored: { lat: number; lng: number; zoom: number } | null,
  center?: [number, number],
  zoom?: number,
): { center: [number, number] | undefined; zoom: number | undefined } {
  if (restored) return { center: [restored.lat, restored.lng], zoom: restored.zoom };
  return { center, zoom };
}

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
