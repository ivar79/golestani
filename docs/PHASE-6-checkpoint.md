# Phase 6 Checkpoint — Admin Panel

## Completed tasks

- Added role-protected admin overview with operational counts and moderation queues.
- Added admin user listing and activation/name update endpoint.
- Added consolidated moderation actions for businesses, showcases, and advertisements.
- Preserved existing subscription and portfolio moderation endpoints and exposed them in the admin UI.
- Added an authenticated `/admin` MVP operations dashboard.
- Preserved existing Phase 1–5 contracts, roles, and authentication flow.

## Modified files

- `api/app/Http/Controllers/Api/AdminController.php`
- `api/routes/api.php`
- `api/tests/Feature/PhaseSixTest.php`
- `web/src/lib/admin.ts`
- `web/src/app/admin/page.tsx`

## API additions

- `GET /api/admin/overview`
- `GET /api/admin/users`
- `PATCH /api/admin/users/{user}`
- `PATCH /api/admin/showcases/{showcase}/moderate`
- `PATCH /api/admin/advertisements/{advertisement}/moderate`

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
- Run the full backend suite in the configured Docker/PostgreSQL environment before production release.

## Next phase

Proceed to Phase 7 security, deployment, backup, audit, and handover work without changing completed feature contracts unless a security finding requires it.
