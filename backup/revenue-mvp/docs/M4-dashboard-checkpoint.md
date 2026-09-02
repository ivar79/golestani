# M4 Checkpoint — Dashboard UI Upgrade

**Date:** 2026-09-01
**Status:** M4 COMPLETED — awaiting review
**Scope:** Frontend only (web/). No backend changes. No new dependencies.

---

## 1. Current Project Phase Status

### Completed phases
- **M1 — Auth backend:** OTP login (send-otp / verify-otp), rate limiting
  (3/10min send, 5/15min verify), Sanctum personal access tokens, logout, /auth/me.
- **M2 — RBAC:** roles table + role_user pivot, RoleSeeder (user, business_owner,
  designer, admin), HasRoles trait, CheckRole middleware, role-guarded routes.
- **M3 — Business API backend:** CRUD for business profiles, admin moderation
  (approved/rejected/suspended + moderation_note), public approved-only API,
  QR endpoint, full security test suite (IDOR, mass assignment, XSS-as-data,
  SQL injection as data, slug uniqueness).

### Current phase
- **M4 — Dashboard UI upgrade:** COMPLETED (this checkpoint), awaiting review.

### Next planned phases
- **M5 — Public business profile page** (basic /b/[slug] exists; needs rich layout,
  services display, QR link).
- Future candidates: admin moderation UI, business search/list, profile settings,
  image/logo upload, geolocation search.

---

## 2. M4 Dashboard Implementation

### Changed files
- `web/src/app/dashboard/page.tsx` — rewritten (7-line stub → ~408 lines).
- No backend files changed. No new dependencies. Auth/API logic untouched.

### Architecture decisions
- Client component ("use client") reusing the existing `AuthContext` and the
  shared axios instance (`@/lib/api`) with its Bearer interceptor.
- Auth guard: redirect to /login via useEffect when `!user && !authLoading`
  (no new middleware, no route group change).
- All data comes from existing endpoints — nothing hardcoded.
- Status labels/badges are presentational only; status VALUES come from the API
  enum (draft/pending/approved/rejected/suspended).

### Components created (local to the page; extraction candidates for M5+)
- `StatusBadge` — colored pill per business status.
- `FeedbackBanner` — success/error banner (role="status").
Note: kept local to the page given tooling constraints; extraction to
`web/src/components/dashboard/` is a recommended cleanup for the next pass.

### API endpoints used (all pre-existing)
- `GET /api/businesses` — list owner profiles
- `POST /api/businesses` — create (returns 201, status=pending)
- `PUT /api/businesses/{id}` — update (resets status to pending)
- `DELETE /api/businesses/{id}` — delete
- `GET /api/auth/me` — user info on load
- `POST /api/auth/logout` — logout

### Data models / fields consumed
- `Business`: id, name, slug, category, description, phone, email, address,
  city, neighborhood, services[], social_links, status, moderation_note.
- `UserInfo`: id, phone, roles[] (from /auth/me).

### UX decisions
- RTL Persian UI; labels in Persian; phone/dir="ltr" where numeric.
- Status badges color-coded: amber=pending, emerald=approved, red=rejected/
  suspended, zinc=draft; moderation_note shown ONLY for rejected.
- Services entered comma-separated in UI → sent as string[] (API contract).
- Skeleton loading cards; friendly empty state with CTA; success/error banner;
  confirm() before delete; edit pre-fills the form and scrolls to top.

---

## 3. Frontend Current Architecture

### Framework versions
- Next.js 16.3.3 (App Router), React 19.2.8, TypeScript 5, Tailwind CSS 4,
  axios 1.20. No state library — React Context is enough at this scale.

### Folder structure (web/src)
- `app/` — routes: `/` (landing), `/about`, `/contact`, `/privacy`,
  `/b/[slug]` (public business), `/(auth)/login`, `/(auth)/otp`, `/dashboard`.
- `components/` — `layout/` (SiteHeader + BrandMark, SiteFooter),
  `auth/` (PhoneInput, OtpInput).
- `contexts/` — `AuthContext` (token + user + OTP actions + logout).
- `lib/` — `api.ts` (axios instance + Bearer interceptor + extractApiError),
  `auth.ts` (OTP/me/logout calls), `businesses.ts` (business CRUD calls).
- `types/` — `auth.ts` (UserInfo, responses).

### Shared components
- `BrandMark` / `SiteHeader` (navy brand box "اَ" + اینکارت), `SiteFooter`,
  `PhoneInput` (digit normalization fa/ar → en), `OtpInput` (5-digit, paste,
  auto-advance, RTL-aware LTR inputs).

### Design system rules
- Colors via Tailwind v4 `@theme` tokens: navy-50…950 (primary), emerald
  (accent), surface #faf9f6, ink #1c2430. NO raw hex in components.
- Font stack: Vazirmatn → IRANSansX → IRANSans → Segoe UI (set in @theme).
- RTL: `<html lang="fa" dir="rtl">`; numeric inputs get `dir="ltr"`.
- Cards: rounded-2xl/3xl, border-navy-100, white bg, soft shadow.
- Buttons: emerald-600 primary, navy-800 secondary/brand, pill shapes.

### Authentication flow
1. `/login` → phone (normalized) → POST /auth/send-otp (throttled 3/10min).
2. `/otp` → 5-digit input → POST /auth/verify-otp (throttled 5/15min).
3. Token stored: localStorage `golestani_token` + cookie `golestani_token`
   (7d, SameSite=Lax) so Next middleware can guard routes without server call.
4. `AuthContext` loads /auth/me on boot; invalid token → cleanup + redirect.
5. Logout: POST /auth/logout + local cleanup + redirect /login.

---

## 4. Backend Integration Notes

### Existing API contracts (Laravel, Sanctum Bearer tokens)
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /api/auth/send-otp | – | throttle 3/10min |
| POST | /api/auth/verify-otp | – | throttle 5/15min; returns token+user |
| POST | /api/auth/logout | sanctum | revoke current token |
| GET | /api/auth/me | sanctum | id, phone, roles[] |
| GET | /api/businesses | sanctum + role business_owner,admin | owner's list |
| POST | /api/businesses | sanctum + role | 201, status=pending, slug auto |
| PUT | /api/businesses/{id} | sanctum + role | resets status→pending, clears note |
| DELETE | /api/businesses/{id} | sanctum + role (owner/admin) | |
| PATCH | /api/admin/businesses/{id}/moderate | sanctum + role admin | status: approved/rejected/suspended |
| GET | /api/public/businesses/{slug} | public | approved ONLY; no owner/note/user_id |
| GET | /api/public/businesses/{slug}/qr | public | SVG QR to /b/{slug} |

### Fields expected by frontend (Business)
- Required: name (max 120). Optional: category (120), services (array ≤30,
  items ≤120), description (5000), phone (30), email, address (1000),
  city (120), neighborhood (120), lat/lon, social_links (urls).
- Server-controlled (never sent by UI): slug, status, moderation_note, user_id.
- Status lifecycle: create/update → pending; only admin → approved/rejected/
  suspended. Public API returns approved only.

---

## 5. Development Rules for Future Work
- Do NOT hardcode business content or user data — always from API.
- Do NOT change backend contracts without explicit approval (M-gate review).
- Do NOT add dependencies without approval.
- Follow the navy/emerald design tokens; no raw hex in components.
- Status values come from the API enum; UI only maps them to labels/colors.
- Review gate: each milestone reviewed before the next starts.

### 6. Next pending tasks
- **M5 — public business profile** page (rich layout for /b/[slug]: services
  list, contact actions, QR link to /api/public/businesses/{slug}/qr).
- Recommended cleanup (non-blocking): extract StatusBadge/FeedbackBanner to
  `web/src/components/dashboard/`; reuse in future admin moderation UI.
