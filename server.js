const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");
const JSZip = require("jszip");
const { XMLParser } = require("fast-xml-parser");
const { TextDecoder } = require("util");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ROWS = 20000;
const IMPORT_PASSWORD_HASH = "$2y$10$7szlbb6EdCQoYBvdvumW6emS/Nu4ijtqncg6w.e/xNO1jUMMXGvt6";
const ROOT_DIR = __dirname;
const DATABASE_PATH = path.join(ROOT_DIR, "database", "componentes.sqlite");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

let SQL;
let sqliteDb;
let pgPool;

app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
  name: "consulta_componentes_session",
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
}));

app.get("/api/health", (_request, response) => {
  response.set("Access-Control-Allow-Origin", "*");
  response.json({ status: "ok", service: "consulta-componentes" });
});

app.get("/api/me", (request, response) => {
  const user = authenticatedUser(request);
  response.json({ authenticated: Boolean(user), user });
});

app.post("/api/login", async (request, response) => {
  try {
    const login = normalizeLogin(String(request.body.login || ""));
    const password = String(request.body.senha || "");
    if (!login || !password) {
      return response.status(401).json({ error: "Login ou senha inválidos." });
    }

    const user = await findActiveUser(login);
    if (!user || !bcrypt.compareSync(password, normalizeBcryptHash(user.senha_hash))) {
      await wait(400);
      return response.status(401).json({ error: "Login ou senha inválidos." });
    }

    request.session.regenerate((error) => {
      if (error) return response.status(500).json({ error: "Não foi possível iniciar a sessão." });
      request.session.usuario_id = user.id;
      request.session.usuario_login = user.login;
      response.json({ ok: true, user: { id: user.id, login: user.login } });
    });
  } catch {
    response.status(500).json({ error: "Não foi possível acessar o banco de usuários." });
  }
});

app.post("/api/logout", (request, response) => {
  request.session.destroy(() => {
    response.clearCookie("consulta_componentes_session");
    response.json({ ok: true });
  });
});

app.get("/api/componentes", requireAuthenticatedApi, async (request, response) => {
  try {
    const allowedSorts = new Set(["codigo", "descricao", "status", "status_cadastro"]);
    const sort = allowedSorts.has(String(request.query.sort || "")) ? String(request.query.sort) : "descricao";
    const direction = String(request.query.direction || "") === "desc" ? "DESC" : "ASC";
    const limit = Math.min(Math.max(Number.parseInt(String(request.query.limit || "50"), 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(String(request.query.offset || "0"), 10) || 0, 0);
    const filters = {
      codigo: String(request.query.codigo || "").trim(),
      descricao: String(request.query.descricao || "").trim(),
      status: normalizeStatus(request.query.status),
    };

    const result = await listComponents({ filters, sort, direction, limit, offset });
    response.json(result);
  } catch {
    response.status(500).json({ error: "Não foi possível consultar o banco de dados." });
  }
});

app.post("/api/importar-componentes", requireAuthenticatedApi, upload.single("planilha"), async (request, response) => {
  try {
    const password = String(request.body.senha || "");
    if (!bcrypt.compareSync(password, normalizeBcryptHash(IMPORT_PASSWORD_HASH))) {
      return response.status(400).json({ error: "Senha de importação inválida." });
    }
    if (!request.file) {
      return response.status(400).json({ error: "Selecione uma planilha para importar." });
    }

    const rows = await readSpreadsheet(request.file);
    if (rows.length < 2) {
      return response.status(400).json({ error: "A planilha não contém dados para importar." });
    }

    const components = mapComponents(rows);
    const existingCodes = await existingComponentCodes(components.map((item) => item.codigo));
    const totalBeforeImport = await countComponents();
    await syncStockComponents(components);

    let inserted = 0;
    let updated = 0;
    for (const component of components) {
      if (existingCodes.has(component.codigo)) updated += 1;
      else inserted += 1;
    }
    const unavailable = Math.max(totalBeforeImport - updated, 0);

    response.json({
      message: "Estoque atualizado com sucesso.",
      processed: components.length,
      inserted,
      updated,
      available: components.length,
      unavailable,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível importar a planilha no banco de dados.";
    response.status(message.startsWith("Não foi possível importar") ? 500 : 400).json({ error: message });
  }
});

app.use("/frontend", express.static(path.join(ROOT_DIR, "frontend"), { extensions: ["html"] }));
app.use(express.static(ROOT_DIR, { extensions: ["html"] }));

app.use((request, response) => {
  if (request.path.startsWith("/frontend")) {
    return response.sendFile(path.join(ROOT_DIR, "frontend", "index.html"));
  }
  response.sendFile(path.join(ROOT_DIR, "index.html"));
});

async function start() {
  if (process.env.DATABASE_URL) {
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await createPostgresSchema();
  } else {
    SQL = await initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
    fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
    sqliteDb = fs.existsSync(DATABASE_PATH)
      ? new SQL.Database(fs.readFileSync(DATABASE_PATH))
      : new SQL.Database();
    createSqliteSchema();
    persistSqlite();
  }

  app.listen(PORT, () => {
    console.log(`Consulta de componentes rodando em http://localhost:${PORT}`);
  });
}

function authenticatedUser(request) {
  if (!request.session?.usuario_id || !request.session?.usuario_login) return null;
  return { id: request.session.usuario_id, login: request.session.usuario_login };
}

function requireAuthenticatedApi(request, response, next) {
  if (!authenticatedUser(request)) {
    return response.status(401).json({ error: "Sessão expirada. Entre novamente." });
  }
  next();
}

async function findActiveUser(login) {
  if (pgPool) {
    const result = await pgPool.query(
      "SELECT id, login, senha_hash FROM usuarios WHERE login = $1 AND ativo = TRUE LIMIT 1",
      [login],
    );
    return result.rows[0] || null;
  }
  const rows = sqliteAll(
    "SELECT id, login, senha_hash FROM usuarios WHERE login = ? AND ativo = 1 LIMIT 1",
    [login],
  );
  return rows[0] || null;
}

async function listComponents({ filters, sort, direction, limit, offset }) {
  const items = pgPool ? await listAllComponentsPostgres() : listAllComponentsSqlite();
  const filtered = filterComponents(items, filters);
  filtered.sort((a, b) => compareComponents(a, b, sort, direction));
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    database: pgPool ? "neon" : "local",
  };
}

async function listAllComponentsPostgres() {
  const result = await pgPool.query("SELECT id, codigo, descricao, status, status_cadastro FROM componentes");
  return result.rows;
}

function listAllComponentsSqlite() {
  return sqliteAll("SELECT id, codigo, descricao, status, status_cadastro FROM componentes");
}

function filterComponents(items, filters) {
  const normalizedFilters = Object.fromEntries(
    Object.entries(filters).map(([column, value]) => [column, normalizeSearchText(value).split(/\s+/).filter(Boolean)]),
  );
  return items.filter((item) => {
    if (filters.status && item.status !== filters.status) return false;
    for (const column of ["codigo", "descricao"]) {
      const words = normalizedFilters[column];
      if (!words.length) continue;
      const haystack = normalizeSearchText(item[column]);
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  });
}

function compareComponents(a, b, sort, direction) {
  const multiplier = direction === "DESC" ? -1 : 1;
  const left = normalizeSearchText(a[sort]);
  const right = normalizeSearchText(b[sort]);
  const comparison = left.localeCompare(right, "pt-BR", { numeric: true });
  if (comparison !== 0) return comparison * multiplier;
  return Number(a.id) - Number(b.id);
}

async function countComponents() {
  if (pgPool) {
    const result = await pgPool.query("SELECT COUNT(*)::int AS total FROM componentes");
    return result.rows[0].total;
  }
  return sqliteGet("SELECT COUNT(*) AS total FROM componentes")?.total || 0;
}

async function existingComponentCodes(codes) {
  const existing = new Set();
  for (const chunk of chunks(codes, 500)) {
    if (pgPool) {
      const placeholders = chunk.map((_, index) => `$${index + 1}`).join(",");
      const result = await pgPool.query(`SELECT codigo FROM componentes WHERE codigo IN (${placeholders})`, chunk);
      result.rows.forEach((row) => existing.add(String(row.codigo)));
    } else {
      const placeholders = chunk.map(() => "?").join(",");
      sqliteAll(`SELECT codigo FROM componentes WHERE codigo IN (${placeholders})`, chunk)
        .forEach((row) => existing.add(String(row.codigo)));
    }
  }
  return existing;
}

async function syncStockComponents(components) {
  if (pgPool) {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE componentes SET status = 'indisponivel'");
      for (const batch of chunks(components, 300)) {
        const values = [];
        const params = [];
        batch.forEach((component, index) => {
          params.push(component.codigo, component.descricao, component.status_cadastro);
          values.push(`($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3}, 'disponivel', NOW())`);
        });
        await client.query(
          `INSERT INTO componentes (codigo, descricao, status_cadastro, status, estoque_atualizado_em) VALUES ${values.join(", ")}
           ON CONFLICT (codigo) DO UPDATE SET
             descricao = excluded.descricao,
             status_cadastro = COALESCE(excluded.status_cadastro, componentes.status_cadastro),
             status = 'disponivel',
             estoque_atualizado_em = NOW()`,
          params,
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  sqliteDb.run("BEGIN TRANSACTION");
  try {
    sqliteDb.run("UPDATE componentes SET status = 'indisponivel'");
    const statement = sqliteDb.prepare(
      `INSERT INTO componentes (codigo, descricao, status_cadastro, status, estoque_atualizado_em) VALUES (?, ?, ?, 'disponivel', CURRENT_TIMESTAMP)
       ON CONFLICT (codigo) DO UPDATE SET
         descricao = excluded.descricao,
         status_cadastro = COALESCE(excluded.status_cadastro, status_cadastro),
         status = 'disponivel',
         estoque_atualizado_em = CURRENT_TIMESTAMP,
         atualizado_em = CURRENT_TIMESTAMP`,
    );
    for (const component of components) {
      statement.run([component.codigo, component.descricao, component.status_cadastro]);
    }
    statement.free();
    sqliteDb.run("COMMIT");
    persistSqlite();
  } catch (error) {
    sqliteDb.run("ROLLBACK");
    throw error;
  }
}

async function readSpreadsheet(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  if (extension === ".csv") {
    return readCsv(file.buffer);
  }
  if (extension === ".xls") {
    return readXmlSpreadsheet(file.buffer);
  }
  if (extension === ".xlsx") {
    return readXlsx(file.buffer);
  }
  throw new Error("Formato inválido. Envie um arquivo .xls, .xlsx ou .csv.");
}

function readCsv(buffer) {
  const text = decodeText(buffer).replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const delimiter = detectDelimiter(firstLine);
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value !== "" || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function detectDelimiter(line) {
  return [",", ";", "\t"]
    .map((delimiter) => [delimiter, line.split(delimiter).length - 1])
    .sort((a, b) => b[1] - a[1])[0][0];
}

function readXmlSpreadsheet(buffer) {
  const content = decodeText(buffer);
  if (!content.includes("urn:schemas-microsoft-com:office:spreadsheet")) {
    throw new Error("O arquivo .xls não está no formato XML Spreadsheet esperado.");
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", textNodeName: "#text" });
  const document = parser.parse(content);
  const workbook = document.Workbook || document["ss:Workbook"];
  const worksheet = asArray(workbook?.Worksheet || workbook?.["ss:Worksheet"])[0];
  const table = worksheet?.Table || worksheet?.["ss:Table"];
  const xmlRows = asArray(table?.Row || table?.["ss:Row"]);

  return xmlRows.map((xmlRow) => {
    const row = [];
    let column = 0;
    for (const cell of asArray(xmlRow.Cell || xmlRow["ss:Cell"])) {
      const explicitIndex = Number(cell["ss:Index"] || cell.Index || 0);
      if (explicitIndex > 0) column = explicitIndex - 1;
      const data = cell.Data || cell["ss:Data"];
      row[column] = cellText(data);
      column += 1;
    }
    return fillSparseRow(row);
  }).filter((row) => row.length);
}

async function readXlsx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStrings = await readSharedStrings(zip);
  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  if (!sheetFile) {
    throw new Error("A primeira aba da planilha não pôde ser lida.");
  }

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", textNodeName: "#text" });
  const sheet = parser.parse(await sheetFile.async("text"));
  const xmlRows = asArray(sheet.worksheet?.sheetData?.row);

  return xmlRows.map((xmlRow) => {
    const row = [];
    for (const cell of asArray(xmlRow.c)) {
      const column = columnIndex(String(cell.r || "A"));
      const type = String(cell.t || "");
      let value = "";
      if (type === "inlineStr") {
        value = cellText(cell.is?.t);
      } else {
        value = cellText(cell.v);
        if (type === "s") value = sharedStrings[Number(value)] || "";
      }
      row[column] = value;
    }
    return fillSparseRow(row);
  }).filter((row) => row.length);
}

async function readSharedStrings(zip) {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", textNodeName: "#text" });
  const document = parser.parse(await file.async("text"));
  return asArray(document.sst?.si).map((item) => {
    if (item.t !== undefined) return cellText(item.t);
    return asArray(item.r).map((run) => cellText(run.t)).join("");
  });
}

function cellText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && value["#text"] !== undefined) return String(value["#text"]);
  return String(value);
}

function fillSparseRow(row) {
  if (!row.length) return [];
  return Array.from({ length: row.length }, (_, index) => row[index] || "");
}

function columnIndex(reference) {
  const letters = (reference.match(/^[A-Z]+/i)?.[0] || "A").toUpperCase();
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  return index - 1;
}

function decodeText(buffer) {
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  return utf8.includes("\uFFFD") ? new TextDecoder("windows-1252").decode(buffer) : utf8;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function mapComponents(rows) {
  const [, indexes, headerRow] = findHeaderRow(rows);
  const components = new Map();
  for (const row of rows.slice(headerRow + 1)) {
    const codigo = String(row[indexes.codigo] || "").trim();
    const descricao = String(row[indexes.descricao] || "").trim();
    const status_cadastro = indexes.status === undefined ? null : mapRegistrationStatus(row[indexes.status]);
    if (!codigo && !descricao) continue;
    if (!codigo || !descricao) continue;
    components.set(codigo, { codigo, descricao, status_cadastro });
    if (components.size > MAX_ROWS) {
      throw new Error("A planilha excede o limite de 20.000 componentes.");
    }
  }
  if (!components.size) {
    throw new Error("A planilha não contém componentes válidos.");
  }
  return [...components.values()];
}

function findHeaderRow(rows) {
  const aliases = {
    codigo: { codigo: 3, prod: 3, cod_produto: 1 },
    descricao: { descricao: 3, descric_ao: 3, desc_produto: 1 },
    status: { status: 1, situacao: 1, status_cadastro: 1 },
  };
  let best = null;
  let bestScore = -1;
  rows.forEach((row, rowNumber) => {
    const normalized = row.map(normalizeHeader);
    const indexes = {};
    let score = 0;
    for (const [field, names] of Object.entries(aliases)) {
      const index = normalized.findIndex((header) => names[header]);
      if (index >= 0) {
        indexes[field] = index;
        score += names[normalized[index]];
      }
    }
    if (indexes.codigo !== undefined && indexes.descricao !== undefined && score > bestScore) {
      best = [row, indexes, rowNumber];
      bestScore = score;
    }
  });
  if (!best) {
    throw new Error("Não foi possível localizar as colunas de código e descrição na planilha.");
  }
  return best;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeStatus(value) {
  const status = normalizeSearchText(value);
  return ["disponivel", "indisponivel"].includes(status) ? status : "";
}

function mapRegistrationStatus(value) {
  const status = normalizeSearchText(value);
  return ["obsoleto", "descontinuado"].includes(status) ? status : null;
}

function normalizeLogin(login) {
  return login
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeBcryptHash(hash) {
  return String(hash || "").replace(/^\$2y\$/, "$2b$");
}

function createSqliteSchema() {
  sqliteDb.run(`
    CREATE TABLE IF NOT EXISTS componentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      descricao TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'indisponivel',
      status_cadastro TEXT,
      estoque_atualizado_em TEXT,
      atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_componentes_codigo ON componentes (codigo COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_componentes_descricao ON componentes (descricao COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  addSqliteColumnIfMissing("componentes", "status", "TEXT NOT NULL DEFAULT 'indisponivel'");
  addSqliteColumnIfMissing("componentes", "status_cadastro", "TEXT");
  addSqliteColumnIfMissing("componentes", "estoque_atualizado_em", "TEXT");
  sqliteDb.run("UPDATE componentes SET status = 'indisponivel' WHERE status IS NULL OR status = ''");
}

async function createPostgresSchema() {
  await pgPool.query(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE TABLE IF NOT EXISTS componentes (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      descricao TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'indisponivel',
      status_cadastro TEXT,
      estoque_atualizado_em TIMESTAMPTZ,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT componentes_codigo_not_blank CHECK (BTRIM(codigo) <> ''),
      CONSTRAINT componentes_descricao_not_blank CHECK (BTRIM(descricao) <> '')
    );
    CREATE TABLE IF NOT EXISTS usuarios (
      id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT usuarios_login_lowercase CHECK (login = LOWER(login)),
      CONSTRAINT usuarios_login_not_blank CHECK (BTRIM(login) <> ''),
      CONSTRAINT usuarios_senha_hash_not_blank CHECK (BTRIM(senha_hash) <> '')
    );
    ALTER TABLE componentes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'indisponivel';
    ALTER TABLE componentes ADD COLUMN IF NOT EXISTS status_cadastro TEXT;
    ALTER TABLE componentes ADD COLUMN IF NOT EXISTS estoque_atualizado_em TIMESTAMPTZ;
    UPDATE componentes SET status = 'indisponivel' WHERE status IS NULL OR status = '';
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'componentes_status_check'
      ) THEN
        ALTER TABLE componentes
          ADD CONSTRAINT componentes_status_check CHECK (status IN ('disponivel', 'indisponivel'));
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'componentes_status_cadastro_check'
      ) THEN
        ALTER TABLE componentes
          ADD CONSTRAINT componentes_status_cadastro_check CHECK (status_cadastro IS NULL OR status_cadastro IN ('obsoleto', 'descontinuado'));
      END IF;
    END;
    $$;
    CREATE INDEX IF NOT EXISTS idx_componentes_codigo_trgm ON componentes USING GIN (codigo gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_componentes_descricao_trgm ON componentes USING GIN (descricao gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_componentes_status ON componentes (status);
    CREATE INDEX IF NOT EXISTS idx_componentes_status_cadastro ON componentes (status_cadastro);
  `);
}

function addSqliteColumnIfMissing(table, column, definition) {
  const exists = sqliteAll(`PRAGMA table_info(${table})`).some((item) => item.name === column);
  if (!exists) sqliteDb.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function sqliteAll(sql, params = []) {
  const statement = sqliteDb.prepare(sql);
  statement.bind(params);
  const rows = [];
  while (statement.step()) rows.push(statement.getAsObject());
  statement.free();
  return rows;
}

function sqliteGet(sql, params = []) {
  return sqliteAll(sql, params)[0] || null;
}

function persistSqlite() {
  fs.writeFileSync(DATABASE_PATH, Buffer.from(sqliteDb.export()));
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
