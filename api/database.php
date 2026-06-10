<?php

declare(strict_types=1);

function connectDatabase(): PDO
{
    $databaseUrl = getenv('DATABASE_URL') ?: '';
    if ($databaseUrl !== '') {
        return connectPostgres($databaseUrl);
    }

    return connectSqlite();
}

function databaseDriver(PDO $pdo): string
{
    return (string) $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
}

function connectPostgres(string $databaseUrl): PDO
{
    $parts = parse_url($databaseUrl);
    if ($parts === false || empty($parts['host']) || empty($parts['path'])) {
        throw new RuntimeException('A variável DATABASE_URL é inválida.');
    }

    $dsn = sprintf(
        'pgsql:host=%s;port=%d;dbname=%s;sslmode=require',
        $parts['host'],
        $parts['port'] ?? 5432,
        ltrim($parts['path'], '/')
    );

    return new PDO(
        $dsn,
        isset($parts['user']) ? urldecode($parts['user']) : '',
        isset($parts['pass']) ? urldecode($parts['pass']) : '',
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
}

function connectSqlite(): PDO
{
    $databasePath = dirname(__DIR__) . '/database/componentes.sqlite';
    $pdo = new PDO('sqlite:' . $databasePath, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS componentes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT NOT NULL UNIQUE,
            descricao TEXT NOT NULL,
            atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_componentes_codigo ON componentes (codigo COLLATE NOCASE)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_componentes_descricao ON componentes (descricao COLLATE NOCASE)');

    return $pdo;
}
