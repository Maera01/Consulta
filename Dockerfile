FROM php:8.3-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev libzip-dev \
    && docker-php-ext-install pdo_pgsql zip \
    && rm -rf /var/lib/apt/lists/* \
    && php -r "foreach (['dom', 'mbstring', 'pdo_pgsql', 'pdo_sqlite', 'SimpleXML', 'zip'] as \$extension) { if (!extension_loaded(\$extension)) { exit(1); } }"

COPY . /var/www/html
COPY docker/uploads.ini /usr/local/etc/php/conf.d/uploads.ini

RUN mkdir -p /var/www/html/database \
    && chown -R www-data:www-data /var/www/html/database

EXPOSE 80
