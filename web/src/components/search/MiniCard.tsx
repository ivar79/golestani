"use client";

import Link from "next/link";
import { Phone, Route, ShieldCheck } from "lucide-react";
import HomeIcon from "@/components/home/HomeIcon";
import type { Business } from "@/lib/businesses";
import { buildLicenseTrackUrl } from "@/lib/license";
import { formatDistance } from "@/lib/format";

/** Shared Phase 3 distance formatter (moved to @/lib/format for testability). */
export { formatDistance };

export type MiniCardData = Pick<
  Business,
  "id" | "slug" | "name" | "category" | "city" | "neighborhood" | "verification_badge"
> & {
  /** Distance in meters — present only when the search was location-aware. */
  distance?: number | null;
  /** Featured/showcase flag (real API badge or the showcase filter match). */
  featured?: boolean;
  /** Phase 3 static license badge — presentation only (license_tracking_code present). */
  license_verified?: boolean;
  /** Raw tracking code (Phase 3) — feeds the qr.mojavez.ir badge deep link. */
  license_tracking_code?: string | null;
  /** Public contact phone (E.164 or 09xxxxxxxxx) — enables the tel: action. */
  phone?: string | null;
  /** Coordinates enable the routing action buttons (نشان / بلد / گوگل‌مپس). */
  latitude?: number | null;
  longitude?: number | null;
};

function locationLabel(b: MiniCardData): string | null {
  return b.neighborhood || b.city || null;
}

type RoutingApp = "neshan" | "balad" | "google";

/**
 * Deep links into Iranian navigation apps. Neshan/Balad use universal links
 * (they open the installed app on mobile, the web viewer on desktop).
 */
function routingUrl(app: RoutingApp, lat: number, lng: number, label: string): string {
  const ll = `${lat},${lng}`;
  switch (app) {
    case "neshan":
      return `https://neshan.org/maps/@${ll},17z,0p?q=${ll}&title=${encodeURIComponent(label)}`;
    case "balad":
      return `https://balad.site/location/${ll}?latitude=${lat}&longitude=${lng}&title=${encodeURIComponent(label)}`;
    case "google":
      return `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
  }
}

function RoutingButtons({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const apps: Array<{ key: RoutingApp; label: string }> = [
    { key: "neshan", label: "نشان" },
    { key: "balad", label: "بلد" },
    { key: "google", label: "گوگل‌مپس" },
  ];
  return (
    <div className="flex items-center gap-1.5">
      <Route className="h-3.5 w-3.5 text-ik-muted" aria-hidden="true" />
      {apps.map((a) => (
          <a
            key={a.key}
            href={routingUrl(a.key, lat, lng, name)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center rounded-md border border-ik-border bg-ik-wash px-2 text-[10px] font-medium text-ik-muted transition-colors hover:border-ik-accent/40 hover:text-ik-accent lg:min-h-[24px]"
          >
            {a.label}
          </a>
      ))}
    </div>
  );
}

/**
 * MiniCard — Phase 3.1 (Stitch: mini_business_card / high_density_mini_cards).
 *
 * Card on the search theme (same --ik-* token system as the User Panel),
 * states:
 *  - default / verified / with distance / featured (ویژه)
 *  - quick actions (task 8): direct call (tel:) + routing to
 *    نشان / بلد / گوگل‌مپس when the API returns coordinates & phone
 *
 * Data source: real search API payload only. No image field exists in the
 * API yet, so the image slot renders the No-Image placeholder state from the
 * same Stitch set (storefront glyph on a soft surface).
 */
export default function MiniCard({ business }: { business: MiniCardData }) {
  const verified = business.verification_badge === true;
  const featured = business.featured === true;
  // Phase 3: static license badge — presentation only; distinct from the
  // admin "verified" badge and the showcase/featured styling.
  const licenseVerified = business.license_verified === true;
  const location = locationLabel(business);
  const hasDistance = typeof business.distance === "number" && business.distance >= 0;
  const hasPhone = typeof business.phone === "string" && business.phone.trim().length > 0;
  const hasCoords =
    typeof business.latitude === "number" &&
    typeof business.longitude === "number" &&
    Number.isFinite(business.latitude) &&
    Number.isFinite(business.longitude);

  const body = (
    <>
      {/* Image slot — API has no image field yet → Stitch "بدون تصویر" state */}
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-ik-panel-soft">
        <HomeIcon name="storefront" className="h-8 w-8 text-ik-muted opacity-50" />
      </div>

      <div className="flex min-w-0 grow flex-col justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3
              className={`truncate text-base font-semibold ${
                featured ? "text-ik-accent" : "text-ik-text"
              }`}
            >
              {business.name}
            </h3>
            {verified && <HomeIcon name="verified" className="h-4 w-4 shrink-0 text-ik-success" />}
            {licenseVerified &&
              (() => {
                // Phase 3 approved behavior: the badge links to the official
                // license tracking system so visitors can verify the permit.
                const trackUrl = buildLicenseTrackUrl(business.license_tracking_code);
                const icon = <ShieldCheck className="h-4 w-4 text-ik-success" aria-hidden="true" />;
                const title = "تاییدیه پروانه کسب — مشاهده در سامانه پیگیری مجوز";
                // Mobile: a 44px hit box around the icon-only badge (the icon
                // itself stays 16px); desktop restores the natural inline box.
                const hitBox =
                  "flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg lg:min-h-0 lg:min-w-0";
                if (!trackUrl) {
                  return (
                    <span title={title} aria-label={title} className={hitBox}>
                      {icon}
                    </span>
                  );
                }
                return (
                  <a
                    href={trackUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    title={title}
                    aria-label={title}
                    className={`${hitBox} transition-opacity hover:opacity-75`}
                  >
                    {icon}
                  </a>
                );
              })()}
          </div>
          <p className="mt-1 text-sm text-ik-muted">{business.category ?? "کسب‌وکار محلی"}</p>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            {hasDistance ? (
              <span className="flex items-center gap-1 rounded-md bg-ik-panel-soft px-2 py-1 text-ik-text">
                <HomeIcon name="location" className="h-3.5 w-3.5 text-ik-accent" />
                <span className="text-[10px] font-bold">{formatDistance(business.distance as number)}</span>
              </span>
            ) : location ? (
              <span className="flex items-center gap-1 text-ik-muted">
                <HomeIcon name="location" className="h-4 w-4" />
                <span className="text-[10px]">{location}</span>
              </span>
            ) : (
              <span />
            )}

            <Link
              href={`/b/${business.slug}`}
              className={`min-h-[44px] rounded-full px-4 py-1.5 text-sm font-medium transition-colors lg:min-h-[32px] ${
                featured
                  ? "bg-ik-accent text-ik-accent-contrast shadow-sm hover:bg-ik-accent-hover"
                  : "bg-ik-panel-soft text-ik-text hover:bg-ik-panel-hover"
              }`}
            >
              مشاهده
            </Link>
          </div>

          {/* Quick actions: call + routing (rendered only with real API data) */}
          {(hasPhone || hasCoords) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ik-border pt-2">
              {hasPhone ? (
                <a
                  href={`tel:${encodeURIComponent((business.phone as string).trim())}`}
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-ik-success/30 bg-ik-success/10 px-2.5 text-[11px] font-semibold text-ik-success transition-colors hover:bg-ik-success/20 lg:min-h-[28px]"
                >
                  <Phone className="h-3 w-3" />
                  <span dir="ltr">{business.phone}</span>
                </a>
              ) : (
                <span />
              )}
              {hasCoords && (
                <RoutingButtons
                  lat={business.latitude as number}
                  lng={business.longitude as number}
                  name={business.name}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (featured) {
    // Featured state: quiet accent border + ribbon — restrained, no gradients.
    return (
      <div className="relative overflow-hidden rounded-[20px] border border-ik-accent/40 bg-ik-panel shadow-md shadow-ik-accent/10">
        <span className="absolute right-4 top-0 z-10 rounded-b-md bg-ik-accent px-2 py-0.5 text-[10px] font-bold text-ik-accent-contrast shadow-sm">
          ویژه
        </span>
        <div className="flex h-full gap-4 p-4 pt-6">{body}</div>
      </div>
    );
  }

  return (
    <div
      className={`flex gap-4 rounded-[20px] border border-ik-border bg-ik-panel/80 p-4 shadow-sm transition-transform hover:scale-[1.02] ${
        verified ? "border-ik-success/30" : ""
      }`}
    >
      {body}
    </div>
  );
}
