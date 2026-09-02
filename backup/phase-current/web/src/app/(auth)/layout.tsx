export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#faf9f6_40%,#eef3f8_100%)] px-4 py-16">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(48rem_22rem_at_75%_-15%,rgba(30,58,95,0.10),transparent_70%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(40rem_20rem_at_15%_-10%,rgba(5,150,105,0.08),transparent_70%)]" />
      <div className="relative w-full max-w-md rounded-2xl border border-navy-100 bg-white p-8 shadow-[0_18px_45px_-24px_rgba(14,27,46,0.35)]">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-800 text-lg font-black text-white shadow-lg shadow-navy-800/25">اَ</span>
          <span className="text-lg font-black tracking-tight text-navy-900">اینکارت</span>
        </div>
        {children}
      </div>
    </div>
  );
}
