import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicBusiness, getQrUrl, type Business } from "@/lib/businesses";
import SiteHeader from "@/components/layout/SiteHeader";
import SiteFooter from "@/components/layout/SiteFooter";

type PageProps = { params: Promise<{ slug: string }> };

async function fetchBusiness(slug: string): Promise<Business | null> {
  try {
    return await getPublicBusiness(slug);
  } catch {
    return null; // 404 (not found / not approved) or API unreachable
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const b = await fetchBusiness(slug);
  if (!b) return { title: "کسب‌وکار یافت نشد | اینکارت" };
  const title = `${b.name} | اینکارت`;
  const description =
    b.description?.slice(0, 160) ??
    ([b.category, b.city].filter(Boolean).join("، ") ||
      "پروفایل کسب‌وکار در اینکارت");
  return { title, description };
}

function SocialLinks({ links }: { links: Business["social_links"] }) {
  if (!links) return null;
  const entries = Array.isArray(links)
    ? links.map((url) => [url, url] as const)
    : Object.entries(links);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {entries.map(([key, url]) => (
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="rounded-full border border-navy-200 bg-white px-4 py-1.5 text-sm text-navy-800 transition hover:border-emerald-300 hover:text-emerald-700"
        >
          {key}
        </a>
      ))}
    </div>
  );
}

function ContactItem({ icon, label, children, href, ltr = false }: {
  icon: string;
  label: string;
  children: React.ReactNode;
  href?: string;
  ltr?: boolean;
}) {
  const content = (
    <div className="flex items-start gap-3">
      <span aria-hidden className="mt-0.5 text-lg">{icon}</span>
      <div>
        <p className="text-xs text-zinc-500">{label}</p>
        <p className={ltr ? "font-medium" : "font-medium leading-7"} dir={ltr ? "ltr" : undefined}>
          {children}
        </p>
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block rounded-2xl transition hover:bg-navy-50">
      {content}
    </a>
  ) : (
    content
  );
}

export default async function PublicBusinessPage({ params }: PageProps) {
  const { slug } = await params;
  const b = await fetchBusiness(slug);
  if (!b) notFound();

  const qrUrl = getQrUrl(b.slug);
  const mapUrl =
    b.latitude != null && b.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${b.latitude}&mlon=${b.longitude}#map=16/${b.latitude}/${b.longitude}`
      : null;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-12">
        {/* Hero */}
        <section className="rounded-3xl border border-navy-100 bg-white p-8 shadow-sm sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
                <span aria-hidden>✓</span> کسب‌وکار تأییدشده
              </p>
              <h1 className="mt-4 text-3xl font-black text-navy-900 sm:text-4xl">{b.name}</h1>
              {b.category && (
                <p className="mt-2 text-lg text-zinc-500">{b.category}</p>
              )}
              {(b.city || b.neighborhood) && (
                <p className="mt-1 text-sm text-zinc-500">
                  {[b.city, b.neighborhood].filter(Boolean).join("، ")}
                </p>
              )}
            </div>
            {/* QR code linking back to this page */}
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-navy-100 bg-surface p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt={`کد QR صفحه ${b.name}`}
                width={140}
                height={140}
                className="rounded-lg bg-white"
              />
              <a
                href={qrUrl}
                download={`qr-${b.slug}.svg`}
                className="text-xs text-navy-600 underline-offset-2 hover:underline"
              >
                دانلود کد QR
              </a>
            </div>
          </div>

          {b.description && (
            <p className="mt-6 max-w-3xl whitespace-pre-wrap text-lg leading-9 text-ink">
              {b.description}
            </p>
          )}
        </section>

        {/* Services */}
        {b.services && b.services.length > 0 && (
          <section className="mt-8">
            <h2 className="text-xl font-bold text-navy-900">خدمات</h2>
            <ul className="mt-4 flex flex-wrap gap-3">
              {b.services.map((s, i) => (
                <li
                  key={i}
                  className="rounded-full border border-navy-100 bg-white px-4 py-2 text-sm font-medium text-navy-800 shadow-sm"
                >
                  {s}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Contact & location */}
        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-3xl border border-navy-100 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-navy-900">اطلاعات تماس</h2>
            <div className="mt-4 grid gap-4">
              {b.phone && (
                <ContactItem icon="📞" label="تلفن" href={`tel:${b.phone}`} ltr>
                  {b.phone}
                </ContactItem>
              )}
              {b.email && (
                <ContactItem icon="✉️" label="ایمیل" href={`mailto:${b.email}`} ltr>
                  {b.email}
                </ContactItem>
              )}
              {b.address && (
                <ContactItem icon="📍" label="آدرس">
                  {[b.address, b.city, b.neighborhood].filter(Boolean).join("، ")}
                </ContactItem>
              )}
              {mapUrl && (
                <a
                  href={mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-emerald-700 underline-offset-2 hover:underline"
                >
                  مشاهده روی نقشه ↗
                </a>
              )}
            </div>
          </div>

          {(b.social_links || b.email) && (
            <div className="rounded-3xl border border-navy-100 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-navy-900">شبکه‌های اجتماعی</h2>
              <div className="mt-4">
                <SocialLinks links={b.social_links} />
              </div>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
