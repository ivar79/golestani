# Phase 6.1 Checkpoint — CMS Control Center

## Completed

- Added CMS persistence for site settings, editable static pages, articles, and reusable media metadata.
- Added admin-only APIs for settings, page content, blog articles, and safe media uploads.
- Added Persian-compatible long-text fields and SEO/OpenGraph fields for pages/articles.
- Preserved Phase 6 authorization and all Phase 1–6 contracts.

## Modified files

- `api/app/Http/Controllers/Api/AdminController.php`
- `api/routes/api.php`
- `api/app/Models/SiteSetting.php`
- `api/app/Models/PageContent.php`
- `api/app/Models/Article.php`
- `api/app/Models/Media.php`
- `api/database/migrations/2026_09_01_000009_create_cms_tables.php`
- `web/src/lib/admin.ts`
- `web/src/app/admin/page.tsx`

## API additions

- `GET/PUT /api/admin/settings[/{key}]`
- `GET/PUT /api/admin/pages[/{slug}]`
- `GET /api/admin/articles`
- `POST /api/admin/articles[/{article}]`
- `DELETE /api/admin/articles/{article}`
- `POST /api/admin/media`

All routes use the existing Sanctum authentication and `admin` role middleware.

## Verification

- PHP syntax checks: passed.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- PHPUnit: pending Docker/PostgreSQL verification; not marked passed because host SQLite PDO is unavailable.

## Remaining issues

- The current admin UI remains the operational dashboard; full tabbed CMS forms for article/page/settings editing should be added as the next UI increment.
- Article cover/media URLs should be exposed through a dedicated public serializer before production use.
- Add dedicated authorization, upload, slug-collision, and published-visibility tests in Docker/PostgreSQL.
