import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#faf9f6] text-zinc-900">
      <SiteHeader />
      <div className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm font-bold text-emerald-600">حریم خصوصی</p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-navy-950">حریم خصوصی شما برای ما مهم است.</h1>
        <div className="mt-8 space-y-6 leading-8 text-zinc-600">
          <p>این صفحه خلاصه‌ای از رویکرد اینکارت در حفاظت از اطلاعات کاربران است. اطلاعاتی که در اختیار ما قرار می‌دهید فقط برای ارائه و بهبود خدمات استفاده خواهد شد.</p>
          <p>در مرحله فعلی، فرم اطلاع‌رسانی صفحه اصلی صرفاً نمایشی است و اطلاعاتی را به سرور ارسال یا ذخیره نمی‌کند.</p>
          <p>هرگونه تغییر مهم در این سیاست، پیش از فعال‌شدن خدمات اصلی به اطلاع کاربران خواهد رسید.</p>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
