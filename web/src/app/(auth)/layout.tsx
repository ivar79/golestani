import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-[calc(100vh-80px)] flex-1 items-center justify-center bg-night px-4 py-16">
      {/* Subtle background gradient without artificial glowing orbs */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/80 via-night to-slate-950/90" />

      {/* Main Auth Card (Polaris & shadcn UI aligned) */}
      <div className="relative w-full max-w-[440px] rounded-2xl border border-white/10 bg-[#0c1626]/95 p-8 sm:p-10 shadow-2xl shadow-black/60 backdrop-blur-xl">
        <div className="mb-8 flex flex-col items-center justify-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-3 transition-opacity hover:opacity-90"
            aria-label="صفحه اصلی اینکارت"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-xl font-black text-cyan-400 shadow-sm">
              اَ
            </div>
            <span className="text-2xl font-black tracking-tight text-white">
              اینکارت
            </span>
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
