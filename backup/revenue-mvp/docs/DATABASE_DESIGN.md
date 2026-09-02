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
