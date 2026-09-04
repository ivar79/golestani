# Golestani API — Laravel 12 on PHP 8.3-FPM + Nginx (single container).
# Render assigns $PORT; we default nginx to 8080 and read PORT at start.
FROM php:8.3-fpm-alpine AS base

# System deps + PHP extensions required by Laravel 12 / PostGIS / QR-code.
RUN apk add --no-cache \
        nginx \
        postgresql-dev \
        libzip-dev \
        icu-dev \
        oniguruma-dev \
        libpng-dev \
        freetype-dev \
        libjpeg-turbo-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j$(nproc) \
        pdo_pgsql \
        opcache \
        gd \
        zip \
        intl \
        mbstring

# Production PHP defaults (opcache on, sensible limits)
RUN { \
      echo "opcache.enable=1"; \
      echo "opcache.validate_timestamps=0"; \
      echo "opcache.jit=tracing"; \
      echo "opcache.jit_buffer_size=64M"; \
      echo "memory_limit=256M"; \
      echo "post_max_size=20M"; \
      echo "upload_max_filesize=20M"; \
      echo "expose_php=0"; \
    } > /usr/local/etc/php/conf.d/zz-prod.ini

WORKDIR /var/www/html

# Copy composer manifests first for layer caching
COPY composer.json composer.lock ./

# Install composer from the official image (no composer in fpm-alpine base)
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
RUN composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader --no-scripts

# Application source
COPY . .
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh \
    && mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache \
    && composer dump-autoload --optimize

# Render/health env
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

CMD ["/usr/local/bin/start.sh"]
