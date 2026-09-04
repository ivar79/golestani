-- ============================================================
-- Golestani — full schema generated from api/database/migrations
-- Target: PostgreSQL 15+ WITH PostGIS extension.
-- You do NOT need to run this by hand if you use
-- `php artisan migrate --force` (runs automatically on Render).
-- Provided so you can inspect every table/column or replicate the
-- schema in a Neon SQL editor.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS postgis;

-- ---- Auth / core ----
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    email_verified_at TIMESTAMP NULL,
    password VARCHAR(255) NULL,
    remember_token VARCHAR(100) NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
ALTER TABLE users ADD COLUMN phone VARCHAR(15) NULL;
ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX users_phone_unique ON users (phone);
ALTER TABLE users ADD COLUMN recovery_code VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN latitude DECIMAL(10,7) NULL;
ALTER TABLE users ADD COLUMN longitude DECIMAL(10,7) NULL;
ALTER TABLE users ADD COLUMN location_label VARCHAR(255) NULL;

CREATE TABLE password_reset_tokens (
    email VARCHAR(255) PRIMARY KEY,
    token VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NULL
);

CREATE TABLE sessions (
    id VARCHAR(255) PRIMARY KEY,
    user_id BIGINT NULL,
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    payload TEXT NOT NULL,
    last_activity INTEGER NOT NULL
);
CREATE INDEX sessions_user_id_index ON sessions (user_id);
CREATE INDEX sessions_last_activity_index ON sessions (last_activity);

-- ---- Cache ----
CREATE TABLE cache (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    expiration INTEGER NOT NULL
);
CREATE INDEX cache_expiration_index ON cache (expiration);

CREATE TABLE cache_locks (
    key VARCHAR(255) PRIMARY KEY,
    owner VARCHAR(255) NOT NULL,
    expiration INTEGER NOT NULL
);
CREATE INDEX cache_locks_expiration_index ON cache_locks (expiration);

-- ---- Jobs / queue ----
CREATE TABLE jobs (
    id BIGSERIAL PRIMARY KEY,
    queue VARCHAR(255) NOT NULL,
    payload TEXT NOT NULL,
    attempts SMALLINT NOT NULL,
    reserved_at INTEGER NULL,
    available_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX jobs_queue_index ON jobs (queue);

CREATE TABLE job_batches (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    total_jobs INTEGER NOT NULL,
    pending_jobs INTEGER NOT NULL,
    failed_jobs INTEGER NOT NULL,
    failed_job_ids TEXT NOT NULL,
    options TEXT NULL,
    cancelled_at INTEGER NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER NULL
);

CREATE TABLE failed_jobs (
    id BIGSERIAL PRIMARY KEY,
    uuid VARCHAR(255) NOT NULL,
    connection TEXT NOT NULL,
    queue TEXT NOT NULL,
    payload TEXT NOT NULL,
    exception TEXT NOT NULL,
    failed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX failed_jobs_uuid_unique ON failed_jobs (uuid);

-- ---- Sanctum tokens ----
CREATE TABLE personal_access_tokens (
    id BIGSERIAL PRIMARY KEY,
    tokenable_type VARCHAR(255) NOT NULL,
    tokenable_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    token VARCHAR(64) NOT NULL,
    abilities TEXT NULL,
    last_used_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX personal_access_tokens_token_unique ON personal_access_tokens (token);
CREATE INDEX personal_access_tokens_tokenable_type_tokenable_id_index ON personal_access_tokens (tokenable_type, tokenable_id);
CREATE INDEX personal_access_tokens_expires_at_index ON personal_access_tokens (expires_at);

-- ---- RBAC ----
CREATE TABLE roles (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX roles_name_unique ON roles (name);

CREATE TABLE role_user (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX role_user_user_id_role_id_unique ON role_user (user_id, role_id);

CREATE TABLE permissions (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX permissions_name_unique ON permissions (name);

CREATE TABLE permission_role (
    id BIGSERIAL PRIMARY KEY,
    permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX permission_role_permission_id_role_id_unique ON permission_role (permission_id, role_id);

-- ---- Businesses + geom ----
CREATE TABLE businesses (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    category VARCHAR(255) NULL,
    services JSONB NULL,
    description TEXT NULL,
    phone VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    address TEXT NULL,
    city VARCHAR(255) NULL,
    neighborhood VARCHAR(255) NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    social_links JSONB NULL,
    badges JSONB NULL,
    status VARCHAR(255) NOT NULL DEFAULT 'draft',
    moderation_note TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX businesses_slug_unique ON businesses (slug);
CREATE INDEX businesses_status_city_index ON businesses (status, city);

ALTER TABLE businesses ADD COLUMN geom geometry(Point, 4326);
CREATE INDEX businesses_geom_gist ON businesses USING GIST (geom);
UPDATE businesses SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL;
ALTER TABLE businesses ADD CONSTRAINT businesses_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE businesses ADD CONSTRAINT businesses_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

-- ---- Designers & Portfolios ----
CREATE TABLE designers (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(120) NOT NULL,
    slug VARCHAR(150) NOT NULL,
    bio TEXT NULL,
    phone VARCHAR(30) NULL,
    email VARCHAR(255) NULL,
    social_links JSONB NULL,
    status VARCHAR(255) NOT NULL DEFAULT 'pending',
    moderation_note TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX designers_user_id_unique ON designers (user_id);
CREATE UNIQUE INDEX designers_slug_unique ON designers (slug);
CREATE INDEX designers_status_display_name_index ON designers (status, display_name);

CREATE TABLE portfolios (
    id BIGSERIAL PRIMARY KEY,
    designer_id BIGINT NOT NULL REFERENCES designers(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    description TEXT NULL,
    file_path VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    status VARCHAR(255) NOT NULL DEFAULT 'pending',
    moderation_note TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE INDEX portfolios_designer_id_status_index ON portfolios (designer_id, status);

-- ---- Business cards ----
CREATE TABLE business_cards (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    template VARCHAR(40) NOT NULL DEFAULT 'classic',
    theme VARCHAR(40) NOT NULL DEFAULT 'navy',
    font_size VARCHAR(20) NOT NULL DEFAULT 'medium',
    export_format VARCHAR(10) NULL,
    exported_at TIMESTAMP NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX business_cards_business_id_template_unique ON business_cards (business_id, template);

-- ---- Plans & Subscriptions ----
CREATE TABLE plans (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price BIGINT NOT NULL DEFAULT 0,
    duration_days INTEGER NOT NULL DEFAULT 30,
    features JSONB NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);

CREATE TABLE subscriptions (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    plan_id BIGINT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status VARCHAR(255) NOT NULL DEFAULT 'pending_receipt',
    receipt_reference VARCHAR(160) NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    admin_note TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE INDEX subscriptions_business_id_status_end_date_index ON subscriptions (business_id, status, end_date);

-- ---- Showcases ----
CREATE TABLE showcases (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    description TEXT NULL,
    price BIGINT NULL,
    image_path VARCHAR(255) NULL,
    is_published BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE INDEX showcases_business_id_is_published_index ON showcases (business_id, is_published);

-- ---- Advertisements ----
CREATE TABLE advertisements (
    id BIGSERIAL PRIMARY KEY,
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    slot VARCHAR(60) NOT NULL,
    title VARCHAR(160) NOT NULL,
    target_url VARCHAR(500) NOT NULL,
    image_path VARCHAR(255) NULL,
    status VARCHAR(255) NOT NULL DEFAULT 'pending',
    starts_at DATE NULL,
    ends_at DATE NULL,
    admin_note TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE INDEX advertisements_slot_status_starts_at_ends_at_index ON advertisements (slot, status, starts_at, ends_at);

-- ---- CMS ----
CREATE TABLE site_settings (
    id BIGSERIAL PRIMARY KEY,
    key VARCHAR(255) NOT NULL,
    value TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX site_settings_key_unique ON site_settings (key);

CREATE TABLE page_contents (
    id BIGSERIAL PRIMARY KEY,
    slug VARCHAR(255) NOT NULL,
    title VARCHAR(255) NULL,
    content TEXT NULL,
    seo_title VARCHAR(255) NULL,
    seo_description TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX page_contents_slug_unique ON page_contents (slug);

CREATE TABLE articles (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(255) NOT NULL DEFAULT 'draft',
    cover_path VARCHAR(255) NULL,
    seo_title VARCHAR(255) NULL,
    seo_description TEXT NULL,
    og_title VARCHAR(255) NULL,
    og_description TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
CREATE UNIQUE INDEX articles_slug_unique ON articles (slug);

CREATE TABLE media (
    id BIGSERIAL PRIMARY KEY,
    path VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    file_size BIGINT NOT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL
);
