<?php

declare(strict_types=1);

require_once __DIR__ . '/database.php';

function startAppSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }

    session_name('consulta_componentes_session');
    $secure = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function authenticatedUser(): ?array
{
    startAppSession();
    if (empty($_SESSION['usuario_id']) || empty($_SESSION['usuario_login'])) {
        return null;
    }

    return [
        'id' => $_SESSION['usuario_id'],
        'login' => $_SESSION['usuario_login'],
    ];
}

function attemptLogin(string $login, string $password): bool
{
    $login = normalizeLogin($login);
    if ($login === '' || $password === '') {
        return false;
    }

    $pdo = connectDatabase();
    $query = $pdo->prepare(
        'SELECT id, login, senha_hash
         FROM usuarios
         WHERE login = :login AND ativo = TRUE
         LIMIT 1'
    );
    $query->execute(['login' => $login]);
    $user = $query->fetch();

    if (!$user || !password_verify($password, $user['senha_hash'])) {
        return false;
    }

    startAppSession();
    session_regenerate_id(true);
    $_SESSION['usuario_id'] = $user['id'];
    $_SESSION['usuario_login'] = $user['login'];
    return true;
}

function logoutUser(): void
{
    startAppSession();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $params['path'], '', $params['secure'], $params['httponly']);
    }
    session_destroy();
}

function requireAuthenticatedPage(): array
{
    $user = authenticatedUser();
    if ($user === null) {
        header('Location: ' . appRootPath());
        exit;
    }
    return $user;
}

function requireAuthenticatedApi(): array
{
    $user = authenticatedUser();
    if ($user === null) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Sessão expirada. Entre novamente.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    return $user;
}

function appRootPath(): string
{
    $script = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/'));
    $script = preg_replace('#/+#', '/', $script) ?? '/';
    foreach (['/frontend/', '/api/'] as $segment) {
        $position = strpos($script, $segment);
        if ($position !== false) {
            return substr($script, 0, $position + 1);
        }
    }
    $directory = str_replace('\\', '/', dirname($script));
    if ($directory === '/' || $directory === '.') {
        return '/';
    }
    return '/' . trim($directory, '/') . '/';
}

function normalizeLogin(string $login): string
{
    $login = mb_strtolower(trim($login), 'UTF-8');
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $login);
    return preg_replace('/[^a-z0-9]/', '', $ascii !== false ? $ascii : $login) ?? '';
}
