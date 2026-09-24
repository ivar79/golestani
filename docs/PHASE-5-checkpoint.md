# Phase 5 Checkpoint — Plans, Subscriptions, Showcase & Ads

**Date:** 2026-09-01
**Status:** Backend MVP complete locally; owner/admin UI expansion and Phase 6 remain
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
- Added receipt image/PDF upload with owner/admin-only download access.
- Added internal notifications for moderation and subscription expiry.
- Added scheduled `subscriptions:expire` command and daily scheduler registration.
- Added admin revenue and designer-attribution report endpoint.
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
- `api/app/Console/Commands/ExpireSubscriptions.php`
- `api/app/Models/InternalNotification.php`
- `api/database/migrations/2026_09_20_000002_add_receipt_and_notification_support.php`

## API additions

- `GET /api/plans`
- `GET /api/businesses/{business}/subscriptions`
- `POST /api/businesses/{business}/subscriptions`
- `GET /api/subscriptions/{subscription}/receipt`
- `PATCH /api/admin/subscriptions/{subscription}/moderate`
- `GET /api/notifications`
- `PATCH /api/notifications/{notification}/read`
- `GET /api/admin/reports/revenue`
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

- Run the full PHPUnit suite in the Docker/PostgreSQL environment before release.
- Complete the dedicated owner/admin UI for receipts, notifications, reports, showcases and ads before the Phase 6 UI pass.
- Online payment, webhook, reconciliation and automatic designer commission settlement remain explicitly out of scope.
