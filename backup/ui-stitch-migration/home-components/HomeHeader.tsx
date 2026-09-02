"use client";
import Link from "next/link";
import { cms, useHomepageContent } from "@/lib/homepage";

export default function HomeHeader() {
  const content = useHomepageContent();
  const nav = [
    { label: cms(content, "nav.features"), href: "#features" },
    { label: cms(content, "nav.showcase"), href: "#showcase" },
    { label: cms(content, "nav.about"), href: "/about" },
    { label: cms(content, "nav.contact"), href: "/contact" },
  ];
  return (
    <header className="fixed top-0 z-50 w-full border-b border-white/5 bg-night/40 shadow-[0_1px_20px_rgba(0,0,0,0.2)] backdrop-blur-xl">
      <div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 md:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3" aria-label={cms(content, "brand")}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-lg font-black text-white shadow-lg shadow-secondary/20">
              اَ
            </span>
            <span className="text-xl font-bold text-white lg:text-2xl">{cms(content, "brand")}</span>
          </Link>
          <nav className="mr-12 hidden items-center gap-8 xl:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-surface-variant transition-colors hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="rounded-xl bg-secondary px-6 py-2 text-sm font-medium text-white shadow-lg shadow-secondary/20 transition-all hover:bg-secondary-container hover:text-night"
          >
            {cms(content, "header.login")}
          </Link>
        </div>
      </div>
    </header>
  );
}
