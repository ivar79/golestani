"use client";

import Link from "next/link";
import { Phone, Route } from "lucide-react";
import HomeIcon from "@/components/home/HomeIcon";
import type { Business } from "@/lib/businesses";

export type MiniCardData = Pick<
  Business,
  "id" | "slug" | "name" | "category" | "city" | "neighborhood" | "verification_badge"
> & {
  /** Distance in meters — present only when the search was location-aware. */
  distance?: number | null;
  /** Featured/showcase flag (real API badge or the showcase filter match). */
  featured?: boolean;
  /** Public contact phone (E.164 or 09xxxxxxxxx) — enables the tel: action. */
  phone?: string | null;
  /** Coordinates enable the routing action buttons (نشان / بلد / گوگل‌مپس). */
  latitude?: number | null;
  longitude?: number | null;
};

/** Format meters the way the contract UI shows them: <۱۰۰۰ m → متر, else کیلومتر. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters).toLocaleString("fa-IR")} متر`;
  return `${(meters / 1000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} کیلومتر`;
}

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
      <Route className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
      {apps.map((a) => (
        <a
          key={a.key}
          href={routingUrl(a.key, lat, lng, name)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-300 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/10 hover:text-cyan-200"
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
 * Glassmorphism card on the dark public theme, states:
 *  - default / verified / with distance / featured (ویژه)
 *  - quick actions (task 8): direct call (tel:) + routing to
 *    نیشان / بلد / گوگل‌مپس when the API returns coordinates & phone
 *
 * Data source: real search API payload only. No image field exists in the
 * API yet, so the image slot renders the No-Image placeholder state from the
 * same Stitch set (storefront glyph on surface-container).
 */
export default function MiniCard({ business }: { business: MiniCardData }) {
  const verified = business.verification_badge === true;
  const featured = business.featured === true;
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
      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-surface-container-high shadow-inner">
        <HomeIcon name="storefront" className="h-8 w-8 text-surface-tint opacity-50" />
      </div>

      <div className="flex min-w-0 grow flex-col justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3
              className={`truncate text-base font-semibold ${
                featured ? "text-secondary" : "text-white"
              }`}
            >
              {business.name}
            </h3>
            {verified && <HomeIcon name="verified" className="h-4 w-4 shrink-0 text-secondary" />}
          </div>
          <p className="mt-1 text-sm text-on-surface-variant">{business.category ?? "کسب‌وکار محلی"}</p>
        </div>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            {hasDistance ? (
              <span className="flex items-center gap-1 rounded-md bg-surface-container-highest px-2 py-1 text-white">
                <HomeIcon name="location" className="h-3.5 w-3.5 text-secondary" />
                <span className="text-[10px] font-bold">{formatDistance(business.distance as number)}</span>
              </span>
            ) : location ? (
              <span className="flex items-center gap-1 text-on-surface-variant">
                <HomeIcon name="location" className="h-4 w-4" />
                <span className="text-[10px]">{location}</span>
              </span>
            ) : (
              <span />
            )}

            <Link
              href={`/b/${business.slug}`}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                featured
                  ? "bg-secondary text-white shadow-md shadow-secondary/30 hover:bg-secondary/90"
                  : "bg-surface-container-highest text-white hover:bg-surface-container"
              }`}
            >
              مشاهده
            </Link>
          </div>

          {/* Quick actions: call + routing (rendered only with real API data) */}
          {(hasPhone || hasCoords) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-2">
              {hasPhone ? (
                <a
                  href={`tel:${encodeURIComponent((business.phone as string).trim())}`}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/20"
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
    // Stitch featured state: glowing gradient border + corner ribbon.
    return (
      <div className="relative overflow-hidden rounded-[20px] bg-panel-deep/80 p-[1px] shadow-lg shadow-secondary/20">
        <div className="absolute inset-0 bg-gradient-to-br from-secondary via-panel-deep to-secondary opacity-50" />
        <div className="relative rounded-[19px] bg-panel-deep/90">
          <span className="absolute right-4 top-0 z-10 rounded-b-md bg-secondary px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
            ویژه
          </span>
          <div className="flex h-full gap-4 p-4 pt-6">{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex gap-4 rounded-[20px] border border-white/10 bg-panel/60 p-4 shadow-md backdrop-blur-xl transition-transform hover:scale-[1.02] ${
        verified ? "border-secondary/30" : ""
      }`}
    >
      {body}
    </div>
  );
}
