import type { Metadata } from "next";
import PricingSection, {
  type PricingContent,
} from "@/components/ui/pricing-section";
import { fetchHomepageContentServer, type HomepageContent } from "@/lib/homepageContent";
import AppTaskbar from "@/components/layout/AppTaskbar";
import SiteFooter from "@/components/layout/SiteFooter";

/** ISR: pricing content re-renders at most once per minute (CMS-cached). */
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const content = await fetchHomepageContentServer();
  const raw = content["seo.pricing"] ?? "";
  let title = "تعرفه‌ها | اینکارت";
  let description = "پلن‌های اشتراک اینکارت: شخصی و سازمانی، ماهانه یا همیشگی.";
  try {
    const parsed = JSON.parse(raw) as { title?: string; description?: string };
    if (parsed.title) title = parsed.title;
    if (parsed.description) description = parsed.description;
  } catch {
    // no CMS value — keep fallbacks
  }
  return { title, description };
}

/** Read a pricing CMS key with a hard fallback so the page never renders empty. */
function pc(content: HomepageContent, key: string, fallback: string): string {
  return content[`pricing.${key}`] || fallback;
}

/** Parse an unprefixed JSON-array CMS value (e.g. "pricing.features") with a safe fallback. */
function jsonList<T = string>(content: HomepageContent, key: string, fallback: T[]): T[] {
  const raw = content[key];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export default async function PricingPage() {
  const content = await fetchHomepageContentServer();

  const pricing: PricingContent = {
    eyebrow: pc(content, "eyebrow", "زمان اقدام است"),
    title: pc(content, "title", "شروع کنید"),
    subtitle: pc(
      content,
      "subtitle",
      "با اینکارت کسب‌وکارتان را معرفی کنید؛ زمان و هزینه کمتر، دیده‌شدن بیشتر.",
    ),
    featuresTitle: pc(content, "features_title", "چه چیزهایی دریافت می‌کنید؟"),
    features: jsonList<string>(content, "pricing.features", [
      "صفحه اختصاصی کسب‌وکار با لینک یکتا",
      "کارت ویزیت دیجیتال هوشمند با کد QR",
      "دیده‌شدن در جست‌وجو و نقشه",
      "پشتیبانی پاسخ‌گو",
    ]),
    updatesTitle: pc(content, "updates.title", "مدت اشتراک"),
    updatesHint: pc(content, "updates.hint", "پرداخت یک‌باره؛ تمدید خودکار انجام نمی‌شود."),
    updatesLabel1: pc(content, "updates.label1", "۳ ماهه"),
    updatesLabel2: pc(content, "updates.label2", "همیشگی"),
    licenseTitle: pc(content, "license.title", "نوع حساب"),
    licenseHint: pc(content, "license.hint", "برای تیم‌ها گزینه سازمانی را انتخاب کنید."),
    licenseLabel1: pc(content, "license.label1", "شخصی"),
    licenseLabel2: pc(content, "license.label2", "سازمانی"),
    ctaLabel: pc(content, "cta.label", "خرید اشتراک"),
    plans: (() => {
      const raw = content["pricing.plans"] ?? "{}";
      let parsed: Partial<PricingContent["plans"]> = {};
      try {
        parsed = JSON.parse(raw) as Partial<PricingContent["plans"]>;
      } catch {
        parsed = {};
      }
      return {
        personal3m: parsed.personal3m ?? 98,
        personalForever: parsed.personalForever ?? 400,
        corporate3m: parsed.corporate3m ?? 159,
        corporateForever: parsed.corporateForever ?? 650,
      };
    })(),
  };

  return (
    <>
      <AppTaskbar />
      <main dir="rtl" className="min-h-screen overflow-hidden bg-night text-surface">
        <PricingSection content={pricing} />
      </main>
      <SiteFooter />
    </>
  );
}
