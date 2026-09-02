# Phase 1 Implementation Plan

## 1. Frozen MVP Scope & Actionable Development Constraints
To guarantee delivery within the 45-working-day timeline, the following technical constraints are now frozen:
- **Card Maker (Phase 4):** Strictly limited to digital output (web-friendly PNG/JPG) using client-side rendering. Customization is restricted to predefined dropdowns (no drag-and-drop, no free-form pixel scaling, no CMYK print rendering).
- **Admin Panel (Phase 6):** Will be built using a Rapid Application Development (RAD) framework (e.g., Laravel Filament) to ensure the 7-day delivery timeline. Custom UI components will be avoided unless strictly necessary.
- **Payments (Phase 5):** Hardcoded to manual receipt/tracking number upload. Any IPG (Internet Payment Gateway) integration is deferred to post-MVP or requires a separate change request.
- **Maps (Phase 3):** Development will proceed using a free, open-source tile provider (e.g., Leaflet with OpenStreetMap) as a non-blocking placeholder until the client provides specific Iranian map provider credentials (e.g., Neshan).
- **SMS Auth (Phase 1):** Abstracted behind an `SmsService` interface. We will use a mock driver that logs OTPs to the console in development until production API keys are provided.

## 2. Blocking Technical Decisions Required Before Coding
1. **Repository Structure:** Confirm whether the Next.js frontend and Laravel backend should be housed in a **Monorepo** (e.g., `/client` and `/api` folders) or **Separate Repositories**. (Monorepo is recommended for easier full-stack PRs).
2. **Admin Framework:** Final sign-off to use Laravel Filament for the backend dashboard.

---

## 3. Phase 1 Implementation Details
**Duration:** 6 Working Days
**Budget Allocation:** 6,000,000 Toman

### Objectives
1. Initialize the project architecture (Frontend & Backend).
2. Configure PostgreSQL with the PostGIS extension.
3. Configure Redis for caching and session management.
4. Implement the base User and Role architecture.
5. Implement OTP-based Authentication (Registration/Login).

### Database Migrations
Only core authentication tables are required for Phase 1:
1. `users` (id, phone_number [unique, indexed], name, is_active, created_at, updated_at).
2. `roles` (id, name, slug).
3. `role_user` (pivot table).
4. `personal_access_tokens` (Laravel Sanctum default table for API tokens).

### Laravel Structure (Backend)
- **Framework:** Laravel 11 (PHP 8.3) configured strictly as an API (`php artisan install:api`).
- **Auth:** Laravel Sanctum for stateless API token management.
- **Directories to establish:**
  - `app/Http/Controllers/Api/V1/` (e.g., `AuthController.php`).
  - `app/Services/` (e.g., `SmsService.php` with Mock and Real drivers).
  - `app/Models/` (User, Role).
  - `routes/api.php` (Define `/send-otp` and `/verify-otp`).

### Next.js Structure (Frontend)
- **Framework:** Next.js 15 (App Router) + TypeScript + Tailwind CSS.
- **Directories to establish:**
  - `src/app/(auth)/` (Login/OTP pages).
  - `src/components/` (Reusable UI like Buttons, Inputs).
  - `src/lib/api/` (Axios or fetch interceptors for appending Sanctum Bearer tokens).
  - `src/store/` or Context API (Global auth state management).

### Git Workflow
- **Master Branch:** Represents the Staging/Testing environment.
- **Feature Branches:** e.g., `feat/phase1-auth`, `feat/phase1-infra`.
- **Commit Policy:** Code must be committed to the client's private Git repository at least once every 24 hours (as per contract).
- **PRs:** Pull requests require passing basic CI checks (linting/tests).

### Acceptance Criteria
- [ ] Laravel API successfully connects to PostgreSQL (with PostGIS enabled) and Redis.
- [ ] Next.js app successfully compiles and communicates with the Laravel API.
- [ ] User can submit a phone number and receive an OTP (mocked in logs or real SMS).
- [ ] User can submit the OTP and receive a valid JWT/Sanctum token.
- [ ] A new user is correctly assigned a default role (e.g., `user` or `business_owner`) in the database.
- [ ] Staging environment is accessible via a provided URL.

### Required Tests
- **Backend (Pest / PHPUnit):**
  - Unit test: `SmsService` successfully generates and caches a 5-digit OTP.
  - Feature test: `/send-otp` endpoint validates phone number format.
  - Feature test: `/verify-otp` correctly issues a token for valid codes and rejects invalid/expired codes.
- **Frontend (Jest / React Testing Library):**
  - Unit test: OTP input component only accepts numerical values.
  - Integration test: Auth context successfully updates upon receiving a valid token.
