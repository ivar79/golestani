# Development Roadmap

Based on the agreed 45-day timeline and 7 phases outlined in the contract.

## Phase 1: Infrastructure, Auth & Core Architecture (6 Days)
- **Goal**: Setup Next.js, Laravel, PostgreSQL, PostGIS, and Redis. Implement SMS OTP auth and RBAC.
- **Deliverables**: Base architecture, user role system, working login/signup flow, session handling.
- **Acceptance**: OTP works, RBAC active, DB connections verified, Staging environment live.

## Phase 2: Business Registration & Public Page (7 Days)
- **Goal**: Allow business owners to create and manage profiles.
- **Deliverables**: Business panel, profile CRUD (address, map coords, socials), public SEO-friendly page, QR code generation.
- **Acceptance**: Data saves correctly, admin can approve/reject, public page is accessible via a unique independent link.

## Phase 3: Main Page, Search & Location (8 Days)
- **Goal**: Implement PostGIS radius search and map views.
- **Deliverables**: Main landing page, filters (city, neighborhood, badges), spatial query engine, map UI, nearest-neighbor sorting, mini-cards.
- **Acceptance**: User can set location, radius search returns accurate results sorted by distance, map renders correctly.

## Phase 4: Card Maker & Designer Profile (7 Days)
- **Goal**: Dynamic business card generation and designer portfolio management.
- **Deliverables**: Template engine (min 3 templates), PDF/Image print upload, designer profile CRUD, admin approval workflow for portfolios.
- **Acceptance**: Card auto-fills with business data, visual customizations apply, print uploads viewable, designers can share referral links.

## Phase 5: Plans, Subscriptions, Showcase & Ads (6 Days)
- **Goal**: Implement monetization systems and premium features.
- **Deliverables**: Subscription logic, feature-gating based on plans, pro showcase (gallery, prices), ad placement engine (max 4 per slot), sales reports.
- **Acceptance**: Expired subscriptions auto-lock features, ads display correctly, payment receipt tracking works.

## Phase 6: Central Admin Panel (7 Days)
- **Goal**: Total system management and oversight.
- **Deliverables**: Admin UI for managing users, businesses, designers, reports, taxonomies (cities, categories), system settings, and blog.
- **Acceptance**: Admin can moderate all user-generated content, view system metrics, and audit activity logs.

## Phase 7: Security, Deployment & Final Handover (4 Days)
- **Goal**: Harden system and deploy to production.
- **Deliverables**: 2FA for admin, Rate Limiting, XSS/SQLi/CSRF audits, secure file upload implementation, Backup/Restore/Rollback procedures.
- **Acceptance**: Security constraints block unauthorized access, Staging tests pass, Production environment is live and stable. Handover complete.
