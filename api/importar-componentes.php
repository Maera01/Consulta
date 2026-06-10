<?php

declare(strict_types=1);

require_once __DIR__ . '/database.php';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ROWS = 20000;
const IMPORT_PASSWORD_HASH = '$2y$10$7szlbb6EdCQoYBvdvumW6emS/Nu4ijtqncg6w.e/xNO1jUMMXGvt6';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['error' => 'Método não permitido.']);
}

try {
    validateImportPassword();

    if (!isset($_FILES['planilha']) || !is_array($_FILES['planilha'])) {
        throw new RuntimeException('Selecione uma planilha para importar.');
    }

    $file = $_FILES['planilha'];
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new RuntimeException(uploadErrorMessage((int) $file['error']));
    }
    if ((int) $file['size'] > MAX_FILE_SIZE) {
        throw new RuntimeException('A planilha deve ter no máximo 10 MB.');
    }

    $extension = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
    $rows = match ($extension) {
        'csv' => readCsv((string) $file['tmp_name']),
        'xls' => readXmlSpreadsheet((string) $file['tmp_name']),
        'xlsx' => readXlsx((string) $file['tmp_name']),
        default => throw new RuntimeException('Formato inválido. Envie um arquivo .xls, .xlsx ou .csv.'),
    };

    if (count($rows) < 2) {
        throw new RuntimeException('A planilha não contém dados para importar.');
    }

    $components = mapComponents($rows);
    $pdo = connectDatabase();
    $pdo->beginTransaction();

    $existingCodes = existingCodes($pdo, array_column($components, 'codigo'));
    $upsert = $pdo->prepare(
        databaseDriver($pdo) === 'pgsql'
            ? 'INSERT INTO componentes (codigo, descricao)
               VALUES (:codigo, :descricao)
               ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao'
            : 'INSERT INTO componentes (codigo, descricao, atualizado_em)
               VALUES (:codigo, :descricao, CURRENT_TIMESTAMP)
               ON CONFLICT (codigo) DO UPDATE SET
                   descricao = excluded.descricao,
                   atualizado_em = CURRENT_TIMESTAMP'
    );

    $inserted = 0;
    $updated = 0;
    foreach ($components as $component) {
        $upsert->execute($component);
        if (isset($existingCodes[$component['codigo']])) {
            $updated++;
        } else {
            $inserted++;
        }
    }

    $pdo->commit();
    respond(200, [
        'message' => 'Planilha importada com sucesso.',
        'processed' => count($components),
        'inserted' => $inserted,
        'updated' => $updated,
    ]);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    respond($error instanceof RuntimeException ? 400 : 500, [
        'error' => $error instanceof RuntimeException
            ? $error->getMessage()
            : 'Não foi possível importar a planilha no banco de dados.',
    ]);
}

function validateImportPassword(): void
{
    $password = (string) ($_POST['senha'] ?? '');
    if (!password_verify($password, IMPORT_PASSWORD_HASH)) {
        throw new RuntimeException('Senha de importação inválida.');
    }
}

function existingCodes(PDO $pdo, array $codes): array
{
    $existing = [];
    foreach (array_chunk($codes, 500) as $chunk) {
        $placeholders = implode(',', array_fill(0, count($chunk), '?'));
        $query = $pdo->prepare("SELECT codigo FROM componentes WHERE codigo IN ({$placeholders})");
        $query->execute(array_values($chunk));
        foreach ($query->fetchAll(PDO::FETCH_COLUMN) as $code) {
            $existing[(string) $code] = true;
        }
    }
    return $existing;
}

function mapComponents(array $rows): array
{
    [$headerRow, $indexes] = findHeaderRow($rows);
    $rows = array_slice($rows, $headerRow + 1);

    foreach (['codigo', 'descricao'] as $required) {
        if (!array_key_exists($required, $indexes)) {
            throw new RuntimeException("A planilha precisa conter a coluna '{$required}'.");
        }
    }

    $components = [];
    foreach ($rows as $rowNumber => $row) {
        $codigo = trim((string) ($row[$indexes['codigo']] ?? ''));
        $descricao = trim((string) ($row[$indexes['descricao']] ?? ''));

        if ($codigo === '' && $descricao === '') {
            continue;
        }
        if ($codigo === '' || $descricao === '') {
            continue;
        }

        // O último registro de um código repetido na planilha prevalece.
        $components[$codigo] = compact('codigo', 'descricao');
        if (count($components) > MAX_ROWS) {
            throw new RuntimeException('A planilha excede o limite de 20.000 componentes.');
        }
    }

    if (!$components) {
        throw new RuntimeException('A planilha não contém componentes válidos.');
    }
    return array_values($components);
}

function findHeaderRow(array $rows): array
{
    $aliases = [
        'codigo' => ['codigo' => 3, 'prod' => 3, 'cod_produto' => 1],
        'descricao' => ['descricao' => 3, 'descric_ao' => 3, 'desc_produto' => 1],
    ];

    $bestMatch = null;
    $bestScore = -1;
    foreach ($rows as $rowNumber => $row) {
        $normalized = array_map('normalizeHeader', $row);
        $indexes = [];
        $score = 0;
        foreach ($aliases as $field => $names) {
            foreach ($normalized as $index => $header) {
                if (isset($names[$header])) {
                    $indexes[$field] = $index;
                    $score += $names[$header];
                    break;
                }
            }
        }
        if (count($indexes) === count($aliases) && $score > $bestScore) {
            $bestMatch = [$rowNumber, $indexes];
            $bestScore = $score;
        }
    }

    if ($bestMatch !== null) {
        return $bestMatch;
    }

    throw new RuntimeException('Não foi possível localizar as colunas de código e descrição na planilha.');
}

function normalizeHeader(mixed $value): string
{
    $value = trim(mb_strtolower((string) $value, 'UTF-8'));
    $ascii = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $value);
    $normalized = preg_replace('/[^a-z0-9]+/', '_', $ascii !== false ? $ascii : $value) ?? '';
    return trim($normalized, '_');
}

function readCsv(string $path): array
{
    $handle = fopen($path, 'rb');
    if ($handle === false) {
        throw new RuntimeException('Não foi possível ler o arquivo CSV.');
    }

    $firstLine = fgets($handle);
    if ($firstLine === false) {
        fclose($handle);
        return [];
    }
    $delimiter = detectDelimiter($firstLine);
    rewind($handle);

    $rows = [];
    while (($row = fgetcsv($handle, 0, $delimiter)) !== false) {
        $rows[] = array_map(static function ($value): string {
            $value = (string) $value;
            if (!mb_check_encoding($value, 'UTF-8')) {
                $value = mb_convert_encoding($value, 'UTF-8', 'Windows-1252');
            }
            return ltrim($value, "\xEF\xBB\xBF");
        }, $row);
    }
    fclose($handle);
    return $rows;
}

function detectDelimiter(string $line): string
{
    $counts = [];
    foreach ([',', ';', "\t"] as $delimiter) {
        $counts[$delimiter] = substr_count($line, $delimiter);
    }
    arsort($counts);
    return (string) array_key_first($counts);
}

function readXmlSpreadsheet(string $path): array
{
    $content = file_get_contents($path);
    if ($content === false || !str_contains($content, 'urn:schemas-microsoft-com:office:spreadsheet')) {
        throw new RuntimeException('O arquivo .xls não está no formato XML Spreadsheet esperado.');
    }

    $document = new DOMDocument();
    if (!$document->loadXML($content, LIBXML_NONET | LIBXML_COMPACT)) {
        throw new RuntimeException('Não foi possível ler o arquivo .xls.');
    }

    $xpath = new DOMXPath($document);
    $xpath->registerNamespace('ss', 'urn:schemas-microsoft-com:office:spreadsheet');
    $xmlRows = $xpath->query('//ss:Worksheet[1]/ss:Table/ss:Row');
    if ($xmlRows === false) {
        throw new RuntimeException('A primeira aba do arquivo .xls não pôde ser lida.');
    }

    $rows = [];
    foreach ($xmlRows as $xmlRow) {
        $row = [];
        $column = 0;
        foreach ($xpath->query('./ss:Cell', $xmlRow) ?: [] as $cell) {
            $index = $cell->getAttributeNS('urn:schemas-microsoft-com:office:spreadsheet', 'Index');
            if ($index !== '') {
                $column = (int) $index - 1;
            }
            $data = $xpath->query('./ss:Data', $cell)?->item(0);
            $row[$column] = $data?->textContent ?? '';
            $column++;
        }
        if ($row) {
            $rows[] = array_replace(array_fill(0, max(array_keys($row)) + 1, ''), $row);
        }
    }
    return $rows;
}

function readXlsx(string $path): array
{
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('Ative a extensão PHP zip para importar arquivos .xlsx.');
    }

    $zip = new ZipArchive();
    if ($zip->open($path) !== true) {
        throw new RuntimeException('Não foi possível abrir o arquivo .xlsx.');
    }

    try {
        $sharedStrings = readSharedStrings($zip);
        $sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
        if ($sheetXml === false) {
            throw new RuntimeException('A primeira aba da planilha não pôde ser lida.');
        }
        $sheet = simplexml_load_string($sheetXml, SimpleXMLElement::class, LIBXML_NONET);
        if ($sheet === false) {
            throw new RuntimeException('O conteúdo da planilha é inválido.');
        }

        $rows = [];
        foreach ($sheet->sheetData->row as $xmlRow) {
            $row = [];
            foreach ($xmlRow->c as $cell) {
                $reference = (string) $cell['r'];
                $column = columnIndex($reference);
                $type = (string) $cell['t'];
                if ($type === 'inlineStr') {
                    $value = (string) $cell->is->t;
                } else {
                    $value = (string) $cell->v;
                    if ($type === 's') {
                        $value = $sharedStrings[(int) $value] ?? '';
                    }
                }
                $row[$column] = $value;
            }
            if ($row) {
                $maxColumn = max(array_keys($row));
                $rows[] = array_replace(array_fill(0, $maxColumn + 1, ''), $row);
            }
        }
        return $rows;
    } finally {
        $zip->close();
    }
}

function readSharedStrings(ZipArchive $zip): array
{
    $xml = $zip->getFromName('xl/sharedStrings.xml');
    if ($xml === false) {
        return [];
    }
    $document = simplexml_load_string($xml, SimpleXMLElement::class, LIBXML_NONET);
    if ($document === false) {
        return [];
    }

    $strings = [];
    foreach ($document->si as $item) {
        if (isset($item->t)) {
            $strings[] = (string) $item->t;
            continue;
        }
        $text = '';
        foreach ($item->r as $run) {
            $text .= (string) $run->t;
        }
        $strings[] = $text;
    }
    return $strings;
}

function columnIndex(string $reference): int
{
    preg_match('/^[A-Z]+/i', $reference, $matches);
    $letters = strtoupper($matches[0] ?? 'A');
    $index = 0;
    for ($i = 0, $length = strlen($letters); $i < $length; $i++) {
        $index = $index * 26 + ord($letters[$i]) - 64;
    }
    return $index - 1;
}

function uploadErrorMessage(int $error): string
{
    return match ($error) {
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'A planilha excede o tamanho permitido pelo servidor.',
        UPLOAD_ERR_NO_FILE => 'Selecione uma planilha para importar.',
        default => 'Falha ao receber a planilha.',
    };
}

function respond(int $status, array $data): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
