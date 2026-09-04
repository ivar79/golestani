export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-night px-4 py-16">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[500px] bg-[radial-gradient(ellipse_at_top,#0f172a_0%,transparent_70%)] opacity-80" />
      <div className="pointer-events-none absolute left-0 top-1/4 h-[600px] w-[600px] -translate-x-1/2 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.03)_0%,transparent_60%)]" />
      <div className="pointer-events-none absolute right-0 top-1/3 h-[600px] w-[600px] translate-x-1/3 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.05)_0%,transparent_60%)]" />

      {/* Main Panel */}
      <div className="relative w-full max-w-[420px] rounded-[28px] border border-white/[0.08] bg-[#0f172a]/90 p-10 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
        <div className="mb-10 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-400/20 text-xl font-black text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.15)]">
            اَ
          </div>
          <span className="text-2xl font-black tracking-tight text-white">
            اینکارت
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
