# M5 Checkpoint — Public Business Profile Page

**Date:** 2026-09-01
**Status:** M5 COMPLETED — awaiting review
**Scope:** Frontend public profile page (`web/src/app/b/[slug]/`) + one API-helper addition. No backend changes. No new dependencies.

---

## 1. Scope (per docs/M4-dashboard-checkpoint.md §6)

- **M5 — Public business profile page:** rich layout for `/b/[slug]`:
  services list, contact actions, QR link to
  `/api/public/businesses/{slug}/qr`.

## 2. Implementation

### Changed files
- `web/src/app/b/[slug]/page.tsx` — rewritten (single-line stub → full profile page, ~200 lines).
- `web/src/lib/businesses.ts` — added `getQrUrl(slug)` (public QR endpoint URL builder).
- No backend files changed. No new dependencies. No API contract changes.

### Page architecture
- Server Component (SEO-friendly per Phase-1 decision: Server Components for
  public/SEO pages). Data fetched server-side via `getPublicBusiness(slug)`
  (existing `GET /api/public/businesses/{slug}`, approved-only).
- `notFound()` when the API returns 404 (unknown slug or status != approved) —
  verified by `test_public_api_exposes_only_approved_business_and_no_private_fields`.
- `generateMetadata()` builds `<title>` + meta description from business data
  (SEO-friendly public page per Phase 2 acceptance criteria).
- Layout: `SiteHeader` + `SiteFooter` reused; RTL Persian; navy/emerald tokens
  only (no raw hex).

### Page sections
- **Hero card:** approved badge, name, category, city/neighborhood, description,
  QR code (140px, rendered from the API SVG endpoint) + download link.
- **Services:** pill chips from `services[]` (hidden when empty).
- **Contact card:** phone (`tel:`), email (`mailto:`), address line,
  OpenStreetMap link when lat/lon present.
- **Social links card:** pill links (`rel="noopener noreferrer nofollow"`),
  supports both dict and array `social_links` shapes.

### Security notes
- Only fields exposed by the public API are rendered (no owner, no
  moderation_note, no user_id — enforced server-side, page renders only what
  the API returns).
- External links use `rel="noopener noreferrer nofollow"`.

## 3. Validation
- Frontend TypeScript: `npx tsc --noEmit` — PASS
- Frontend production build: `npm run build` — PASS (`/b/[slug]` compiled as dynamic route)
- Lint: `npm run lint` — PASS
- Backend contract tests (`api/tests/Feature/BusinessTest.php`) — unchanged, cover the consumed endpoints.

## 4. Open items / follow-ups
- Dashboard "public page" button could deep-link to `/b/{slug}` (M4 cleanup candidate).
- Map embed (Leaflet/OSM) instead of external OSM link — deferred to Phase 3 (maps).
- Image/logo upload for the hero — future milestone, needs backend endpoint.
