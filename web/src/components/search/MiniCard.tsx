"use client";

import Link from "next/link";
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
};

/** Format meters the way the contract UI shows them: <۱۰۰۰ m → متر, else کیلومتر. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters).toLocaleString("fa-IR")} متر`;
  return `${(meters / 1000).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} کیلومتر`;
}

function locationLabel(b: MiniCardData): string | null {
  return b.neighborhood || b.city || null;
}

/**
 * MiniCard — Phase 3.1 (Stitch: mini_business_card / high_density_mini_cards).
 *
 * Glassmorphism card on the dark public theme, 4 data-driven states:
 *  - default            → plain card
 *  - verified           → emerald check overlay + inline verified icon
 *  - with distance      → distance chip (only when API returns distance)
 *  - featured (ویژه)     → glowing gradient border + corner ribbon
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

        <div className="mt-3 flex items-center justify-between gap-2">
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
