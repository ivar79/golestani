"use client";

import { useCallback, useRef, useState } from "react";
import MapNeshanLazy from "./MapNeshanLazy";
import MapViewLazy from "./MapViewLazy";
import type { MapMarker, MapViewProps } from "./MapViewLeaflet";
import {
  canRetryNeshan,
  INITIAL_PROVIDER_HEALTH,
  markNeshanRecovered,
  neshanExhausted,
  neshanKeyPresent,
  recordNeshanFailure,
  resolveMapEngine,
  type FailureKind,
  type ProviderHealth,
} from "@/lib/mapEngine";

export type { MapMarker, MapViewProps };

export type MapViewPropsWithEvents = MapViewProps & {
  onEngineFailed?: (engine: "neshan" | "online", kind: FailureKind) => void;
  onEngineRecovered?: (engine: "neshan" | "online") => void;
};

/**
 * دیسپچر موتور نقشه — لایهٔ مقاوم دو-تأمینی با state machine:
 *
 *   neshan  → SDK رسمی نشان (موتور اصلی؛ تایل میزبانی‌شده + لیبل فارسی)
 *   online  → Leaflet + رستر مستقل (fallback؛ پیش‌فرض OSM، بدون کلید)
 *
 * انتخاب اولیه: ?mapsource=neshan|online → NEXT_PUBLIC_MAP_ENGINE →
 * خودکار (neshan اگر کلید نشان موجود باشد، وگرنه online). جزئیات در
 * web/src/lib/mapEngine.ts.
 *
 * fallback دوطرفه (بدون حلقهٔ بی‌نهایت):
 *   - خرابی init نشان → سقوط فوری به Leaflet.
 *   - خرابی تایل/استایل نشان → فقط پس از آستانهٔ state machine → Leaflet.
 *   - خرابی تایل Leaflet و کلید نشان موجود و cooldown گذشته → تلاش دوبارهٔ نشان.
 *   - بعد از MAX_NESHAN_FAILURES سقوط، دیگر خودکار به نشان برنمی‌گردیم
 *     (حالت پایدار fallback؛ کاربر با «تلاش مجدد» دستی صفحه را رفرش می‌کند).
 *
 * حفظ وضعیت: props صفحه (markers/center/zoom/userCoords/selectedId) عیناً به
 * موتور بعدی پاس می‌شود؛ دید ذخیره‌شدهٔ URL (?lat&lng&z) هم توسط هر دو موتور
 * از همان URL خوانده می‌شود — کاربر تعویض موتور را حس نمی‌کند و هیچ refetch
 * دادهٔ کسب‌وکار رخ نمی‌دهد (markers همان آرایهٔ normalized است).
 */
export default function MapView(props: MapViewPropsWithEvents) {
  const { onEngineFailed, onEngineRecovered } = props;

  // انتخاب اولیه یک‌بار در mount خوانده می‌شود (شامل override ?mapsource).
  // تغییر بعدی موتور فقط از مسیر state machine خرابی/بازیابی انجام می‌شود تا
  // رندرهای عادی صفحه هرگز سوییچ بی‌مورد نسازند.
  const [engine, setEngine] = useState<"neshan" | "online">(() => resolveMapEngine());
  const healthRef = useRef<ProviderHealth>({ ...INITIAL_PROVIDER_HEALTH });

  const handleEngineFailed = useCallback(
    (failedEngine: "neshan" | "online", kind: FailureKind) => {
      onEngineFailed?.(failedEngine, kind);

      if (failedEngine === "neshan") {
        const nowMs = Date.now();
        const confirmed = recordNeshanFailure(healthRef.current, kind, nowMs);
        if (!confirmed) return; // خطای تکی گذرا — هنوز خرابی موتور اعلام نشده
        setEngine("online");
        return;
      }

      // Leaflet هم خراب شد: فقط اگر نشان «موجود» است و در cooldown نیست و
      // هنوز سقوط‌هایش به سقف نرسیده، یک تلاش دوبارهٔ کنترل‌شده انجام می‌شود.
      if (
        neshanKeyPresent &&
        canRetryNeshan(healthRef.current, Date.now()) &&
        !neshanExhausted(healthRef.current)
      ) {
        healthRef.current.lastNeshanAttempt = Date.now();
        setEngine("neshan");
      }
      // در غیر این صورت حالت پایدار: کاربر روی fallback می‌ماند (بدون loop).
    },
    [onEngineFailed],
  );

  const handleEngineRecovered = useCallback(
    (healthyEngine: "neshan" | "online") => {
      onEngineRecovered?.(healthyEngine);
      if (healthyEngine === "neshan") {
        markNeshanRecovered(healthRef.current);
      }
    },
    [onEngineRecovered],
  );

  if (engine === "online") {
    return <MapViewLazy {...props} onEngineFailed={handleEngineFailed} />;
  }
  return (
    <MapNeshanLazy {...props} onEngineFailed={handleEngineFailed} onEngineRecovered={handleEngineRecovered} />
  );
}
