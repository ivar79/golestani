import HomeIcon, { type HomeIconName } from "./HomeIcon";

const features: { icon: HomeIconName; title: string; description: string }[] = [
  {
    icon: "contactPage",
    title: "معرفی حرفه‌ای کسب‌وکار",
    description: "صفحه اختصاصی و لینک اختصاصی برای معرفی کسب‌وکار، خدمات، اطلاعات تماس.",
  },
  {
    icon: "qrScanner",
    title: "کارت ویزیت دیجیتال هوشمند",
    description: "کارت دیجیتال، QR Code، ذخیره مخاطب، مسیریابی شبکه‌های اجتماعی و بیشتر.",
  },
  {
    icon: "search",
    title: "دیده شدن در جستجو",
    description: "در نتایج جستجو و نقشه‌ها دیده شوید و مشتریان جدید را جذب کنید.",
  },
];

export default function HomeFeatures() {
  return (
    <section id="features" className="relative z-20 mx-auto -mt-16 w-full max-w-7xl px-4 md:px-8">
      <div className="grid grid-cols-1 gap-6 rounded-3xl border border-white/10 bg-panel/60 p-6 shadow-2xl backdrop-blur-xl md:grid-cols-3 lg:p-8">
        {features.map((feature, index) => (
          <div
            key={feature.title}
            className="group relative flex flex-col items-center gap-4 rounded-2xl p-6 text-center transition-colors hover:bg-white/5"
          >
            {index === 1 && (
              <>
                <div className="absolute inset-y-8 left-0 hidden w-px bg-gradient-to-b from-transparent via-white/10 to-transparent md:block" />
                <div className="absolute inset-y-8 right-0 hidden w-px bg-gradient-to-b from-transparent via-white/10 to-transparent md:block" />
              </>
            )}
            <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border border-secondary/20 bg-secondary/10 shadow-[0_0_15px_rgba(0,108,74,0.2)] transition-transform group-hover:scale-110">
              <HomeIcon name={feature.icon} className="h-8 w-8 text-secondary" />
            </div>
            <h3 className="text-lg font-semibold text-white">{feature.title}</h3>
            <p className="text-sm leading-6 text-surface-variant">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
