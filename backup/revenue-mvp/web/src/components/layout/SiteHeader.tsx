import Link from "next/link";

export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-9 w-9 rounded-xl text-base" : "h-11 w-11 rounded-2xl text-xl";
  const text = size === "sm" ? "text-lg" : "text-xl";
  return (
    <>
      <span
        className={`flex ${box} items-center justify-center bg-navy-800 font-black text-white shadow-lg shadow-navy-800/25`}
      >
        اَ
      </span>
      <span className={`${text} font-black tracking-tight text-navy-900`}>اینکارت</span>
    </>
  );
}

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 flex w-full items-center justify-between border-b border-navy-100/70 bg-white/80 px-6 py-4 shadow-[0_4px_20px_rgb(13_28_47_/_4%)] backdrop-blur-xl backdrop-blur-xl lg:px-12 xl:px-16">
      <Link href="/" className="flex items-center gap-3" aria-label="صفحه اصلی اینکارت">
        <BrandMark />
      </Link>
      <nav className="hidden items-center gap-8 text-sm font-medium text-zinc-600 md:flex">
        <Link href="/about" className="transition hover:text-navy-700">درباره ما</Link>
        <Link href="/contact" className="transition hover:text-navy-700">تماس با ما</Link>
        <Link
          href="/login"
          className="rounded-full border border-navy-200 bg-white px-5 py-2.5 text-navy-800 shadow-sm transition hover:border-emerald-300 hover:text-emerald-700"
        >
          ورود
        </Link>
      </nav>
      <Link
        href="/login"
        className="rounded-full bg-navy-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy-700 md:hidden"
      >
        ورود
      </Link>
    </header>
  );
}
