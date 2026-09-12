# ==============================================================================
# Dockerfile for Martin Tile Server
# Architecture Reference: Opus 5 Blueprint (PMTiles + Martin + Next.js) - Sec 4.1
# ==============================================================================

FROM ghcr.io/maplibre/martin:latest

WORKDIR /app

# کپی فایل کانفیگ اختصاصی
COPY config.yaml /app/config.yaml

# ساخت پوشه‌های داده، فونت‌ها و اسپرایت‌ها
RUN mkdir -p /data/fonts /data/sprites

EXPOSE 3000

# نقطه ورود رسمی Martin با مشخص کردن صریح فایل کانفیگ
ENTRYPOINT ["martin", "--config", "/app/config.yaml"]
