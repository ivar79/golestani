"use client";

import { useEffect, useRef } from "react";

/**
 * HeroVideo — پس‌زمینهٔ متحرک قهرمان صفحهٔ اصلی (جایگزین hero-1.jpg).
 *
 * ویدئوی موج ذرات (docs/design/homepage/1.mp4) به‌صورت لوپ بی‌صدا پخش
 * می‌شود و با همان mix-blend-lighten تصویر قبلی ترکیب می‌شود تا ظاهر
 * نهایی عیناً همان حال‌وهوای قبلی باشد — فقط متحرک.
 *
 * - ترتیب source ها استاندارد وب: مرورگر اولین فرمت قابل‌پشتیبانی را
 *   برمی‌دارد (کروم/فایرفاکس/اج → webm سبک‌تر؛ سافاری → mp4).
 * - muted + playsInline → پخش خودکار مجاز در همهٔ مرورگرها.
 * - poster → تا بافر شدن ویدئو، فریم اولِ خود ویدئو نمایش داده می‌شود
 *   و هیچ پرش تصویری (aurora → wave) رخ نمی‌دهد.
 * - prefers-reduced-motion → ویدئو pause می‌شود و روی فریم پوستر می‌ماند؛
 *   پس‌زمینه حذف نمی‌شود، فقط انیمیشن متوقف است (مقابله با display:none
 *   که پوستر را هم از بین می‌برد و هیرو را بی‌رمق می‌گذاشت).
 */
export default function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // تضمین پخش خودکار: React اتریبیوت muted را در SSR ست نمی‌کند (تنها
  // پراپرتی بعد از هیدریشن) و برخی مرورگرها policy پخش خودکار را روی
  // اتریبیوت بررسی می‌کنند. هر دو را ست می‌کنیم و در canplay دوباره play
  // می‌زنیم تا هیچ حالتی ویدئوی متوقف نماند.
  // prefers-reduced-motion: به‌جای مخفی‌کردن ویدئو، آن را pause می‌کنیم —
  // فریم پوستر می‌ماند و فضا/رنگ پس‌زمینه حفظ می‌شود. تغییر زندهٔ تنظیم
  // (media change) هم گرفته می‌شود تا بدون رفرش اعمال شود.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const ensure = () => {
      if (reducedMotion.matches) {
        v.pause();
        return;
      }
      if (v.paused) void v.play().catch(() => {/* policy رد کرد — پوستر می‌ماند */});
    };
    ensure();
    v.addEventListener("canplay", ensure);
    reducedMotion.addEventListener("change", ensure);
    return () => {
      v.removeEventListener("canplay", ensure);
      reducedMotion.removeEventListener("change", ensure);
    };
  }, []);

  return (
    <video
      ref={videoRef}
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      poster="/video/hero-wave-poster.jpg"
      className="h-full w-full object-cover mix-blend-lighten"
      aria-hidden="true"
    >
      <source src="/video/hero-wave-loop.webm" type="video/webm" />
      <source src="/video/hero-wave-loop.mp4" type="video/mp4" />
    </video>
  );
}
