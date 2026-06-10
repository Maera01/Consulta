<?php

declare(strict_types=1);

require_once __DIR__ . '/database.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Método não permitido.'], JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $pdo = connectDatabase();
    $postgres = databaseDriver($pdo) === 'pgsql';
    $allowedSorts = ['codigo', 'descricao'];
    $sort = in_array($_GET['sort'] ?? '', $allowedSorts, true) ? $_GET['sort'] : 'descricao';
    $direction = ($_GET['direction'] ?? '') === 'desc' ? 'DESC' : 'ASC';
    $limit = min(max((int) ($_GET['limit'] ?? 50), 1), 100);
    $offset = max((int) ($_GET['offset'] ?? 0), 0);

    $conditions = [];
    $parameters = [];
    foreach (['codigo', 'descricao'] as $column) {
        $value = trim((string) ($_GET[$column] ?? ''));
        if ($value === '') {
            continue;
        }
        foreach (preg_split('/\s+/', $value) as $index => $word) {
            $key = ':' . $column . $index;
            $conditions[] = $postgres
                ? "{$column} ILIKE {$key}"
                : "{$column} LIKE {$key} COLLATE NOCASE";
            $parameters[$key] = '%' . $word . '%';
        }
    }

    $where = $conditions ? ' WHERE ' . implode(' AND ', $conditions) : '';
    $count = $pdo->prepare('SELECT COUNT(*) FROM componentes' . $where);
    $count->execute($parameters);
    $total = (int) $count->fetchColumn();

    $query = $pdo->prepare(
        "SELECT id, codigo, descricao
         FROM componentes{$where}
         ORDER BY {$sort} {$direction}, id ASC
         LIMIT :limit OFFSET :offset"
    );
    foreach ($parameters as $key => $value) {
        $query->bindValue($key, $value);
    }
    $query->bindValue(':limit', $limit, PDO::PARAM_INT);
    $query->bindValue(':offset', $offset, PDO::PARAM_INT);
    $query->execute();

    echo json_encode([
        'items' => $query->fetchAll(),
        'total' => $total,
        'database' => $postgres ? 'neon' : 'local',
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['error' => 'Não foi possível consultar o banco de dados.'], JSON_UNESCAPED_UNICODE);
}
