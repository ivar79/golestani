import CmsBrandLogo from "@/components/brand/CmsBrandLogo";

/**
 * BrandMark — نشان برند برای هدر/فوتر صفحات فرعی (زمینه روشن).
 * روی CmsBrandLogo سوار است تا هم هویت نهایی حفظ شود و هم لوگوی
 * سفارشی CMS (در صورت ست‌شدن) در صفحات فرعی هم اعمال گردد.
 */
export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  return <CmsBrandLogo variant="primary" tone="dark" width={size === "sm" ? 130 : 150} />;
}
