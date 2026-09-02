# Requirements Analysis

## Functional Requirements
- **Authentication**: Users must register and log in via SMS OTP. Session management is required.
- **Business Management**: Business owners can create/edit profiles (address, location, socials, images, services) and receive a dedicated URL and QR code.
- **Search & Discovery**: Users can search by city, neighborhood, service type, and geographical radius using PostGIS. Results must sort by proximity and be displayable on a map or as mini-cards.
- **Business Card Maker**: System must auto-generate business cards using at least 3 standard templates. Must allow uploading existing PDF/Image print designs.
- **Designer Profiles**: Designers can register, upload portfolios (sample works), and be assigned to businesses. Requires admin approval.
- **Monetization**: Implement tiered subscription plans and sponsored ad placements (max 4 per designated area). Features degrade automatically upon subscription expiry.
- **Admin Panel**: Full CRUD operations for users, businesses, designers, categories, subscriptions, ads, and system configurations.

## Non-Functional Requirements
- **Performance**: Geospatial queries must be optimized for fast retrieval using spatial indexes.
- **Security**: Must include rate limiting, 2FA for admins, secure file upload validation, XSS, SQLi, and CSRF protection.
- **Availability & Deployment**: System updates should minimize downtime. Backups/Rollbacks are required before major updates. Requires Staging/Testing environment for acceptance.
- **Technology Constraints (Strict)**: 
  - Frontend: Next.js + TypeScript
  - Backend: Laravel + PHP 8.3
  - Database: PostgreSQL + PostGIS
  - Cache: Redis

## User Roles
- **Guest**: Can view public business profiles and search (with limited personalization).
- **Registered User**: Can save locations and access user-specific search history/filters.
- **Business Owner**: Manages business profile, buys subscriptions, creates cards.
- **Designer**: Manages design portfolio and referrals.
- **System Admin**: Full system control, approvals, and reporting.

## User Journeys
1. **Search Journey**: User enters site -> grants location access or selects manually -> filters by service -> views nearest businesses on mini-cards or map -> clicks to view full profile.
2. **Business Onboarding**: Business owner registers via OTP -> creates profile -> awaits admin approval -> receives public link & QR -> buys subscription to unlock premium showcase features.
3. **Card Creation**: Business owner accesses card maker -> selects template -> system auto-fills info -> user adjusts font/color -> saves/downloads card.

## Ambiguities and Missing Information
- Exact SMS Gateway provider is not specified.
- Payment Gateway provider for subscriptions is not specified.
- Map Tile Provider (e.g., Google Maps, Neshan, Map.ir) is not defined. (Crucial for Iran-based projects).
- Details regarding "Public Reports" (گزارش‌های مردمی) need clarification.
