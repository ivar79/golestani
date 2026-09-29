"use client";

import { useEffect, useRef, useState } from "react";

/**
 * HeroVideo — پس‌زمینهٔ متحرک قهرمان صفحهٔ اصلی.
 *
 * Phase 3.5 perf (baseline + after-driven): Lighthouse نشان داد ویدئوی wave
 * (≈900KB webm) در حالت موبایل شبیه‌سازی‌شده همزمان با تصویر LCP
 * (hero-2.jpg) پهنای‌باند می‌گیرد و LCP را به ~۶s می‌راند.
 *
 * راه‌حل نهایی — «خروج کامل ویدئو از پنجرهٔ بحرانی» بدون خالی‌شدن Hero:
 *  - عنصر <video> همیشه با poster رندر می‌شود (فریم پوستر بلافاصله
 *    نمایان است؛ حتی بدون JS ظاهر هیرو حفظ می‌شود — CLS صفر).
 *  - preload="none": تا لحظهٔ play هیچ بایتی از ویدئو دانلود نمی‌شود.
 *  - sourceها فقط پس از `window load` (یا timeoutهای ایمنی ۱.۲/۳.۵ ثانیه)
 *    وصل می‌شوند؛ یعنی ویدئو حتماً بعد از منابع بحرانی (HTML/فونت‌ها/
 *    تصویر LCP) وارد جریان دانلود می‌شود.
 *  - تعویض پوستر→فریم اول ویدئو همان تصویر است؛ هیچ پرش بصری رخ نمی‌دهد.
 *  - prefers-reduced-motion: ویدئو هرگز شروع نمی‌شود؛ پوستر می‌ماند.
 */

export default function HeroVideo() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [sourcesReady, setSourcesReady] = useState(false);

  useEffect(() => {
    // پنجرهٔ بحرانی: ویدئو فقط پس از window load (یا timeoutهای ایمنی
    // زیر) وارد جریان دانلود می‌شود تا با تصویر LCP/فونت‌ها رقابت نکند.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      setSourcesReady(true);
    };
    // fallback: اگر load دیر آمد، حداکثر ۱.۲ ثانیه بعد وصل می‌شود؛
    // سقف مطلق ۳.۵ ثانیه برای محیط‌های کندتر. تصمیم reduced-motion
    // نیز در همین لحظه (async) گرفته می‌شود.
    const fallback = window.setTimeout(settle, 1200);
    const absolute = window.setTimeout(settle, 3500);
    window.addEventListener("load", settle, { once: true });

    return () => {
      clearTimeout(fallback);
      clearTimeout(absolute);
      window.removeEventListener("load", settle);
    };
  }, []);

  // تضمین پخش خودکار پس از اتصال منبع: React اتریبیوت muted را در SSR
  // ست نمی‌کند و برخی مرورگرها policy پخش خودکار را روی اتریبیوت
  // بررسی می‌کنند؛ هر دو را ست می‌کنیم و در canplay دوباره play می‌زنیم.
  // prefers-reduced-motion: pause — پوستر می‌ماند. تغییر زنده هم گرفته می‌شود.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !sourcesReady) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    v.muted = true;
    v.defaultMuted = true;
    const ensure = () => {
      if (reduced.matches) {
        v.pause();
        return;
      }
      if (v.paused) void v.play().catch(() => {/* policy رد کرد — پوستر می‌ماند */});
    };
    ensure();
    v.addEventListener("canplay", ensure);
    reduced.addEventListener("change", ensure);
    return () => {
      v.removeEventListener("canplay", ensure);
      reduced.removeEventListener("change", ensure);
    };
  }, [sourcesReady]);

  return (
    <video
      ref={videoRef}
      loop
      muted
      playsInline
      preload="none"
      poster="/video/hero-wave-poster.jpg"
      className="h-full w-full object-cover mix-blend-lighten"
      aria-hidden="true"
    >
      {sourcesReady ? (
        <>
          <source src="/video/hero-wave-loop.webm" type="video/webm" />
          <source src="/video/hero-wave-loop.mp4" type="video/mp4" />
        </>
      ) : null}
    </video>
  );
}
