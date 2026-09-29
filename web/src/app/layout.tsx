import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AuthProvider } from "@/contexts/AuthContext";
import { SITE_URL } from "@/lib/siteUrl";
import "./globals.css";

// Self-hosted Vazirmatn (وزیر) — loaded locally, no CDN dependency.
const vazirmatn = localFont({
  src: [
    // No Thin (100): no `font-thin` usage anywhere in the app — loading that
    // face only wasted bytes in every page's font preload.
    { path: "../../public/fonts/Vazirmatn-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Bold.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/Vazirmatn-Black.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-vazirmatn",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "اینکارت | سامانه معرفی کسب‌وکارها",
  description: "سامانه معرفی و جست‌وجوی کسب‌وکارهای محلی",
};

// Phase 3.5 SEO: themeColor باید در export جداگانهٔ viewport باشد (Next 15+).
export const viewport: Viewport = {
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="fa"
      dir="rtl"
      data-scroll-behavior="smooth"
      className={`${vazirmatn.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/*
          موتور نقشه (SDK نشان یا fallback رستر OSM) در خود کامپوننت MapView
          با dynamic import و ssr:false بارگذاری می‌شود؛ دیگر Provider سراسری
          و نمونهٔ ماندگار نقشه وجود ندارد.
        */}
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
