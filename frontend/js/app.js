const PAGE_SIZE = 50;
const DATA_API_URL = window.APP_CONFIG?.COMPONENTS_API_URL || "../api/componentes";
const IMPORT_API_URL = window.APP_CONFIG?.IMPORT_API_URL || "../api/importar-componentes";

const state = {
  page: 1,
  pages: 1,
  sort: "descricao",
  direction: "asc",
  availableOnly: false,
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
const availableOnlyButton = document.querySelector("#available-only");
let filterTimer;

async function loadCurrentUser() {
  const response = await fetch(window.APP_CONFIG.ME_API_URL, { credentials: "same-origin" });
  const data = await response.json();
  if (!data.authenticated) {
    window.location.href = window.APP_CONFIG.ROOT_URL;
    return;
  }
  document.querySelector("#current-user").textContent = data.user.login;
}

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
  if (state.availableOnly) params.set("status", "disponivel");

  try {
    const response = await fetch(`${DATA_API_URL}?${params}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error(await readApiError(response));

    const result = await response.json();
    const items = result.items;
    const total = result.total;
    state.pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    document.querySelector("#total-components").textContent = total.toLocaleString("pt-BR");
    document.querySelector("#page-info").textContent = `Pagina ${state.page} de ${state.pages}`;
    document.querySelector("#previous-page").disabled = state.page <= 1;
    document.querySelector("#next-page").disabled = state.page >= state.pages;
    removeUnavailableSelections(items);
    renderRows(items);
  } catch (error) {
    showToast(error.message || "Nao foi possivel consultar o banco de dados.");
  }
}

async function readApiError(response) {
  if (response.status === 401) {
    window.location.href = window.APP_CONFIG?.ROOT_URL || "/";
    return "Sessao expirada.";
  }
  try {
    const data = await response.json();
    return data.message || data.error || `Erro ${response.status} na requisicao.`;
  } catch {
    return `Erro ${response.status} na requisicao.`;
  }
}

function renderRows(items) {
  rows.replaceChildren();
  emptyState.hidden = items.length > 0;
  items.forEach((item) => {
    const tr = document.createElement("tr");
    const selected = state.selected.has(item.id);
    const available = item.status === "disponivel";
    tr.className = selected ? "is-selected" : "";
    tr.innerHTML = `
      <td class="check-column"><input class="row-check" type="checkbox" ${selected ? "checked" : ""} ${available ? "" : "disabled"} aria-label="Selecionar componente"></td>
      <td class="code"></td>
      <td></td>
      <td></td>
      <td></td>`;
    const cells = tr.querySelectorAll("td");
    cells[1].textContent = item.codigo;
    cells[2].textContent = item.descricao;
    cells[3].innerHTML = `<span class="status-badge ${available ? "available" : "unavailable"}">${available ? "Disponivel" : "Indisponivel"}</span>`;
    cells[4].innerHTML = item.status_cadastro
      ? `<span class="registration-badge">${formatRegistrationStatus(item.status_cadastro)}</span>`
      : `<span class="muted-cell">-</span>`;
    tr.querySelector("input").addEventListener("change", (event) => toggleItem(item, event.target.checked));
    rows.append(tr);
  });
}

function toggleItem(item, selected) {
  if (selected && item.status !== "disponivel") {
    showToast("Este item esta indisponivel no estoque atual.");
    return;
  }
  selected ? state.selected.set(item.id, { ...item, quantity: 1 }) : state.selected.delete(item.id);
  renderSelection();
  loadComponents();
}

function removeUnavailableSelections(items) {
  let changed = false;
  for (const item of items) {
    if (item.status !== "disponivel" && state.selected.delete(item.id)) changed = true;
  }
  if (changed) renderSelection();
}

function renderSelection() {
  selectedList.replaceChildren();
  const items = [...state.selected.values()];
  selectedCount.textContent = items.length;
  copyButton.disabled = items.length === 0;
  clearSelectionButton.disabled = items.length === 0;
  if (!items.length) {
    selectedList.innerHTML = `<div class="selection-empty"><span>+</span><p>Selecione componentes disponiveis na tabela para montar sua solicitacao.</p></div>`;
    return;
  }
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "selected-item";
    card.innerHTML = `<strong></strong><footer><label><span>Quantidade</span><input type="number" min="1" value="${item.quantity}"></label><button class="remove-item">Remover</button></footer>`;
    card.querySelector("strong").textContent = `${item.descricao} - Cod. ${item.codigo}`;
    card.querySelector("input").addEventListener("input", (event) => item.quantity = Math.max(Number(event.target.value) || 1, 1));
    card.querySelector("button").addEventListener("click", () => toggleItem(item, false));
    selectedList.append(card);
  });
}

filters.addEventListener("input", () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    state.page = 1;
    loadComponents();
  }, 250);
});

document.querySelector("#clear-filters").addEventListener("click", () => {
  filters.reset();
  state.page = 1;
  loadComponents();
});

availableOnlyButton.addEventListener("click", () => {
  state.availableOnly = !state.availableOnly;
  availableOnlyButton.classList.toggle("is-active", state.availableOnly);
  availableOnlyButton.setAttribute("aria-pressed", String(state.availableOnly));
  state.page = 1;
  loadComponents();
});

document.querySelector("#previous-page").addEventListener("click", () => {
  state.page -= 1;
  loadComponents();
});

document.querySelector("#next-page").addEventListener("click", () => {
  state.page += 1;
  loadComponents();
});

document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
  const column = button.dataset.sort;
  state.direction = state.sort === column && state.direction === "asc" ? "desc" : "asc";
  state.sort = column;
  state.page = 1;
  loadComponents();
}));

clearSelectionButton.addEventListener("click", () => {
  state.selected.clear();
  renderSelection();
  loadComponents();
});

copyButton.addEventListener("click", async () => {
  const lines = [...state.selected.values()].map((item) => `- ${item.descricao} - Cod. ${item.codigo} - Quantidade: ${item.quantity}`);
  await navigator.clipboard.writeText(`Solicito os itens:\n${lines.join("\n")}`);
  showToast("Solicitacao copiada.", true);
});

document.querySelector("#logout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await fetch(window.APP_CONFIG.LOGOUT_API_URL, { method: "POST", credentials: "same-origin" });
  window.location.href = window.APP_CONFIG.ROOT_URL;
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
    const response = await fetch(IMPORT_API_URL, { method: "POST", body, credentials: "same-origin" });
    if (!response.ok) throw new Error(await readApiError(response));

    const result = await response.json();
    importForm.reset();
    state.selected.clear();
    renderSelection();
    showToast(`${result.processed} itens disponiveis: ${result.inserted} novos, ${result.updated} atualizados e ${result.unavailable} indisponiveis.`, true);
    state.page = 1;
    await loadComponents();
  } catch (error) {
    showToast(error.message || "Nao foi possivel importar a planilha.");
  } finally {
    importButton.disabled = false;
    importButton.textContent = "Atualizar estoque";
  }
});

function showToast(message, success = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.className = `toast show ${success ? "success" : ""}`;
  setTimeout(() => toast.className = "toast", 3500);
}

function formatRegistrationStatus(status) {
  return String(status || "")
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

renderSelection();
loadCurrentUser().then(loadComponents);
