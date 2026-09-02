# Phase 5 Checkpoint — Plans, Subscriptions, Showcase & Ads

**Date:** 2026-09-01
**Status:** Implemented locally; backend integration tests pending Docker/PostgreSQL verification
**Canonical plan:** `docs/MASTER_BOOTSTRAP_PROMPT.md` (requested `docs/MASTER-PROMPT.md` is absent)

## Completed tasks

- Added active plans with price, duration, feature flags, and activation state.
- Added manual subscription workflow using receipt/tracking references.
- Added admin subscription moderation with active/rejected/expired states.
- Added automatic subscription end-date calculation from plan duration.
- Added `FeatureGate` service for current, non-expired subscription features.
- Added showcase items with title, description, price, image path, and publish state.
- Added public approved-business showcase endpoint.
- Added advertising records with slot, target URL, schedule, and moderation state.
- Added public active advertisement endpoint capped at four records per slot.
- Added owner/admin advertisement creation gated by the active plan.
- Added per-business/per-slot pending/approved advertisement cap of four.
- Preserved Phase 1–4 routes and contracts; no online payment gateway was added.

## Modified files

### Database
- `api/database/migrations/2026_09_01_000005_create_plans_table.php`
- `api/database/migrations/2026_09_01_000006_create_subscriptions_table.php`
- `api/database/migrations/2026_09_01_000007_create_showcases_table.php`
- `api/database/migrations/2026_09_01_000008_create_advertisements_table.php`

### Backend
- `api/app/Models/Plan.php`
- `api/app/Models/Subscription.php`
- `api/app/Models/Showcase.php`
- `api/app/Models/Advertisement.php`
- `api/app/Models/Business.php`
- `api/app/Services/FeatureGate.php`
- `api/app/Http/Requests/Subscription/SubscriptionRequest.php`
- `api/app/Http/Requests/Showcase/ShowcaseRequest.php`
- `api/app/Http/Requests/Advertisement/AdvertisementRequest.php`
- `api/app/Http/Controllers/Api/SubscriptionController.php`
- `api/app/Http/Controllers/Api/ShowcaseController.php`
- `api/app/Http/Controllers/Api/AdvertisementController.php`
- `api/routes/api.php`
- `api/tests/Feature/PhaseFiveTest.php`

## API additions

- `GET /api/plans`
- `GET /api/businesses/{business}/subscriptions`
- `POST /api/businesses/{business}/subscriptions`
- `PATCH /api/admin/subscriptions/{subscription}/moderate`
- `GET /api/public/businesses/{business}/showcases`
- `GET /api/businesses/{business}/showcases`
- `POST /api/businesses/{business}/showcases`
- `PUT /api/showcases/{showcase}`
- `DELETE /api/showcases/{showcase}`
- `GET /api/public/advertisements/{slot}`
- `GET /api/businesses/{business}/advertisements`
- `POST /api/businesses/{business}/advertisements`

## MVP payment scope

Only manual receipt/tracking-reference submission is implemented. There is no IPG, webhook, card payment, or automatic payment reconciliation.

## Feature gating

Feature flags are stored in each plan's JSON `features` object. The `FeatureGate` service checks the latest active subscription whose `end_date` is today or later. Showcase creation requires `features.showcase`; advertisement creation requires `features.ads`.

## Verification

- PHP syntax checks for Phase 5 files: PASS.
- Frontend `npm run lint`: PASS.
- Frontend `npx tsc --noEmit`: PASS.
- Frontend `npm run build`: PASS.
- Backend PHPUnit: NOT FULLY PASSED. Host execution is blocked by missing SQLite PDO (`could not find driver`). Tests remain pending Docker/PostgreSQL verification; they are not marked passed.

## Remaining issues

- Execute the Phase 5 PHPUnit suite in Docker with PostgreSQL.
- Add a dedicated admin/UI flow for plan and subscription moderation in Phase 6.
- Add showcase and advertisement dashboard screens if required during the admin/business-panel phase.
- Add scheduled expiry transition/queue handling if operational automation is required; current feature gating treats expired subscriptions as inactive at read time.
