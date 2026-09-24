# Phase 6 Checkpoint — Admin Panel

## Current status

Core admin operations completed; remaining release hardening is limited to role-assignment
policy decisions, richer rejection forms, and Docker/PostgreSQL full-suite verification.

## Completed tasks

- Added role-protected admin overview with operational counts and moderation queues.
- Added admin user listing and activation/name update endpoint.
- Added consolidated moderation actions for businesses, showcases, and advertisements.
- Preserved existing subscription and portfolio moderation endpoints and exposed them in the admin UI.
- Added an authenticated `/admin` MVP operations dashboard.
- Added dynamic admin taxonomies for cities, neighborhoods, categories, services, and badges.
- Added public active-taxonomy API for replacing hardcoded lists incrementally.
- Added admin health checks for database, PostGIS, Redis, and storage.
- Added centralized paginated audit-log API.
- Added admin UI tabs for taxonomies, health, plans, and revenue summary.
- Added admin UI tabs for designers, public reports, and audit history.
- Fixed the user activation toggle action in the admin users tab.
- Connected dashboard categories and search-modal categories to the public taxonomy API with safe fallbacks.
- Added public business reporting with admin moderation workflow.
- Preserved existing Phase 1–5 contracts, roles, and authentication flow.

## Modified files

- `api/app/Http/Controllers/Api/AdminController.php`
- `api/routes/api.php`
- `api/tests/Feature/PhaseSixTest.php`
- `web/src/lib/admin.ts`
- `web/src/app/admin/page.tsx`
- `api/app/Models/AdminTaxonomy.php`
- `api/app/Http/Controllers/Api/AdminTaxonomyController.php`
- `api/database/migrations/2026_09_20_000003_create_admin_taxonomies_table.php`
- `web/src/components/admin/AdminTaxonomiesTab.tsx`
- `web/src/components/admin/AdminHealthTab.tsx`
- `web/src/components/admin/AdminPlansTab.tsx`

## API additions

- `GET /api/admin/overview`
- `GET /api/admin/users`
- `PATCH /api/admin/users/{user}`
- `PATCH /api/admin/showcases/{showcase}/moderate`
- `PATCH /api/admin/advertisements/{advertisement}/moderate`
- `GET/POST/PUT/DELETE /api/admin/taxonomies[/{taxonomy}]`
- `GET /api/public/taxonomies`
- `GET /api/admin/health`
- `GET /api/admin/audit`
- `GET /api/admin/designers`
- `PATCH /api/admin/designers/{designer}/moderate`
- `POST /api/public/businesses/{business}/reports`
- `GET /api/admin/reports`
- `PATCH /api/admin/reports/{report}/moderate`

All additions require `auth:sanctum` and the existing `admin` role middleware. Existing business, subscription, and portfolio moderation endpoints remain unchanged.

## Frontend changes

- Added `/admin` route with role-aware redirect.
- Added summary cards and moderation queues for all Phase 5/Phase 4 operational resources.
- Added refresh, logout, error handling, and one-click MVP approval actions.

## Verification

- PHP syntax checks: passed for the new controller, routes, and test.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- PHPUnit: **pending Docker/PostgreSQL verification**. Host execution remains blocked by unavailable SQLite PDO; backend tests are not marked as passed.

## Remaining issues

- User role assignment UI is intentionally excluded from this MVP; role changes remain governed by existing server-side role data.
- Queue actions currently provide the primary approval path; detailed rejection-note forms and audit logs are future hardening work.
- Replace remaining hardcoded city/service/badge consumers with the public taxonomy API.
- Decide whether role assignment should be exposed in UI; current server-side role policy remains protected.
- Add richer per-queue rejection-note forms where one-click moderation is still used.
- Run the full backend suite in the configured Docker/PostgreSQL environment before production release.

## Next phase

Proceed to Phase 7 security, deployment, backup, audit, and handover work without changing completed feature contracts unless a security finding requires it.
