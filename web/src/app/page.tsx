import type { Metadata } from "next";
import AppTaskbar from "@/components/layout/AppTaskbar";
import HomeHero from "@/components/home/HomeHero";
import HomeFeatures from "@/components/home/HomeFeatures";
import DigitalCardShowcase from "@/components/home/DigitalCardShowcase";
import HowItWorks from "@/components/home/HowItWorks";
import HomeCta from "@/components/home/HomeCta";
import HomeFooter from "@/components/home/HomeFooter";
import { HomepageContentProvider } from "@/lib/homepage";
import { cms, fetchHomepageContentServer, type HomepageContent } from "@/lib/homepageContent";
import { SITE_URL } from "@/lib/siteUrl";
import { jsonLdScript } from "@/lib/structuredData";

/** ISR: the homepage re-renders at most once per minute; CMS fetch is cached. */
export const revalidate = 60;

/** SEO metadata comes from the CMS (`seo.homepage`), falling back to hero copy. */
export async function generateMetadata(): Promise<Metadata> {
  const content = await fetchHomepageContentServer();
  const raw = cms(content, "seo.homepage");
  let title = raw;
  let description = cms(content, "hero.subtitle");
  try {
    const parsed = JSON.parse(raw) as { title?: string; description?: string };
    if (parsed.title) title = parsed.title;
    if (parsed.description) description = parsed.description;
  } catch {
    // plain string — title only
  }
  const finalTitle = title || "اینکارت | بانک مشاغل و کارت ویزیت دیجیتال";
  const finalDescription =
    description ||
    "جست‌وجو و معرفی کسب‌وکارهای محلی ایران همراه با کارت ویزیت دیجیتال، ویترین اختصاصی و QR اختصاصی برای هر کسب‌وکار.";

  return {
    metadataBase: new URL(SITE_URL),
    title: finalTitle,
    description: finalDescription,
    alternates: { canonical: "/" },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url: SITE_URL,
      siteName: "اینکارت",
      locale: "fa_IR",
      title: finalTitle,
      description: finalDescription,
      images: [{ url: "/assets/hero-2.jpg", width: 769, height: 767, alt: finalTitle }],
    },
    twitter: {
      card: "summary_large_image",
      title: finalTitle,
      description: finalDescription,
      images: ["/assets/hero-2.jpg"],
    },
  };
}

export default async function Home() {
  // One server-side fetch; all sections render with the full text in the SSR
  // HTML (no client-side content flash, fully SEO-visible).
  const content: HomepageContent = await fetchHomepageContentServer();

  // Phase 3.5 SEO — WebSite + Organization structured data (server-rendered,
  // بدون متن جعلی: همان متن CMS/برند واقعی پروژه).
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "اینکارت",
        description: cms(content, "hero.subtitle") || "بانک مشاغل و کارت ویزیت‌های دیجیتال ایران",
        inLanguage: "fa-IR",
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "اینکارت",
        url: SITE_URL,
        logo: `${SITE_URL}/icon.png`,
      },
    ],
  };

  return (
    <HomepageContentProvider content={content}>
      <main dir="rtl" className="min-h-screen overflow-hidden bg-night text-surface">
        <AppTaskbar />
        <HomeHero />
        <HomeFeatures content={content} />
        <section id="showcase" className="mx-auto mt-24 w-full px-[clamp(1.25rem,5vw,6rem)]">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <DigitalCardShowcase content={content} />
            <HowItWorks content={content} />
          </div>
        </section>
        <HomeCta content={content} />
        <HomeFooter content={content} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
        />
      </main>
    </HomepageContentProvider>
  );
}
