"use client";

import { useEffect, useState } from "react";
import { ArrowUp, MapPin, Plus } from "lucide-react";
import { useRouter } from "next/navigation";

type Action = {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
};

/**
 * Floating action button (FAB) — terracotta accent in the warm theme,
 * cyan-accented in the dark theme (via --ik-accent tokens).
 * Expands into quick actions; on business page opens the edit form,
 * elsewhere offers scroll-to-top. Appears after slight scrolling.
 */
export function DashboardFab({ hasBusiness }: { hasBusiness: boolean }) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 240);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const actions: Action[] = hasBusiness
    ? [
        {
          label: "ویرایش کسب‌وکار",
          icon: <Plus size={16} />,
          onClick: () => router.push("/dashboard?tab=business"),
        },
        {
          label: "موقعیت روی نقشه",
          icon: <MapPin size={16} />,
          onClick: () => router.push("/dashboard?tab=location"),
        },
        {
          label: "بازگشت به بالا",
          icon: <ArrowUp size={16} />,
          onClick: toTop,
        },
      ]
    : [
        {
          label: "ثبت کسب‌وکار جدید",
          icon: <Plus size={16} />,
          onClick: () => router.push("/dashboard?tab=business"),
        },
        { label: "بازگشت به بالا", icon: <ArrowUp size={16} />, onClick: toTop },
      ];

  return (
    <div
      className={`fixed bottom-6 left-6 z-40 flex flex-col items-start gap-2 transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
      dir="rtl"
    >
      {actions.map((a, i) => (
        <button
          key={a.label}
          type="button"
          onClick={() => {
            setOpen(false);
            a.onClick();
          }}
          className={`flex items-center gap-2 rounded-full border border-ik-accent/40 bg-ik-accent px-3.5 py-2 text-[11px] font-bold text-ik-accent-contrast shadow-lg shadow-ik-accent/25 transition-all duration-200 hover:bg-ik-accent-hover ${
            open
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0"
          }`}
          style={{ transitionDelay: `${open ? (actions.length - 1 - i) * 40 : 0}ms` }}
        >
          {a.icon}
          <span>{a.label}</span>
        </button>
      ))}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "بستن منوی شناور" : "منوی شناور"}
        className={`flex h-13 w-13 items-center justify-center rounded-full border border-ik-accent/50 bg-ik-accent text-ik-accent-contrast shadow-xl shadow-ik-accent/30 transition-all duration-300 hover:scale-105 hover:bg-ik-accent-hover ${
          open ? "rotate-45" : "rotate-0"
        }`}
        style={{ height: 52, width: 52 }}
      >
        <Plus size={22} strokeWidth={2.5} />
      </button>
    </div>
  );
}
