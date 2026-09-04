#!/bin/sh
set -e

# Render (and most PaaS) assign the listen port via $PORT.
PORT="${PORT:-8080}"
export PORT

# Point nginx at the assigned port.
sed -i "s/listen 8080;/listen ${PORT};/" /etc/nginx/http.d/default.conf

# First boot: cache config/routes (APP_KEY etc. come from env).
php artisan config:cache || true
php artisan route:cache || true
php artisan view:cache || true

# Writable storage/bootstrap dirs (fresh volume or new clone).
mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
chown -R www-data:www-data storage bootstrap/cache || true

# Start PHP-FPM in background, then exec nginx as PID 1 (proper signal handling).
php-fpm -D
exec nginx -g 'daemon off;'
