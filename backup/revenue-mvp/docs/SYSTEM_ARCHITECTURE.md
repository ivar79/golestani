# System Architecture

*Note: The current AI Studio environment contains React and Express boilerplates. According to the contract, this will be fully replaced with the agreed technology stack.*

## Technology Stack (Mandated)
- **Frontend**: Next.js + TypeScript
- **Backend**: Laravel + PHP 8.3
- **Database**: PostgreSQL + PostGIS
- **Caching/Queue**: Redis

## Architectural Overview
The system will follow a decoupled Client-Server RESTful architecture.

1. **Frontend Application (Next.js)**: 
   - **SSR/SSG**: Server-Side Rendering (SSR) for public business profiles and search pages to ensure SEO compliance.
   - **CSR**: Client-Side Rendering (CSR) for Admin, Business, and Designer secure dashboards.
   - **Routing**: Next.js App Router for optimized layouts and data fetching.

2. **Backend API (Laravel)**:
   - Exposes a stateless RESTful API.
   - Manages business logic, file validation, database transactions, and integrations (SMS).
   - **Authentication**: Handled via Laravel Sanctum (Token-based API auth for decoupled frontend).

3. **Database Layer (PostgreSQL + PostGIS)**:
   - Robust relational data management for financial and user data.
   - **PostGIS Extension**: Enabled for storing geographic points (`POINT(lon, lat)`) and performing highly optimized radius searches (`ST_DWithin`, `ST_Distance`).

4. **Caching & Session (Redis)**:
   - Stores OTP codes temporarily with TTL.
   - Manages user sessions and rate limiting.
   - Caches frequent queries (e.g., category lists, city taxonomy).

## File Storage
- **Object Storage / Local Disk**: Uploaded business images, PDF print designs, and designer portfolios will be stored in an S3-compatible object storage (e.g., MinIO/ArvanCloud) or a structured local disk using Laravel's Storage facade. 
- Strict MIME type validation will prevent the execution of uploaded malicious scripts.

## Authentication
- **Mechanism**: JWT or Cookie-based session via Laravel Sanctum.
- **Flow**: User inputs phone number -> Laravel generates OTP -> Stores in Redis with TTL -> Sends via SMS provider -> User submits OTP -> Token issued.
- **Admin**: Requires Two-Factor Authentication (2FA) - Time-based OTP (TOTP) or SMS verification.

## Deployment Strategy
- **Environments**: Staging (Testing) and Production.
- **CI/CD**: Git-based workflow. The client retains ownership of the Git repository. Pushes trigger automated deployments to Staging.
- **Containerization (Recommended)**: Dockerizing both Next.js and Laravel applications is recommended to ensure environment parity and ease of deployment.
