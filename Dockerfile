FROM php:8.3-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libonig-dev libxml2-dev libzip-dev \
    && docker-php-ext-install dom mbstring pdo_sqlite simplexml zip \
    && rm -rf /var/lib/apt/lists/*

COPY . /var/www/html
COPY docker/uploads.ini /usr/local/etc/php/conf.d/uploads.ini

RUN mkdir -p /var/www/html/database \
    && chown -R www-data:www-data /var/www/html/database

EXPOSE 80
