# Phase 1 Technical Decisions

This document locks in the architectural and structural decisions required to execute Phase 1. These decisions are optimized for the strict 45-working-day timeline.

## 1. Repository Structure
**Decision:** Monorepo Strategy.
The exact folder structure at the root of the repository will be:
- `/web`: Frontend Next.js application.
- `/api`: Backend Laravel API application.
- `/infrastructure`: Docker configurations (e.g., `docker-compose.yml`, PostGIS Dockerfile, Nginx configs).
- `/docs`: Project documentation, including all architectural decisions and Phase roadmaps.

- **Why it fits the 45-day constraint:** Managing a single repository simplifies CI/CD overhead and local environment setup. A developer can pull one repository, run a single docker-compose command, and have the entire stack (PostgreSQL, Redis, Laravel, Next.js) running instantly. It allows developers to push full-stack features in a single Pull Request.
- **Alternative Risks:** Separating into multiple repositories creates friction in reviewing full-stack features and increases DevOps complexity.

## 2. Laravel Project Structure
**Decision:** API-Only Application (`php artisan install:api`) using Token-based Auth (Laravel Sanctum Bearer Tokens).
- **Why it fits the 45-day constraint:** Stripping out Blade, web middleware, and CSRF session cookies (in favor of stateless Bearer tokens) eliminates common cross-origin Resource Sharing (CORS) and session configuration headaches. Bearer tokens work perfectly across disparate Staging URLs without requiring complex cookie domain configurations.
- **Alternative Risks:** Using SPA Session Cookies (Sanctum's SPA mode) often leads to multi-day debugging sessions over CORS, SameSite cookie policies, and domain matching between frontend and backend environments.

## 3. Next.js Rendering Strategy & Project Structure
**Decision:** Next.js 16 App Router utilizing a hybrid rendering approach.
- **Server Components (SEO-Critical Public Pages):** Pages like the homepage, search results, and public business profiles (`/b/[slug]`) will use Server Components (SSR/ISR). This ensures web crawlers can index the content for SEO and minimizes client-side JavaScript.
- **Client Components (Authenticated Dashboards):** All secure pages (Business Panel, Designer Profile, Admin Dashboard) will heavily utilize Client Components (`"use client"`).
- **Why it fits the 45-day constraint:** This hybrid approach segregates complexity. Using Client Components for authenticated views allows us to use simple Bearer tokens in local storage/context for API requests without wrestling with Next.js SSR cookie-passing mechanisms. Server Components are reserved strictly for public, SEO-dependent read-only views.
- **Alternative Risks:** Forcing SSR on secure dashboard pages adds massive authentication complexity with no SEO benefit, risking the project timeline.

## 4. Database Migration Strategy
**Decision:** Standard Laravel Eloquent Migrations using Raw DB Statements for PostGIS geometry columns.
- **Why it fits the 45-day constraint:** Utilizing Laravel's built-in migration system keeps schema definitions strictly version-controlled. For PostGIS (Phase 3), instead of relying on heavy third-party geometry packages that might conflict with Laravel 12, we will use raw SQL statements inside migrations (e.g., `DB::statement('ALTER TABLE businesses ADD COLUMN geom geometry(Point, 4326)');`) to ensure stability.
- **Alternative Risks:** Installing unmaintained third-party PostGIS wrapper libraries can break future Laravel upgrades or cause unforeseen dependency conflicts mid-project.

## 5. Authentication Flow
**Decision:** Redis-backed OTP lifecycle with Laravel Sanctum token issuance.
**Exact OTP Authentication Lifecycle:**
1. **OTP Generation:** User submits a phone number to `/api/auth/send-otp`. The backend generates a random 5-digit code.
2. **Redis Storage Strategy:** The code is stored in Redis using the phone number as the key (e.g., `otp:09123456789`) with the hashed OTP as the value.
3. **OTP Expiration:** The Redis key is set with a strict 2-minute Time-To-Live (TTL). It automatically expires and cleans itself up.
4. **Verification Flow:** User submits the code to `/api/auth/verify-otp`. The backend retrieves the hash from Redis and compares it. If valid, the Redis key is deleted immediately to prevent reuse.
5. **User Creation:** If the phone number does not exist in the `users` table, a new user record is created and assigned a default role. If it exists, the user is retrieved.
6. **Sanctum Token Issuance:** Laravel Sanctum issues a new PlainTextToken for the user, returning it in the API response as a Bearer token.
7. **Logout/Token Revocation:** User calls `/api/auth/logout`. The specific Sanctum token used for the request is revoked (deleted from the `personal_access_tokens` table).
- **Why it fits the 45-day constraint:** Using Redis with TTL removes the need for database cron jobs to clean up expired OTPs. Abstracting the SMS sending to an interface allows a mock driver to log OTPs immediately without waiting for client API keys.
- **Alternative Risks:** Storing OTPs in the relational database requires manual cleanup jobs/cron tasks and adds unnecessary disk I/O for highly ephemeral data.

## 6. Environment Configuration
**Decision:** Centralized `.env` configurations via Docker Compose.
- **Why it fits the 45-day constraint:** Developers and staging environments will rely on a standardized `.env` template that wires the frontend to `http://localhost:8000/api` during local development automatically. 

## 7. Local Development Setup
**Decision:** Containerized Backend (Laravel Sail / Docker) + Local Node Frontend.
- **Why it fits the 45-day constraint:** The project requires PostgreSQL **with the PostGIS extension**. Installing PostGIS natively on Windows/Mac is historically prone to severe dependency errors. Providing a `docker-compose.yml` that pulls a pre-built `postgis/postgis` image guarantees that any developer on the team has a working spatial database in under 5 minutes.
- **Alternative Risks:** Forcing developers to install PostgreSQL, PostGIS, PHP 8.3, and Redis directly on their host OS will result in days lost to environment troubleshooting ("works on my machine" syndrome).

## 8. Actual Runtime Version Audit — 2026-08-28

- PHP runtime: **8.3.33** (Docker image `golestani-php:8.3`)
- Laravel framework: **12.68.0** (`composer.lock` and `php artisan --version`)
- Composer constraint: **PHP ^8.3**, Laravel framework **^12.0**
- PostgreSQL: **16.4**
- PostGIS: **3.4** image family and extension enabled
- Redis: **7-alpine**
- Frontend: Next.js **16.3.3**, React **19.2.8**, TypeScript **5.x**

Laravel 12 is compatible with the current PHP 8.3 baseline and the implemented API/Sanctum architecture. No downgrade is justified; the project will continue on Laravel 12. Existing Master Prompt references to Laravel 12 are superseded by this actual-version decision.

## 8. Actual Runtime Version Audit — 2026-08-28

- PHP runtime: **8.3.33** (Docker image `golestani-php:8.3`)
- Laravel framework: **12.68.0** (`composer.lock` and `php artisan --version`)
- Composer constraint: **PHP ^8.3**, Laravel framework **^12.0**
- PostgreSQL: **16.4**
- PostGIS: **3.4** image family and extension enabled
- Redis: **7-alpine**
- Frontend: Next.js **16.3.3**, React **19.2.8**, TypeScript **5.x**

Laravel 12 is compatible with the current PHP 8.3 baseline and the implemented API/Sanctum architecture. No downgrade is justified; the project will continue on Laravel 12. Existing Master Prompt references to Laravel 11 are superseded by this actual-version decision.
