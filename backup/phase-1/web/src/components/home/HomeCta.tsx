import Link from "next/link";
import HomeIcon from "./HomeIcon";

export default function HomeCta() {
  return (
    <section className="mx-auto mt-24 w-full max-w-7xl px-4 md:px-8">
      <div className="relative flex w-full flex-col items-center justify-between gap-8 overflow-hidden rounded-3xl border border-white/10 bg-cta-deep p-8 shadow-2xl md:flex-row md:p-12">
        {/* Glow effects */}
        <div className="pointer-events-none absolute right-0 top-1/2 h-[300px] w-[300px] -translate-y-1/2 rounded-full bg-secondary/20 blur-[80px]" />
        <div className="pointer-events-none absolute left-0 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full bg-indigo-500/10 blur-[100px]" />
        <div className="relative z-10 flex flex-col gap-3">
          <h2 className="text-3xl font-bold text-white">Kas usaha Anda, layak untuk terlihat</h2>
          <p className="text-lg text-surface-variant">
            Mulai <span className="text-secondary">gratis sekarang</span> dan bangun masa depan digital usaha Anda.
          </p>
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-4">
          <a
            href="#features"
            className="flex items-center gap-2 rounded-xl px-6 py-3 text-lg font-semibold text-secondary transition-all hover:bg-secondary/10"
          >
            Selengkapnya
            <HomeIcon name="arrowLeft" className="h-5 w-5" />
          </a>
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-xl bg-secondary px-8 py-4 text-lg font-semibold text-white shadow-[0_0_20px_rgba(0,108,74,0.4)] transition-all hover:bg-secondary-container hover:text-night"
          >
            Daftar Gratis
            <HomeIcon name="rocket" className="h-6 w-6" />
          </Link>
        </div>
      </div>
    </section>
  );
}
