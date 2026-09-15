"use client";

import { useEffect, useRef } from "react";

/**
 * LoginVideo — پس‌زمینهٔ ویدئویی تمام‌صفحهٔ /login (docs/design/log in.mp4).
 * فایل عمومی یک نسخهٔ ویدئویی چرخه‌ای با crossfade کوتاه در مرز لوپ است؛
 * بنابراین runtime فقط یک decoder دارد و loop مرورگر بدون پرش محسوس تکرار می‌شود.
 *
 * همان الگوی اثبات‌شدهٔ HeroVideo صفحهٔ اصلی: muted + playsInline برای پخش
 * خودکار در همهٔ مرورگرها. mix-blend لازم نیست چون پنل شیشه‌ای روی لایهٔ
 * تیره‌کنندهٔ خودش (در layout) می‌نشیند. prefers-reduced-motion → ویدئو
 * pause می‌شود و روی فریم پوستر می‌ماند (حذف نمی‌شود تا صفحه خالی نشود).
 * poster برای نمایش فوری پیش از بافر شدن ویدئو.
 */
export default function LoginVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // تضمین پخش خودکار: React اتریبیوت muted را در SSR ست نمی‌کند و برخی
  // مرورگرها policy پخش خودکار را روی اتریبیوت بررسی می‌کنند. هر دو را
  // ست می‌کنیم و در canplay دوباره play می‌زنیم تا ویدئوی متوقف نماند.
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
      if (v.paused) void v.play().catch(() => {
        /* policy رد کرد — پوستر می‌ماند */
      });
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
      poster="/video/login-poster.jpg"
      className="h-full w-full object-cover object-[76%_45%] sm:object-[70%_45%] lg:object-[62%_45%]"
      aria-hidden="true"
    >
      <source src="/video/login-loop.mp4" type="video/mp4" />
    </video>
  );
}
