"use client";
import { forwardRef } from "react";
import type { Business } from "@/lib/businesses";

type Props = { business: Business; template: "classic" | "midnight" | "emerald"; theme: "navy" | "emerald" | "warm"; fontSize: "small" | "medium" | "large" };
const themes = { navy: "bg-[#1e3a5f]", emerald: "bg-emerald-700", warm: "bg-amber-700" };
const templates = { classic: "rounded-2xl", midnight: "rounded-[2rem]", emerald: "rounded-lg" };

const CardCanvas = forwardRef<HTMLDivElement, Props>(function CardCanvas({ business, template, theme, fontSize }, ref) {
  return <div ref={ref} dir="rtl" className={`flex aspect-[1.586/1] w-full max-w-2xl flex-col justify-between p-7 text-white shadow-2xl ${themes[theme]} ${templates[template]} ${fontSize === "small" ? "text-sm" : fontSize === "large" ? "text-lg" : "text-base"}`}>
    <div className="flex items-start justify-between gap-4"><div><p className="text-2xl font-black">{business.name}</p><p className="mt-1 text-white/75">{business.category || "کسب‌وکار حرفه‌ای"}</p></div><div className="rounded-xl bg-white/15 px-3 py-2 text-xs font-bold">اینکارت</div></div>
    <div className="flex items-end justify-between gap-4"><div className="space-y-1 text-white/85"><p>{business.phone || "شماره تماس"}</p><p>{[business.city, business.neighborhood].filter(Boolean).join("، ") || "آدرس کسب‌وکار"}</p><p dir="ltr" className="text-left">inkart.ir/b/{business.slug}</p></div><div className="flex h-20 w-20 items-center justify-center rounded-xl bg-white text-xs font-black text-[#022448]">QR</div></div>
  </div>;
});
export default CardCanvas;
