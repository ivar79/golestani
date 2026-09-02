# Phase 4 Checkpoint — Card Maker & Designer Workflow

**Date:** 2026-09-01
**Status:** Implemented locally; backend integration tests pending Docker/PostgreSQL verification
**Canonical plan:** `docs/MASTER_BOOTSTRAP_PROMPT.md` (requested `docs/MASTER-PROMPT.md` is absent)

## Completed tasks

- Added three constrained digital business-card templates: classic, midnight, emerald.
- Added predefined theme choices: navy, emerald, warm.
- Added predefined font-size choices: small, medium, large.
- Added business-card persistence per business/template.
- Added client-side PNG/JPG export using `html-to-image`.
- Added designer profile creation/update workflow.
- Added designer portfolio upload workflow.
- Added secure portfolio MIME validation for JPEG, PNG, and PDF files.
- Added randomized Laravel Storage paths for portfolio files.
- Added designer-owned portfolio listing/deletion.
- Added admin-only portfolio moderation endpoint.
- Preserved existing Phase 1–3 contracts and role middleware.

## Modified files

### Backend
- `api/database/migrations/2026_09_01_000002_create_designers_table.php`
- `api/database/migrations/2026_09_01_000003_create_portfolios_table.php`
- `api/database/migrations/2026_09_01_000004_create_business_cards_table.php`
- `api/app/Models/Designer.php`
- `api/app/Models/Portfolio.php`
- `api/app/Models/BusinessCard.php`
- `api/app/Models/User.php`
- `api/app/Models/Business.php`
- `api/app/Http/Requests/Designer/DesignerRequest.php`
- `api/app/Http/Requests/Designer/PortfolioRequest.php`
- `api/app/Http/Requests/Business/BusinessCardRequest.php`
- `api/app/Http/Controllers/Api/Designer/DesignerController.php`
- `api/app/Http/Controllers/Api/BusinessCardController.php`
- `api/routes/api.php`

### Frontend
- `web/package.json`
- `web/package-lock.json`
- `web/src/components/cards/CardCanvas.tsx`
- `web/src/app/card-maker/page.tsx`
- `web/src/app/designer/page.tsx`

## API additions

- `GET /api/businesses/{business}/card`
- `PUT /api/businesses/{business}/card`
- `GET /api/designer/profile`
- `PUT /api/designer/profile`
- `GET /api/designer/portfolios`
- `POST /api/designer/portfolios`
- `DELETE /api/designer/portfolios/{portfolio}`
- `PATCH /api/admin/portfolios/{portfolio}/moderate`

## Security and scope

- Card customization is limited to predefined values; no drag-and-drop or free-form positioning exists.
- Portfolio uploads use Laravel file MIME validation, a 10 MB limit, and Laravel Storage-generated paths.
- Designer and portfolio routes use existing Sanctum and role middleware.
- Business card access is owner/admin scoped.
- No PDF/CMYK print generation or online payment integration was added.

## Verification

- PHP syntax checks for new backend files: PASS.
- `npm run lint`: PASS.
- `npx tsc --noEmit`: PASS.
- `npm run build`: PASS; `/card-maker` and `/designer` compile.
- Backend PHPUnit: NOT PASSED/NOT COMPLETE. Host execution is blocked by missing SQLite PDO driver (`could not find driver`). Full tests remain pending Docker/PostgreSQL verification.

## Remaining issues

- Run the backend suite inside the configured Docker environment.
- Add dedicated Phase 4 PHPUnit tests for designer ownership, moderation, upload rejection, and card validation.
- Add a public approved-designer portfolio page if required after product review.
- Add deletion of stored portfolio files on record deletion in a future hardening pass.
