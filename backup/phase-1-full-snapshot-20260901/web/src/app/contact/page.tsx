import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-[#faf9f6] text-zinc-900">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm font-bold text-emerald-600">تماس با ما</p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-navy-950">خوشحال می‌شویم صدای شما را بشنویم.</h1>
        <p className="mt-6 leading-8 text-zinc-600">برای همکاری، پیشنهاد یا پرسش درباره اینکارت با ما در ارتباط باشید.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <a href="mailto:hello@inkart.ir" className="rounded-3xl bg-white p-6 shadow-sm transition hover:shadow-md">
            <p className="text-sm text-zinc-500">ایمیل</p>
            <p className="mt-2 font-bold text-emerald-700" dir="ltr">hello@inkart.ir</p>
          </a>
          <a href="tel:+982100000000" className="rounded-3xl bg-white p-6 shadow-sm transition hover:shadow-md">
            <p className="text-sm text-zinc-500">تلفن</p>
            <p className="mt-2 font-bold text-emerald-700" dir="ltr">۰۲۱-۰۰۰۰۰۰۰۰</p>
          </a>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
