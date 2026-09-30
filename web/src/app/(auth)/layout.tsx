import Link from "next/link";
import CmsBrandLogo from "@/components/brand/CmsBrandLogo";
import LoginVideo from "@/components/auth/LoginVideo";

/**
 * Auth layout — صحنهٔ سینمایی مشترک صفحات ورود و OTP (مرجع: تصویر طراحی).
 *
 * سلسله‌مراتب مرجع: چپ = پنل شیشه‌ای، راست = هستهٔ طلایی ویدئو (بدون
 * مانع)، پس‌زمینه = ویدئوی تمام‌صفحه. جای‌گذاری پنل «فیزیکی» است
 * (left + translate) تا RTL جای آن را عوض نکند؛ متن‌ها RTL می‌مانند.
 * هدر برند بالا-چپ مطابق مرجع با همان متن‌های موجود پروژه. اسکریم
 * سرمه‌ای فقط سمت چپ سنگین است و به سمت راست شفاف می‌شود. موبایل:
 * پنل وسط با تیرگی عمودی ملایم.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-night">
      {/* Full-viewport cinematic video — native composition, core sits right */}
      <div className="absolute inset-0" aria-hidden="true">
        <LoginVideo />
      </div>

      {/* Desktop: deep-navy scrim, strongest LEFT, fading to transparent RIGHT */}
      <div
        className="pointer-events-none absolute inset-0 hidden lg:block"
        style={{
          background:
            "linear-gradient(to right, rgba(4,10,20,0.82) 0%, rgba(4,10,20,0.55) 30%, rgba(2,6,23,0.18) 58%, rgba(2,6,23,0) 78%)",
        }}
        aria-hidden="true"
      />
      {/* Mobile: subtle vertical darkening — video stays recognizable */}
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#020617]/45 via-transparent to-[#020617]/60 lg:hidden"
        aria-hidden="true"
      />

      {/* Brand header, top-left (physical) over the dark video — finalized white
          logo, full primary on desktop/tablet, standalone iK symbol on mobile.
          No box/border around it. */}
      <div className="absolute left-5 top-5 z-20 sm:left-8 sm:top-6 lg:left-10 lg:top-8">
        <Link
          href="/"
          dir="ltr"
          aria-label="رفتن به صفحه اصلی اینکارت"
          className="flex items-center transition-opacity duration-200 hover:opacity-80"
        >
          {/* LCP صفحات ورود/ثبت‌نام: لوگو تنها محتوای above-the-fold است. */}
          <CmsBrandLogo variant="symbol" tone="light" height={36} className="sm:hidden" priority />
          <CmsBrandLogo variant="primary" tone="light" width={140} className="hidden sm:block" priority />
        </Link>
      </div>

      {/*
        Content — panel physically on the LEFT on desktop (vertical center),
        generous empty space toward the golden core; centered on mobile.
      */}
      <div className="relative z-10 flex min-h-screen w-full items-center justify-center px-5 py-16 sm:px-8 lg:block">
        <div className="w-full max-w-[400px] lg:absolute lg:left-[10%] lg:top-1/2 lg:w-[460px] lg:max-w-none lg:-translate-y-1/2 xl:left-[11%]">
          {children}
        </div>
      </div>
    </div>
  );
}
