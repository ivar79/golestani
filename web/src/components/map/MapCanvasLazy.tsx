"use client";

import dynamic from "next/dynamic";
import type { MapCanvasProps } from "./MapCanvas";

/**
 * بارگذاری تنبل MapCanvas بدون اجرای سمت سرور (SSR: false)
 * مطابق بند ۳.۲ سند معماری جهت جلوگیری از خطاهای محیط بدون window/DOM
 */
const MapCanvas = dynamic(() => import("./MapCanvas"), {
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

export default function MapCanvasLazy(props: MapCanvasProps) {
  return <MapCanvas {...props} />;
}
