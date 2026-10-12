#!/bin/sh
set -e
PORT="${PORT:-8080}"
case "$PORT" in *[!0-9]*|'') echo "Invalid PORT" >&2; exit 1;; esac
sed -i "s/listen 8080;/listen ${PORT};/" /etc/nginx/http.d/default.conf
mkdir -p storage/app/public storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
chown -R www-data:www-data storage bootstrap/cache
php artisan config:cache
# Fail loudly instead of starting the app with a half-migrated database.
php artisan migrate --force
# SUBSCRIPTION EXPIRY ON BOOT (Phase 5 finding A): the free Render plan runs no
# process for Laravel's scheduler (and Render Cron Jobs are paid), so every
# deploy/restart settles past-due subscriptions here as well. The sweep is
# idempotent — SubscriptionLifecycle::markExpired() locks the row, re-reads its
# status and creates the owner notification with firstOrCreate — so a boot-time
# run can never double-expire a row or duplicate a notification, and the lazy
# path in FeatureGate enforces expiry on read regardless. A failure here must
# therefore never block the boot.
php artisan subscriptions:expire || echo 'subscriptions:expire failed (non-fatal: expiry is also enforced lazily on every read)'
php artisan storage:link
php artisan route:cache
php artisan view:cache
php-fpm -D
exec nginx -g 'daemon off;'
