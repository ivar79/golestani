# Phase 1 Execution Checklist

This checklist outlines the strictly ordered execution steps for Phase 1 (Infrastructure, Auth & Core Architecture). It must be followed sequentially to ensure all dependencies are met.

## 1. Environment & Repository Setup (COMPLETED)
- **Dependencies:** None.
- **Tasks:**
  - Initialize the Git repository.
  - Create a monorepo folder structure (`/api` for Laravel, `/web` for Next.js).
  - Setup base `.gitignore` files.
- **Expected Outputs:** Clean repository structure ready for framework scaffolding.
- **Completion Criteria:** Initial commit is pushed to the client's repository.

## 2. Laravel Backend Initialization
- **Dependencies:** Step 1.
- **Tasks:**
  - Scaffold a fresh Laravel 11 project in the `/api` directory.
  - Run `php artisan install:api` to configure API routing and Laravel Sanctum.
  - Set up standard modular directories (`app/Services`, `app/Http/Controllers/Api`).
- **Expected Outputs:** A functional, empty Laravel REST API.
- **Completion Criteria:** Running `php artisan serve` successfully loads the default API root without errors.

## 3. Next.js Frontend Initialization
- **Dependencies:** Step 1.
- **Tasks:**
  - Scaffold a Next.js 15 project (App Router) in the `/web` directory using TypeScript.
  - Install and configure Tailwind CSS.
  - Set up base directories (`src/components`, `src/app/(auth)`, `src/lib`).
- **Expected Outputs:** A responsive, empty Next.js web application.
- **Completion Criteria:** Running `npm run dev` successfully loads the default Next.js page.

## 4. Local Infrastructure & Database Configuration
- **Dependencies:** Step 2.
- **Tasks:**
  - Configure a `docker-compose.yml` (using Laravel Sail or custom config) to spin up PostgreSQL (with PostGIS extension) and Redis.
  - Configure backend `.env` variables to connect to these services.
- **Expected Outputs:** Containerized database and cache services running locally.
- **Completion Criteria:** Laravel can successfully connect to the database and Redis cache without timeouts.

## 5. Core Migrations (Users & Roles)
- **Dependencies:** Step 4.
- **Tasks:**
  - Create migrations for `users`, `roles`, and the `role_user` pivot table.
  - Define Eloquent Models and relationships.
  - Create a database seeder to populate default roles (`admin`, `business_owner`, `designer`, `user`).
- **Expected Outputs:** Schema deployed to the PostgreSQL database.
- **Completion Criteria:** `php artisan migrate --seed` executes successfully and database tables are visible.

## 6. OTP Authentication API (Backend)
- **Dependencies:** Step 5.
- **Tasks:**
  - Implement `SmsService` with a mock driver (logs OTP to output).
  - Create `/api/auth/send-otp` endpoint (generates 5-digit code, caches in Redis with a 2-minute TTL).
  - Create `/api/auth/verify-otp` endpoint (validates code, creates/fetches user, issues Sanctum Bearer token).
- **Expected Outputs:** Fully functional authentication API endpoints.
- **Completion Criteria:** API testing (via Postman/cURL or automated tests) successfully retrieves a Bearer token.

## 7. Next.js Auth UI & Integration (Frontend)
- **Dependencies:** Step 3 & Step 6.
- **Tasks:**
  - Build UI components for phone number input and OTP entry.
  - Implement API service module to communicate with the backend.
  - Implement global authentication state (React Context or Zustand).
- **Expected Outputs:** User-facing login flow.
- **Completion Criteria:** A user can type a phone number in the UI, read the mock OTP from the backend logs, submit it, and achieve a logged-in state in the frontend.

## 8. Automated Testing & Final Review
- **Dependencies:** Step 6 & Step 7.
- **Tasks:**
  - Write backend PHPUnit/Pest tests for OTP generation and verification.
  - Write frontend tests for OTP form validation.
  - Audit against the Phase 1 Acceptance Criteria.
- **Expected Outputs:** Passing test suites.
- **Completion Criteria:** All tests pass, and the Phase 1 branch is merged into the `main` branch.
