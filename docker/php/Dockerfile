FROM php:8.3-cli

# Install system dependencies required for Laravel and PHP extensions
RUN apt-get update && apt-get install -y \
    git \
    curl \
    libpng-dev \
    libjpeg-dev \
    libfreetype6-dev \
    libonig-dev \
    libxml2-dev \
    zip \
    unzip \
    libpq-dev \
    libicu-dev \
    && rm -rf /var/lib/apt/lists/*

# Install and configure PHP extensions
RUN docker-php-ext-configure intl \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install pdo_pgsql mbstring exif pcntl bcmath intl opcache gd

# Install Redis extension via PECL
RUN pecl install redis && docker-php-ext-enable redis

# Set working directory
WORKDIR /var/www/html

# Keep PHP source and dependencies on Docker's Linux filesystem. Accessing
# Laravel's many PHP files through a Windows bind mount makes every request
# block on slow cross-OS filesystem operations.
COPY api/ /var/www/html/
