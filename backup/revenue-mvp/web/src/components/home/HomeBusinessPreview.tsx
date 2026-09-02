import HomeIcon from "./HomeIcon";

export default function HomeBusinessPreview() {
  return (
    <div className="relative mx-auto w-full max-w-xl">
      <div className="absolute -inset-8 rounded-[3rem] bg-emerald-200/30 blur-3xl" />
      <div className="relative homepage-glass rounded-[2rem] p-3 sm:p-5">
        <div className="overflow-hidden rounded-[1.5rem] border border-outline-variant/50 bg-white shadow-[0_24px_60px_rgb(13_28_47_/_12%)]">
          <div className="flex items-center justify-between border-b border-surface-container-high px-5 py-4">
            <span className="rounded-full bg-surface-container-low px-3 py-1 text-xs text-on-surface-variant" dir="ltr">inkart.ir/my-card</span>
            <span className="flex gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-200" /><i className="h-2 w-2 rounded-full bg-primary-fixed" /><i className="h-2 w-2 rounded-full bg-outline-variant" /></span>
          </div>
          <div className="bg-surface-container-low p-5 sm:p-8">
            <div className="rounded-[1.25rem] border border-outline-variant/50 bg-white p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h3 className="text-2xl font-extrabold text-on-surface">خانه و هنر</h3><span className="rounded-full bg-secondary-container px-2 py-1 text-[10px] font-bold text-on-secondary-container">تأیید شده</span></div>
                  <p className="mt-2 text-sm text-on-surface-variant">فروشگاه صنایع دستی</p>
                  <p className="mt-1 flex items-center gap-1 text-sm text-on-surface-variant"><HomeIcon name="location" className="h-4 w-4" /> تهران، بازار</p>
                </div>
                <div className="rounded-xl border border-outline-variant/50 p-2 text-primary"><HomeIcon name="qr" className="h-16 w-16" /></div>
              </div>
              <p className="mt-7 leading-8 text-on-surface-variant">انتخابی از هنر دست هنرمندان ایرانی؛ فضایی برای کشف، انتخاب و هدیه‌دادن.</p>
              <div className="mt-7 flex flex-wrap gap-2 border-t border-surface-container-high pt-5"><span className="rounded-full bg-primary-fixed px-3 py-1 text-xs text-primary">صنایع دستی</span><span className="rounded-full bg-primary-fixed px-3 py-1 text-xs text-primary">هدیه</span></div>
              <a href="tel:+982191000000" className="mt-5 flex items-center gap-2 text-sm font-bold text-secondary"><HomeIcon name="phone" className="h-4 w-4" /> ۰۲۱-۹۱۰۰۰۰۰۰</a>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-3 hidden items-center gap-2 rounded-full border border-outline-variant/60 bg-white/90 px-4 py-2 text-xs font-semibold text-primary shadow-lg backdrop-blur lg:flex"><HomeIcon name="check" className="h-4 w-4 text-secondary" /> همیشه در دسترس</div>
      <div className="absolute -top-5 -right-3 hidden items-center gap-2 rounded-full border border-secondary-container bg-white/90 px-4 py-2 text-xs font-semibold text-primary shadow-lg backdrop-blur lg:flex"><HomeIcon name="qr" className="h-4 w-4 text-secondary" /> اسکن QR</div>
    </div>
  );
}
