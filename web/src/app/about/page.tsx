import Link from "next/link";
import AppTaskbar from "@/components/layout/AppTaskbar";
import SiteFooter from "@/components/layout/SiteFooter";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#faf9f6] text-zinc-900">
      <AppTaskbar />
      <div className="mx-auto max-w-3xl px-6 pt-36 pb-12">
        <p className="text-sm font-bold text-emerald-600">درباره اینکارت</p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-navy-950">کسب‌وکارها را به مخاطبانشان نزدیک‌تر می‌کنیم.</h1>
        <p className="mt-8 text-lg leading-9 text-zinc-600">
          اینکارت در حال ساختن راهی ساده و قابل اعتماد برای معرفی کسب‌وکارهای محلی است؛ جایی برای ساختن یک هویت دیجیتال روشن، معرفی خدمات و پیدا شدن آسان‌تر.
        </p>
        <div className="mt-12 rounded-3xl bg-white p-7 shadow-sm">
          <h2 className="text-xl font-black text-navy-950">چشم‌انداز ما</h2>
          <p className="mt-3 leading-8 text-zinc-600">می‌خواهیم هر کسب‌وکار، کوچک یا بزرگ، یک پروفایل دیجیتال حرفه‌ای و همیشه در دسترس داشته باشد.</p>
        </div>
        <Link href="/" className="mt-10 inline-block font-black text-navy-700 transition hover:text-emerald-700">← بازگشت به اینکارت</Link>
      </div>
      <SiteFooter />
    </main>
  );
}
