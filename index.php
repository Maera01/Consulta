<?php

declare(strict_types=1);

require_once __DIR__ . '/api/auth.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['logout'])) {
    logoutUser();
    header('Location: ' . appRootPath());
    exit;
}

if (authenticatedUser() !== null) {
    header('Location: ' . appRootPath() . 'frontend/');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        if (attemptLogin((string) ($_POST['login'] ?? ''), (string) ($_POST['senha'] ?? ''))) {
            header('Location: ' . appRootPath() . 'frontend/');
            exit;
        }
        usleep(400000);
        $error = 'Login ou senha inválidos.';
    } catch (Throwable $exception) {
        $error = 'Não foi possível acessar o banco de usuários.';
    }
}
?>
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Maera | Acesso restrito</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./frontend/css/app.css">
  <link rel="stylesheet" href="./frontend/css/login.css">
</head>
<body class="login-page">
  <main class="login-card">
    <img src="./frontend/img/logo_header.png" alt="Maera">
    <h1>Acesso restrito</h1>
    <p>Entre com seu primeiro nome e senha.</p>

    <form method="post" autocomplete="on">
      <label>
        <span>Login</span>
        <input name="login" placeholder="Ex.: lucas" autocomplete="username" required autofocus>
      </label>
      <label>
        <span>Senha</span>
        <input name="senha" type="password" placeholder="Digite a senha" autocomplete="current-password" required>
      </label>
      <?php if ($error !== ''): ?>
        <div class="login-error" role="alert"><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></div>
      <?php endif; ?>
      <button class="button button-primary" type="submit">Entrar</button>
    </form>
  </main>
</body>
</html>
