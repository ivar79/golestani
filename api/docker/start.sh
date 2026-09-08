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
php artisan storage:link
php artisan route:cache
php artisan view:cache
php-fpm -D
exec nginx -g 'daemon off;'
