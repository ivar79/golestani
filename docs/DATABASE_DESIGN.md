# Database Design

## Main Entities & Relationships
- **Users**: Core authentication table. (1:M with Businesses, 1:1 with Designers).
- **Roles**: RBAC management. (M:N with Users).
- **Businesses**: Stores business details and location. (1:1 with BusinessCards, 1:M with Subscriptions).
- **Categories & Services**: Taxonomy for businesses. (M:N with Businesses).
- **Designers & Portfolios**: Designer profiles and their work. (1:M with Portfolios).
- **Plans & Subscriptions**: Monetization. (1:M between Plans and Subscriptions).
- **Advertisements**: Sponsored placements.

## Suggested Tables & Key Columns

### `users`
- `id` (PK)
- `phone_number` (Unique, Indexed)
- `name`
- `is_active`
- `created_at`, `updated_at`

### `businesses`
- `id` (PK)
- `user_id` (FK to users)
- `name`, `description`
- `city_id`, `neighborhood_id`
- `geom` (Geometry/Point) - *Crucial for PostGIS*
- `status` (Enum: pending, approved, suspended)
- `qr_code_url`, `public_slug` (Unique)
- `social_links` (JSONB)

### `business_cards`
- `id` (PK)
- `business_id` (FK to businesses)
- `template_id`
- `font_settings` (JSON)
- `color_settings` (JSON)
- `uploaded_file_path` (Nullable, for PDF/Image prints)

### `plans`
- `id` (PK)
- `name`, `price`, `duration_days`
- `features` (JSONB - defining limits and capabilities)

### `subscriptions`
- `id` (PK)
- `business_id` (FK to businesses)
- `plan_id` (FK to plans)
- `status` (Enum: active, expired, pending)
- `start_date`, `end_date`
- `transaction_reference`

### `designers`
- `id` (PK)
- `user_id` (FK to users)
- `referral_code` (Unique)
- `status` (Enum: pending, approved, suspended)

### `portfolios`
- `id` (PK)
- `designer_id` (FK to designers)
- `file_path`, `title`, `status`

## Important Indexes
- **Spatial Index**: GIST index on `businesses.geom` for fast radius and bounding-box queries (`ST_DWithin`).
- **B-Tree Indexes**: `businesses.city_id`, `businesses.status`, `users.phone_number`, `subscriptions.status`, `subscriptions.end_date`.

## Data Validation Rules
- `phone_number`: Must match valid local format.
- `geom`: Must be valid EPSG:4326 coordinates (Longitude/Latitude).
- `uploaded_file_path`: MIME type validation restricted to `image/jpeg`, `image/png`, and `application/pdf`. Max file size limits strictly enforced at DB and App levels.

---

## Complete Table List (25 tables — source of truth: `api/database/migrations`)

| # | Table | Migration file |
|---|-------|----------------|
| 1 | `users` | `0001_01_01_000000` + `2026_08_28_000001` + `2026_09_01_000010` + `2026_09_02_000003` |
| 2 | `password_reset_tokens` | `0001_01_01_000000` |
| 3 | `sessions` | `0001_01_01_000000` |
| 4 | `cache` | `0001_01_01_000001` |
| 5 | `cache_locks` | `0001_01_01_000001` |
| 6 | `jobs` | `0001_01_01_000002` |
| 7 | `job_batches` | `0001_01_01_000002` |
| 8 | `failed_jobs` | `0001_01_01_000002` |
| 9 | `personal_access_tokens` | `2026_08_27_135415` |
| 10 | `roles` | `2026_08_28_000002` |
| 11 | `role_user` | `2026_08_28_000003` |
| 12 | `permissions` | `2026_09_02_000001` |
| 13 | `permission_role` | `2026_09_02_000001` |
| 14 | `businesses` | `2026_08_29_000001` |
| 15 | `designers` | `2026_09_01_000002` |
| 16 | `portfolios` | `2026_09_01_000003` |
| 17 | `business_cards` | `2026_09_01_000004` |
| 18 | `plans` | `2026_09_01_000005` |
| 19 | `subscriptions` | `2026_09_01_000006` |
| 20 | `showcases` | `2026_09_01_000007` |
| 21 | `advertisements` | `2026_09_01_000008` |
| 22 | `site_settings` | `2026_09_01_000009` |
| 23 | `page_contents` | `2026_09_01_000009` |
| 24 | `articles` | `2026_09_01_000009` |
| 25 | `media` | `2026_09_01_000009` |

> ⚠️ **Important:** You do **NOT** need to create these tables manually in Neon.
> Run `php artisan migrate --force` (it runs automatically in the Render
> pre-deploy step) — it creates every table, index, constraint, the PostGIS
> extension, and the `geom` column for you. The manual SQL file
> [`SCHEMA_ALL_TABLES.sql`](SCHEMA_ALL_TABLES.sql) is only provided so you can
> inspect or hand-build the schema in a Neon SQL editor if you prefer.
>
> The **only** thing you must enable beforehand on Neon is the **PostGIS**
> extension availability (Neon supports it out of the box — no action needed;
> the migration runs `CREATE EXTENSION IF NOT EXISTS postgis`).
