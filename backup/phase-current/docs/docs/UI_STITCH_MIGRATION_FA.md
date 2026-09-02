# UI Stitch Migration Report

**Date:** 2026-09-01
**Status:** Phases 1–3 implemented, Phase 4 verification in progress
**Scope:** Homepage UI migration, Admin CMS UI, Emergency Admin Recovery

## 1. What changed

### Phase 1 — Homepage component migration

**Rebuilt / modified:**

- `web/src/app/page.tsx` — replaced the monolithic inline-JSX homepage with a clean composition of section components.
- `web/src/lib/homepage.ts` — **new**. Shared `useHomepageContent()` hook (single cached fetch of `GET /public/homepage`), plus `cms()` / `cmsList()` helpers. Replaced the anti-pattern where `HomeCmsSections` fired one HTTP request per text slot (~15+ requests per page load).
- `web/src/components/home/HomeHeader.tsx` — nav labels now read from CMS (`homepage.nav.*`, `homepage.brand`, `homepage.header.login`).
- `web/src/components/home/HomeHero.tsx` — all mockup text CMS-driven; supports `homepage.hero.image` and `homepage.hero.background`; button links read from `homepage.hero.button_*_link`.
- `web/src/components/home/HomeFeatures.tsx` — per-feature icons/titles/descriptions from CMS.
- `web/src/components/home/HomeCta.tsx` — migrated to the shared hook; CTA button links from CMS.
- `web/src/components/home/DigitalCardShowcase.tsx` — **new**. Card samples read from `homepage.showcase.cards` (JSON list in CMS).
- `web/src/components/home/HowItWorks.tsx` — **new**. Steps read from `homepage.howitworks.steps` (JSON list in CMS).
- `web/src/components/home/HomeFooter.tsx` — removed all leftover Indonesian Google Stitch text; about/links/copyright now from CMS.

**Deleted:**

- `web/src/components/home/HomeCmsSections.tsx` (per-slot fetch anti-pattern)
- `web/src/components/home/HomeShowcase.tsx` (split into DigitalCardShowcase + HowItWorks)
- `web/src/components/home/HomeBusinessPreview.tsx` (unused after composition rewrite)

### Backend (additive only)

- `api/app/Http/Controllers/Api/AdminController.php` — `publicHomepage()` whitelist extended additively (original keys preserved): hero links/image/background/card fields, per-feature keys, showcase, howitworks, footer, brand/nav keys.

### Phase 2 — Admin CMS UI

- `web/src/app/admin/page.tsx` — rewritten as a tabbed console: **Overview / Homepage / Pages / Blog / Media**. Homepage tab exposes every CMS key the homepage reads (including JSON list fields for showcase cards, howitworks steps, footer links).
- `web/src/components/admin/AdminPagesTab.tsx` — **new**. Edit static pages (title/content/SEO) by slug via `GET/PUT /admin/pages`.
- `web/src/components/admin/AdminBlogTab.tsx` — **new**. Create/edit/publish articles with SEO + OpenGraph fields and cover upload via `GET/POST/DELETE /admin/articles`.
- `web/src/components/admin/AdminMediaTab.tsx` — **new**. Upload and list media files.
- `web/src/lib/admin.ts` — added typed API helpers: `getAdminSettings`, `saveAdminSetting`, `getAdminPages`, `saveAdminPage`, `getAdminArticles`, `saveAdminArticle`, `deleteAdminArticle`, `uploadAdminMedia`, `listAdminMedia`.
- `api/routes/api.php` + `AdminController.php` — additive `GET /api/admin/media` list endpoint (upload already existed).

### Phase 3 — Emergency Admin Recovery

- `api/database/migrations/2026_09_01_000010_add_recovery_code_to_users_table.php` — **new**. Nullable `recovery_code` column on `users`.
- `api/app/Models/User.php` — added `recovery_code` to fillable/hidden.
- `api/app/Http/Controllers/Api/Auth/AuthController.php` — **new endpoint** `POST /api/auth/verify-recovery` (throttled 5/15min). Verifies phone + hashed single-use recovery code, rotates it on success, returns a Sanctum token. Same token/role contract as OTP login.
- `api/app/Console/Commands/IssueRecoveryCode.php` — **new artisan command** `php artisan admin:recovery-code {phone}`. Issues (or rotates) a grouped code like `AB3C-9F7K-2QMX`, stores only the hash, prints the code once.
- `api/routes/api.php` — registered the recovery route.

**Why:** admin login was OTP-only. If the SMS provider went down, the site owner would be locked out. Recovery codes are stored hashed, single-use, and rotatable on demand.

## 2. Architecture of the new Homepage

```
Admin Panel (Homepage tab)
        │  PUT /api/admin/settings/{key}   [auth:sanctum + role:admin]
        ▼
CMS Database (site_settings, key/value)
        │
        ▼
Public Homepage API  GET /api/public/homepage
        │  (whitelisted keys only)
        ▼
web/src/lib/homepage.ts  useHomepageContent()  — one cached fetch
        │
        ▼
HomeHeader → HomeHero → HomeFeatures → HomeSearch
   → DigitalCardShowcase + HowItWorks → HomeCta → HomeFooter
```

## 3. CMS keys consumed by the homepage

All prefixed `homepage.` (read from `site_settings`):

- `hero.title`, `hero.subtitle`, `hero.badges`, `hero.button_primary`, `hero.button_primary_link`, `hero.button_secondary`, `hero.button_secondary_link`, `hero.image`, `hero.background`, `hero.card_title`, `hero.card_subtitle`, `hero.card_phone`, `hero.card_location`
- `feature.{1..3}.title`, `feature.{1..3}.description`, `feature.{1..3}.icon`
- `showcase.title`, `showcase.subtitle`, `showcase.cards` (JSON array of `{title, subtitle}`)
- `howitworks.title`, `howitworks.steps` (JSON array of `{icon, title, description}`)
- `cta.title`, `cta.subtitle`, `cta.button_primary`, `cta.button_primary_link`, `cta.button_secondary`, `cta.button_secondary_link`
- `footer.about`, `footer.links` (JSON array of `{label, href}`), `footer.links_title`, `footer.copyright`
- `brand`, `nav.features`, `nav.showcase`, `nav.about`, `nav.contact`, `header.login`
- `seo.homepage`

## 4. How to manage the UI going forward

- **Text changes** — Admin → Homepage tab. No deploy needed.
- **List content** (showcase cards, steps, footer links) — JSON arrays in the corresponding fields.
- **Hero imagery** — set `homepage.hero.image` to a URL uploaded via Admin → Media (media files live in backend storage; the URL is stored as a setting). No hardcoded `lh3.googleusercontent.com` links remain.
- **Adding a new homepage section** — create the component in `web/src/components/home/`, add its keys to the `publicHomepage` whitelist and the admin `HOMEPAGE_KEYS` list, compose it in `web/src/app/page.tsx`.
- **Removing a section** — delete the component import/usage from `page.tsx` and its keys from the two key lists.

## 5. Files to touch for common changes

| Change | Files |
|---|---|
| New homepage section | new component + `page.tsx` + whitelist in `AdminController.publicHomepage` + `HOMEPAGE_KEYS` in `admin/page.tsx` |
| New CMS field on existing section | whitelist + `HOMEPAGE_KEYS` + component read via `cms()` |
| Recovery code issuance | `php artisan admin:recovery-code {phone}` (server-side) |
| Auth flow changes | `api/app/Http/Controllers/Api/Auth/AuthController.php`, `api/routes/api.php` |

## 6. Security notes

- No API keys or secrets in the frontend; the frontend talks only to `/api/*` with a Bearer token.
- All admin routes remain `auth:sanctum` + `role:admin`.
- Recovery codes: stored hashed, hidden from API responses, single-use (rotated to null on success), route throttled.

## 7. Verification status

- `npx tsc --noEmit` (web): **PASS**
- `npm run lint` (web): **PASS** (0 errors, 0 warnings)
- `npm run build` (web): pending final run
- PHP syntax checks on all touched backend files: **PASS**
- PHPUnit: pending Docker/PostgreSQL environment (host SQLite PDO unavailable, consistent with prior phases)
