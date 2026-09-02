import HomeIcon from "./HomeIcon";

const samples = [
  { title: "کلینیک دندان‌پزشکی", subtitle: "دکتر حمید هاشمی", accent: "from-[#1a233a] to-[#0a1128]" },
  { title: "کافه رستوران نت", subtitle: "خوشمزه و بی‌نظیر", accent: "from-[#2a2320] to-[#0a1128]" },
  { title: "گروه طراحی وب", subtitle: "خلاقیت در طراحی", accent: "from-[#1a132a] to-[#0a1128]" },
] as const;

const steps = [
  { icon: "storefront", num: "۰۱", title: "ثبت کسب‌وکار", description: "اطلاعات کسب‌وکار خود را ثبت کنید." },
  { icon: "badge", num: "۰۲", title: "ساخت کارت دیجیتال", description: "کارت و صفحه اختصاصی کسب‌وکار شما آماده می‌شود." },
  { icon: "groups", num: "۰۳", title: "دیده شدن و رشد", description: "مشتریان شما را پیدا می‌کنند و با شما ارتباط می‌گیرند." },
] as const;

export default function HomeShowcase() {
  return (
    <section id="showcase" className="mx-auto mt-24 w-full max-w-7xl px-4 md:px-8">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Sample cards panel */}
        <div className="flex flex-col rounded-3xl border border-white/5 bg-panel/40 p-8 backdrop-blur-lg">
          <div className="mb-8 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-white">نمونه کارت‌های دیجیتال</h2>
            <span className="flex items-center gap-1 text-sm text-secondary">
              مشاهده همه
              <HomeIcon name="chevron" className="h-4 w-4 rotate-180" />
            </span>
          </div>
          <div className="mask-edge-fade -mx-4 flex gap-4 overflow-hidden px-4 py-4">
            {samples.map((card) => (
              <div
                key={card.title}
                className={`group relative flex h-[220px] min-w-[160px] flex-col overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b ${card.accent} p-3 shadow-lg transition-transform hover:-translate-y-2`}
              >
                <div className="relative z-10 flex h-full flex-col items-center justify-between">
                  <div className="mt-2 flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/20 bg-panel text-sm font-black text-secondary">اَ</div>
                  <div className="mt-2 w-full truncate text-center text-sm font-medium text-white">
                    {card.title}
                    <div className="w-full truncate text-[10px] text-surface-variant">{card.subtitle}</div>
                  </div>
                  <div className="mt-auto w-full rounded-md bg-white p-1">
                    <HomeIcon name="qr" className="aspect-square w-full text-night" strokeWidth={1.2} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex justify-center gap-2">
            <div className="h-2 w-2 rounded-full bg-secondary" />
            <div className="h-2 w-2 rounded-full bg-white/20" />
            <div className="h-2 w-2 rounded-full bg-white/20" />
            <div className="h-2 w-2 rounded-full bg-white/20" />
          </div>
        </div>

        {/* How it works panel */}
        <div className="relative flex flex-col overflow-hidden rounded-3xl border border-white/5 bg-panel/40 p-8 backdrop-blur-lg">
          <h2 className="mb-12 text-center text-2xl font-bold text-white">چطور کار می‌کند؟</h2>
          {/* Neon wave */}
          <div className="pointer-events-none absolute inset-0 top-32 opacity-40">
            <svg className="h-32 w-full" preserveAspectRatio="none" viewBox="0 0 1000 200">
              <path className="animate-dash" d="M0,100 Q250,0 500,100 T1000,100" fill="none" stroke="url(#neon-grad)" strokeDasharray="10 5" strokeWidth="3" />
              <defs>
                <linearGradient id="neon-grad" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor="#006c4a" stopOpacity="0" />
                  <stop offset="50%" stopColor="#82f5c1" />
                  <stop offset="100%" stopColor="#006c4a" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div className="relative z-10 flex items-start justify-between">
            {steps.map((step, index) => (
              <div key={step.num} className={`flex flex-1 flex-col items-center text-center ${index === 1 ? "pt-8" : ""}`}>
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border-2 border-secondary/50 bg-night shadow-[0_0_20px_rgba(0,108,74,0.3)]">
                  <HomeIcon name={step.icon} className="h-7 w-7 text-secondary" />
                </div>
                <div className="mb-1 font-bold text-secondary">{step.num}</div>
                <h4 className="mb-2 text-lg font-semibold text-white">{step.title}</h4>
                <p className="max-w-[180px] text-sm leading-5 text-surface-variant">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
