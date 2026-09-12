"use client";

import dynamic from "next/dynamic";
import type { MapViewProps } from "./MapView";

/**
 * بارگذاری تنبل موتور نشان — SDK به window/DOM دسترسی دارد و هرگز نباید روی
 * سرور اجرا شود (ssr:false). placeholder تیره هم‌راستا با تم نقشه.
 */
const MapNeshan = dynamic(() => import("./MapNeshan"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0e1726] text-slate-400">
      <div className="flex flex-col items-center gap-2">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
        <span className="text-xs text-slate-400">در حال آماده‌سازی نقشه...</span>
      </div>
    </div>
  ),
});

export default function MapNeshanLazy(props: MapViewProps) {
  return <MapNeshan {...props} />;
}
