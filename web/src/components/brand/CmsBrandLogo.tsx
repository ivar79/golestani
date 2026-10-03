"use client";

import { useEffect, useState } from "react";
import BrandLogo, { type BrandLogoTone, type BrandLogoVariant } from "./BrandLogo";
import { fetchHomepageContentClient } from "@/lib/homepageContent";

/**
 * CmsBrandLogo — پل CMS ↔ هویت برند.
 *
 * اگر ادمین در پنل، «homepage.logo» را با یک مسیر رسانه‌ای پر کرده باشد
 * (آپلود از تب محتوای صفحه اصلی)، همان لوگو جای asset استاندارد نشان
 * داده می‌شود؛ در غیر این صورت BrandLogo هویت نهایی InKart را رندر
 * می‌کند. محتوا از سرویس‌دهندهٔ موجود (Provider یا fetch سشن) خوانده
 * می‌شود — هیچ fetch موازی‌ای اضافه نمی‌شود.
 *
 * tone دنبال‌کنندهٔ زمینه است؛ لوگوی آپلودی دست‌نخورده نشان داده می‌شود
 * (بدون فیلتر CSS) — انتخاب تصویر با شفافیت مناسب با ادمین است.
 */

let sessionCache: string | null = null;

/** مسیر رسانهٔ لوگوی CMS را (با کش سشن) برمی‌گرداند؛ null یعنی پیش‌فرض برند. */
export async function fetchCmsLogoUrl(): Promise<string | null> {
  if (sessionCache !== null) return sessionCache || null;
  try {
    const content = await fetchHomepageContentClient();
    const raw = content["homepage.logo"] ?? "";
    const { mediaUrl } = await import("@/lib/phase2");
    const resolved = raw ? mediaUrl(raw) : "";
    sessionCache = resolved || "";
  } catch {
    sessionCache = "";
  }
  return sessionCache || null;
}

/** کش سشن را پاک می‌کند تا بعد از آپلود/حذف لوگو در ادمین، دوباره خوانده شود. */
export function invalidateCmsLogoCache() {
  sessionCache = null;
}

export default function CmsBrandLogo({
  variant = "primary",
  tone = "dark",
  width,
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
  const [custom, setCustom] = useState<string | null>(sessionCache || null);

  useEffect(() => {
    if (sessionCache !== null) return;
    let cancelled = false;
    void fetchCmsLogoUrl().then((url) => {
      if (!cancelled) setCustom(url);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (custom) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={custom}
        alt="InKart"
        draggable={false}
        className={`select-none object-contain ${className}`}
        style={
          variant === "primary"
            ? { width: width ?? 160, height: "auto" }
            : { height: height ?? 36, width: "auto" }
        }
      />
    );
  }

  return (
    <BrandLogo
      variant={variant}
      tone={tone}
      width={width}
      height={height}
      className={className}
      priority={priority}
    />
  );
}
