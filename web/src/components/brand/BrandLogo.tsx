import Image from "next/image";

/**
 * BrandLogo — تنها منبع حقیقت برای هویت بصری InKart.
 *
 * Asset های نهایی (source of truth) دست‌نخورده باقی می‌مانند؛ هیچ فیلتر
 * CSS (invert/brightness/…) روی لوگو اعمال نمی‌شود. واریانت سفید، سمت
 * سرور با حفظ نقطهٔ تراکوتا تولید شده (scripts/generate-brand-variants.php).
 *
 * variant:
 *   - "primary" : نماد iK + واژه‌نگار InKart (هدر، فوتر، سایدبار باز، auth دسکتاپ)
 *   - "symbol"  : نماد مستقل iK (موبایل هدر، سایدبار جمع، favicon، auth موبایل)
 *
 * tone:
 *   - "dark"  : جوهر زغالی + نقطهٔ تراکوتا — برای زمینه‌های روشن (تم گرم)
 *   - "light" : مونوکروم سفید + نقطهٔ تراکوتا — برای زمینه‌های تیره
 *
 * هندسه لوگو هرگز تغییر نمی‌کند: نسبت ابعاد ذاتی asset حفظ می‌شود و
 * فقط یک بُعد (عرض برای primary، ارتفاع برای symbol) توسط مصرف‌کننده
 * تعیین می‌گردد. بدون باکس، سایه، گرادیان، glow یا قاب.
 */

const INKART_PRIMARY = { width: 482, height: 171 } as const;
const INKART_SYMBOL = { width: 212, height: 220 } as const;

const BRAND_SRC = {
  primary: {
    dark: "/brand/inkart-logo-primary.png",
    light: "/brand/inkart-logo-primary-white.png",
  },
  symbol: {
    dark: "/brand/inkart-symbol.png",
    light: "/brand/inkart-symbol-white.png",
  },
} as const;

export type BrandLogoVariant = keyof typeof BRAND_SRC;
export type BrandLogoTone = "dark" | "light";

export default function BrandLogo({
  variant = "primary",
  tone = "dark",
  /** عرض رندرشده به پیکسل — فقط برای variant="primary" (پیش‌فرض ۱۶۰). */
  width,
  /** ارتفاع رندرشده به پیکسل — فقط برای variant="symbol" (پیش‌فرض ۳۶). */
  height,
  className = "",
  priority = false,
}: {
  variant?: BrandLogoVariant;
  tone?: BrandLogoTone;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const src = BRAND_SRC[variant][tone];

  // عرض/ارتفاع رندرشده از نسبت ذاتی asset محاسبه می‌شود — کشیدگی ممنوع.
  const rendered =
    variant === "primary"
      ? {
          w: width ?? 160,
          h: Math.round((width ?? 160) * (INKART_PRIMARY.height / INKART_PRIMARY.width)),
        }
      : {
          w: Math.round((height ?? 36) * (INKART_SYMBOL.width / INKART_SYMBOL.height)),
          h: height ?? 36,
        };

  return (
    <Image
      src={src}
      alt="InKart"
      width={rendered.w}
      height={rendered.h}
      priority={priority}
      // select-none + draggable=false: لوگو هویت است، نه عنصر تعاملی متنی.
      draggable={false}
      className={`h-auto select-none ${className}`}
      style={{ width: rendered.w, height: rendered.h }}
    />
  );
}
