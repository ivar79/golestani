import Link from "next/link";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import HomeBusinessPreview from "@/components/home/HomeBusinessPreview";
import HomeIcon from "@/components/home/HomeIcon";

const categories = [
  ["رستوران و کافه", "غذا، نوشیدنی و تجربه‌های محلی"],
  ["خدمات حرفه‌ای", "متخصصان قابل اعتماد نزدیک شما"],
  ["فروشگاه‌های محلی", "محصولات خاص و کسب‌وکارهای منتخب"],
] as const;

const benefits = [
  ["معرفی حرفه‌ای", "کسب‌وکار خود را با اطلاعات روشن، کامل و قابل اعتماد معرفی کنید."],
  ["پروفایل اختصاصی", "صفحه‌ای همیشه در دسترس برای نمایش خدمات و راه‌های ارتباطی شما."],
  ["پیدا شدن آسان", "مخاطبان خدمات و کسب‌وکارهای موردنیازشان را ساده‌تر پیدا می‌کنند."],
] as const;

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-surface text-on-surface">
      <SiteHeader />

      <section className="relative bg-[linear-gradient(180deg,#ffffff_0%,#f8f9ff_58%,#eff4ff_100%)] px-6 pb-20 pt-12 lg:px-10 lg:pb-28 lg:pt-20">
        <div className="pointer-events-none absolute -right-32 -top-40 h-[34rem] w-[34rem] rounded-full bg-primary-fixed/50 blur-3xl" />
        <div className="pointer-events-none absolute -left-32 top-40 h-80 w-80 rounded-full bg-secondary-container/30 blur-3xl" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-16 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="order-2 text-right lg:order-1">
            <span className="inline-flex items-center gap-2 rounded-full border border-secondary-container bg-secondary-container/40 px-4 py-2 text-sm font-semibold text-on-secondary-container"><HomeIcon name="check" className="h-4 w-4" /> شبکه‌ای برای کسب‌وکارهای بهتر</span>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.35] tracking-tight text-primary sm:text-5xl lg:text-[3.5rem]">کسب‌وکارتان را <span className="text-secondary">حرفه‌ای‌تر</span> معرفی کنید.</h1>
            <p className="mt-6 max-w-xl text-lg leading-9 text-on-surface-variant">اینکارت، خانه دیجیتال کسب‌وکار شماست؛ جایی برای معرفی خدمات، ارتباط با مشتریان و پیدا شدن در میان کسب‌وکارهای محلی.</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-7 py-4 font-bold text-white shadow-[0_12px_25px_rgb(2_36_72_/_20%)] transition hover:bg-primary-container"><span>ثبت کسب‌وکار</span><HomeIcon name="arrow" className="h-5 w-5" /></Link>
              <Link href="/login" className="inline-flex items-center justify-center rounded-xl border border-outline-variant bg-white px-7 py-4 font-bold text-primary transition hover:border-secondary hover:text-secondary">ورود به حساب</Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-on-surface-variant"><span className="inline-flex items-center gap-2"><HomeIcon name="check" className="h-4 w-4 text-secondary" /> پروفایل تأییدشده</span><span className="inline-flex items-center gap-2"><HomeIcon name="qr" className="h-4 w-4 text-secondary" /> کد QR اختصاصی</span></div>
          </div>
          <div className="order-1 lg:order-2"><HomeBusinessPreview /></div>
        </div>
      </section>

      <section className="bg-primary px-6 py-5 text-white lg:px-10"><div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-right"><p className="text-sm font-medium text-primary-fixed">یک پروفایل خوب، اولین قدم برای اعتماد است.</p><div className="flex items-center gap-2 text-sm text-secondary-container"><span className="h-2 w-2 rounded-full bg-secondary-container" /> همیشه در دسترس، همیشه حرفه‌ای</div></div></section>

      <section className="bg-surface-container-low px-6 py-20 lg:px-10 lg:py-24"><div className="mx-auto max-w-7xl"><div className="max-w-2xl"><p className="text-sm font-bold text-secondary">چرا اینکارت؟</p><h2 className="mt-3 text-3xl font-bold leading-tight text-primary sm:text-4xl">هر چیزی که برای دیده‌شدن نیاز دارید</h2><p className="mt-4 leading-8 text-on-surface-variant">از ساخت پروفایل تا ارتباط مستقیم با مخاطب، همه‌چیز ساده و یکپارچه طراحی شده است.</p></div><div className="mt-10 grid gap-6 md:grid-cols-3">{benefits.map(([title, description], index) => <article key={title} className="homepage-card rounded-3xl bg-white p-7"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-fixed text-sm font-bold text-primary">۰{index + 1}</span><h3 className="mt-6 text-xl font-bold text-primary">{title}</h3><p className="mt-3 leading-8 text-on-surface-variant">{description}</p></article>)}</div></div></section>

      <section className="bg-white px-6 py-20 lg:px-10 lg:py-24"><div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1fr_0.85fr]"><div><p className="text-sm font-bold text-secondary">کشف دنیای اطراف شما</p><h2 className="mt-3 text-3xl font-bold leading-tight text-primary sm:text-4xl">کسب‌وکار مناسب را آسان پیدا کنید</h2><p className="mt-4 max-w-xl leading-8 text-on-surface-variant">جست‌وجو را شروع کنید و با دنیایی از خدمات و کسب‌وکارهای معتبر آشنا شوید.</p><div className="homepage-glass mt-8 flex flex-col gap-3 rounded-2xl p-3 sm:flex-row"><div className="flex min-h-12 flex-1 items-center gap-3 rounded-xl bg-white px-4 text-on-surface-variant"><HomeIcon name="search" className="h-5 w-5 text-secondary" /><span className="text-sm">جست‌وجوی خدمت یا کسب‌وکار</span></div><Link href="/login" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-6 text-sm font-bold text-white hover:bg-primary-container">شروع جست‌وجو</Link></div></div><div className="grid gap-4">{categories.map(([title, description], index) => <div key={title} className={`homepage-card rounded-3xl p-5 ${index === 0 ? "bg-primary text-white" : "bg-surface-container-low"}`}><div className="flex items-center justify-between gap-4"><div><h3 className="font-bold">{title}</h3><p className={`mt-2 text-sm leading-6 ${index === 0 ? "text-primary-fixed" : "text-on-surface-variant"}`}>{description}</p></div><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${index === 0 ? "bg-white/15" : "bg-white"}`}><HomeIcon name="arrow" className="h-4 w-4" /></span></div></div>)}</div></div></section>

      <section className="relative overflow-hidden bg-primary px-6 py-20 text-center text-white lg:px-10 lg:py-24"><div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(130,245,193,0.18),transparent_55%)]" /><div className="relative mx-auto max-w-2xl"><p className="text-sm font-bold text-secondary-container">آماده‌اید حرفه‌ای‌تر دیده شوید؟</p><h2 className="mt-4 text-3xl font-bold sm:text-4xl">پروفایل دیجیتال خود را بسازید</h2><p className="mt-4 leading-8 text-primary-fixed">همین امروز اولین قدم را برای معرفی بهتر کسب‌وکارتان بردارید.</p><Link href="/login" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-secondary-container px-7 py-4 font-bold text-on-secondary-container transition hover:bg-white">شروع کنید <HomeIcon name="arrow" className="h-5 w-5" /></Link></div></section>

      <SiteFooter />
    </main>
  );
}
