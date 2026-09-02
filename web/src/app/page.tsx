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
  return {
    title: title || "اینکارت | سامانه معرفی کسب‌وکارها",
    description,
  };
}

export default async function Home() {
  // One server-side fetch; all sections render with the full text in the SSR
  // HTML (no client-side content flash, fully SEO-visible).
  const content: HomepageContent = await fetchHomepageContentServer();

  return (
    <HomepageContentProvider content={content}>
      <main dir="rtl" className="min-h-screen overflow-hidden bg-night text-surface">
        <AppTaskbar />
        <HomeHero />
        <HomeFeatures />
        <section id="showcase" className="mx-auto mt-24 w-full px-[clamp(1.25rem,5vw,6rem)]">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <DigitalCardShowcase />
            <HowItWorks />
          </div>
        </section>
        <HomeCta />
        <HomeFooter />
      </main>
    </HomepageContentProvider>
  );
}
