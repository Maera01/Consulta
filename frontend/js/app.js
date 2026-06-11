const PAGE_SIZE = 50;
const DATA_API_URL = window.APP_CONFIG?.COMPONENTS_API_URL || "../api/componentes.php";
const IMPORT_API_URL = window.APP_CONFIG?.IMPORT_API_URL || "../api/importar-componentes.php";

const state = {
  page: 1,
  pages: 1,
  sort: "descricao",
  direction: "asc",
  selected: new Map(),
};

const rows = document.querySelector("#component-rows");
const filters = document.querySelector("#filters");
const emptyState = document.querySelector("#empty-state");
const selectedList = document.querySelector("#selected-list");
const selectedCount = document.querySelector("#selected-count");
const copyButton = document.querySelector("#copy-request");
const clearSelectionButton = document.querySelector("#clear-selection");
const importForm = document.querySelector("#import-form");
const importButton = document.querySelector("#import-button");
let filterTimer;

async function loadComponents() {
  const params = new URLSearchParams({
    sort: state.sort,
    direction: state.direction,
    limit: PAGE_SIZE,
    offset: (state.page - 1) * PAGE_SIZE,
  });

  for (const [column, value] of new FormData(filters)) {
    if (String(value).trim()) params.set(column, String(value).trim());
  }

  try {
    const response = await fetch(`${DATA_API_URL}?${params}`);
    if (!response.ok) throw new Error(await readApiError(response));

    const result = await response.json();
    const items = result.items;
    const total = result.total;
    state.pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    document.querySelector("#total-components").textContent = total.toLocaleString("pt-BR");
    document.querySelector("#page-info").textContent = `Página ${state.page} de ${state.pages}`;
    document.querySelector("#previous-page").disabled = state.page <= 1;
    document.querySelector("#next-page").disabled = state.page >= state.pages;
    renderRows(items);
  } catch (error) {
    showToast(error.message || "Não foi possível consultar o banco de dados.");
  }
}

async function readApiError(response) {
  if (response.status === 401) {
    window.location.href = window.APP_CONFIG?.ROOT_URL || "/";
    return "Sessão expirada.";
  }
  try {
    const data = await response.json();
    return data.message || data.error || `Erro ${response.status} na requisição.`;
  } catch {
    return `Erro ${response.status} na requisição.`;
  }
}

function renderRows(items) {
  rows.replaceChildren();
  emptyState.hidden = items.length > 0;
  items.forEach((item) => {
    const tr = document.createElement("tr");
    const selected = state.selected.has(item.id);
    tr.className = selected ? "is-selected" : "";
    tr.innerHTML = `
      <td class="check-column"><input class="row-check" type="checkbox" ${selected ? "checked" : ""} aria-label="Selecionar componente"></td>
      <td class="code"></td><td></td>`;
    const cells = tr.querySelectorAll("td");
    cells[1].textContent = item.codigo;
    cells[2].textContent = item.descricao;
    tr.querySelector("input").addEventListener("change", (event) => toggleItem(item, event.target.checked));
    rows.append(tr);
  });
}

function toggleItem(item, selected) {
  selected ? state.selected.set(item.id, {...item, quantity: 1}) : state.selected.delete(item.id);
  renderSelection();
  loadComponents();
}

function renderSelection() {
  selectedList.replaceChildren();
  const items = [...state.selected.values()];
  selectedCount.textContent = items.length;
  copyButton.disabled = items.length === 0;
  clearSelectionButton.disabled = items.length === 0;
  if (!items.length) {
    selectedList.innerHTML = `<div class="selection-empty"><span>+</span><p>Selecione componentes na tabela para montar sua solicitação.</p></div>`;
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "selected-item";
    card.innerHTML = `<strong></strong><footer><label><span>Quantidade</span><input type="number" min="1" value="${item.quantity}"></label><button class="remove-item">Remover</button></footer>`;
    card.querySelector("strong").textContent = `${item.descricao} · Cód. ${item.codigo}`;
    card.querySelector("input").addEventListener("input", (event) => item.quantity = Math.max(Number(event.target.value) || 1, 1));
    card.querySelector("button").addEventListener("click", () => toggleItem(item, false));
    selectedList.append(card);
  });
}

filters.addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { state.page = 1; loadComponents(); }, 250);
});
document.querySelector("#clear-filters").addEventListener("click", () => {
  filters.reset(); state.page = 1; loadComponents();
});
document.querySelector("#previous-page").addEventListener("click", () => { state.page--; loadComponents(); });
document.querySelector("#next-page").addEventListener("click", () => { state.page++; loadComponents(); });
document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
  const column = button.dataset.sort;
  state.direction = state.sort === column && state.direction === "asc" ? "desc" : "asc";
  state.sort = column; state.page = 1; loadComponents();
}));
clearSelectionButton.addEventListener("click", () => { state.selected.clear(); renderSelection(); loadComponents(); });
copyButton.addEventListener("click", async () => {
  const lines = [...state.selected.values()].map((item) => `- ${item.descricao} - Cód. ${item.codigo} - Quantidade: ${item.quantity}`);
  await navigator.clipboard.writeText(`Solicito os itens:\n${lines.join("\n")}`);
  showToast("Solicitação copiada.", true);
});

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = document.querySelector("#spreadsheet-file").files[0];
  if (!file) return;

  importButton.disabled = true;
  importButton.textContent = "Importando...";
  try {
    const body = new FormData();
    body.append("planilha", file);
    body.append("senha", document.querySelector("#import-password").value);
    const response = await fetch(IMPORT_API_URL, { method: "POST", body });
    if (!response.ok) throw new Error(await readApiError(response));

    const result = await response.json();
    importForm.reset();
    showToast(`${result.processed} itens processados: ${result.inserted} inseridos e ${result.updated} atualizados.`, true);
    state.page = 1;
    await loadComponents();
  } catch (error) {
    showToast(error.message || "Não foi possível importar a planilha.");
  } finally {
    importButton.disabled = false;
    importButton.textContent = "Atualizar banco";
  }
});

function showToast(message, success = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.className = `toast show ${success ? "success" : ""}`;
  setTimeout(() => toast.className = "toast", 3500);
}

renderSelection();
loadComponents();
