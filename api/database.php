<?php

declare(strict_types=1);

function connectLocalDatabase(): PDO
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
