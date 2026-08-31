import { CURRENCY, FIELD_LABELS, PEOPLE } from "./config";
import { exportCSV } from "./csv";
import { esc, fmt, monthLabel, monthOf, todayStr } from "./format";
import { equalShares, isCustomSplitValid, personIdx, personSpend, splitLabel } from "./split";
import {
  deleteCard as dbDeleteCard,
  deleteCategory as dbDeleteCategory,
  deleteExpense as dbDeleteExpense,
  deletePaymentMode as dbDeletePaymentMode,
  fetchAuditLog,
  fetchCards,
  fetchCategories,
  fetchExpenses,
  fetchPaymentModes,
  insertCard as dbInsertCard,
  insertCategory as dbInsertCategory,
  insertExpense,
  insertPaymentMode as dbInsertPaymentMode,
  onAuthStateChange,
  signIn as dbSignIn,
  signOut as dbSignOut,
  subscribeToExpenseChanges,
  subscribeToLookupChanges,
  updateExpense as dbUpdateExpense,
} from "./supabaseClient";
import type { AuditRow, Card, Category, Expense, ExpenseInput, FormSelection, PaymentMode, SplitMode, Tab } from "./types";

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

let expenses: Expense[] = [];
let cards: Card[] = [];
let modes: PaymentMode[] = [];
let categories: Category[] = [];
let editingId: string | null = null;
let openRow: string | null = null;
const sel: FormSelection = {
  paidBy: 0,
  mode: "UPI",
  recurring: false,
  emi: false,
  split: false,
  splitMode: "no",
};
let histMonth = monthOf(todayStr());
let histPerson = -1;
let histCat = "All";
let insMonth = monthOf(todayStr());
let auditRows: AuditRow[] = [];

/* ---------------- auth ---------------- */
function wireAuth(): void {
  $("loginBtn").addEventListener("click", handleSignIn);
  $<HTMLInputElement>("loginPass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSignIn();
  });
  $("logoutBtn").addEventListener("click", () => dbSignOut());

  onAuthStateChange((session) => {
    if (session) {
      $("login").classList.add("hidden");
      $("app").classList.remove("hidden");
      const me = PEOPLE.findIndex((p) => p.email.toLowerCase() === (session.user.email ?? "").toLowerCase());
      if (me >= 0) sel.paidBy = me as 0 | 1;
      boot();
    } else {
      $("app").classList.add("hidden");
      $("login").classList.remove("hidden");
    }
  });
}

async function handleSignIn(): Promise<void> {
  const email = $<HTMLInputElement>("loginEmail").value.trim();
  const password = $<HTMLInputElement>("loginPass").value;
  const btn = $<HTMLButtonElement>("loginBtn");
  const err = $("loginErr");
  if (!email || !password) {
    err.textContent = "Enter your email and password.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Signing in…";
  err.textContent = "";
  const error = await dbSignIn(email, password);
  btn.disabled = false;
  btn.textContent = "Sign in";
  if (error) err.textContent = "Wrong email or password. Try again.";
}

/* ---------------- data ---------------- */
async function fetchAll(): Promise<void> {
  const { data, error } = await fetchExpenses();
  if (error) {
    alert("Could not load expenses: " + error);
    return;
  }
  expenses = data;
  auditRows = await fetchAuditLog();
  renderAll();
}

function isCardMode(name: string): boolean {
  return modes.find((m) => m.name === name)?.is_card ?? false;
}

function normalizeCardName(name: string): string {
  const trimmed = name.trim();
  const existing = cards.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  return existing ? existing.name : trimmed;
}

function titleCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

async function fetchLookups(): Promise<void> {
  const [c, m, cat] = await Promise.all([fetchCards(), fetchPaymentModes(), fetchCategories()]);
  cards = c;
  modes = m;
  categories = cat;
  if (modes.length && !modes.some((x) => x.name === sel.mode)) sel.mode = modes[0]!.name;
  renderModeChips();
  renderCardOptions();
  renderModeManageList();
  renderCardManageList();
  renderCategoryOptions();
  renderCategoryManageList();
  paintChips();
}

let booted = false;
function boot(): void {
  if (booted) {
    void fetchAll();
    void fetchLookups();
    return;
  }
  booted = true;
  buildStaticControls();
  void fetchLookups();
  void fetchAll();
  subscribeToExpenseChanges(() => void fetchAll());
  subscribeToLookupChanges(() => void fetchLookups());
}

function splitShares(): [number | null, number | null] {
  const amt = parseFloat($<HTMLInputElement>("fAmount").value) || 0;
  if (sel.splitMode === "equal") return equalShares(amt);
  if (sel.splitMode === "custom") {
    return [
      parseFloat($<HTMLInputElement>("fShare0").value) || 0,
      parseFloat($<HTMLInputElement>("fShare1").value) || 0,
    ];
  }
  return [null, null];
}

function splitValid(): boolean {
  if (!sel.split) return true;
  if (sel.splitMode === "equal") return true;
  const amt = parseFloat($<HTMLInputElement>("fAmount").value);
  const s0 = parseFloat($<HTMLInputElement>("fShare0").value);
  const s1 = parseFloat($<HTMLInputElement>("fShare1").value);
  return isCustomSplitValid(amt, s0, s1);
}

async function saveExpense(): Promise<void> {
  const amount = parseFloat($<HTMLInputElement>("fAmount").value);
  const description = $<HTMLInputElement>("fDesc").value.trim();
  if (!(amount > 0) || !description || !splitValid()) return;
  const [share_p0, share_p1] = splitShares();
  const isCard = isCardMode(sel.mode);
  const cardName = isCard ? normalizeCardName($<HTMLInputElement>("fCard").value) : "";
  if (isCard && cardName && !cards.some((c) => c.name.toLowerCase() === cardName.toLowerCase())) {
    void dbInsertCard(cardName);
  }
  const rec: ExpenseInput = {
    amount,
    description,
    date: $<HTMLInputElement>("fDate").value || todayStr(),
    category: $<HTMLSelectElement>("fCat").value,
    paid_by: PEOPLE[sel.paidBy].name,
    mode: sel.mode,
    card: cardName,
    recurring: sel.recurring,
    note: $<HTMLInputElement>("fNote").value.trim(),
    split: sel.split,
    share_p0: sel.split ? share_p0 : null,
    share_p1: sel.split ? share_p1 : null,
    emi: sel.recurring && sel.emi,
    emi_months: sel.recurring && sel.emi ? parseInt($<HTMLInputElement>("fEmiMonths").value, 10) || null : null,
  };
  const saveBtn = $<HTMLButtonElement>("saveBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  const error = editingId ? await dbUpdateExpense(editingId, rec) : await insertExpense(rec);
  saveBtn.textContent = editingId ? "Save changes" : "Add expense";
  if (error) {
    alert("Could not save: " + error);
    saveBtn.disabled = false;
    return;
  }
  resetForm();
  await fetchAll();
}

async function deleteExpenseFlow(id: string): Promise<void> {
  const x = expenses.find((e) => e.id === id);
  if (!x || !confirm(`Delete "${x.description}"?`)) return;
  const error = await dbDeleteExpense(id);
  if (error) {
    alert("Could not delete: " + error);
    return;
  }
  await fetchAll();
}

async function addMode(): Promise<void> {
  const input = $<HTMLInputElement>("newModeName");
  const name = input.value.trim();
  if (!name) return;
  if (modes.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    input.value = "";
    return;
  }
  const isCard = $<HTMLInputElement>("newModeIsCard").checked;
  const error = await dbInsertPaymentMode(name, isCard);
  if (error) {
    alert("Could not add: " + error);
    return;
  }
  input.value = "";
  $<HTMLInputElement>("newModeIsCard").checked = false;
  await fetchLookups();
}

async function deleteModeFlow(id: string): Promise<void> {
  const m = modes.find((x) => x.id === id);
  if (!m || !confirm(`Delete payment mode "${m.name}"?`)) return;
  const error = await dbDeletePaymentMode(id);
  if (error) {
    alert("Could not delete: " + error);
    return;
  }
  await fetchLookups();
}

async function addCardFromManage(): Promise<void> {
  const input = $<HTMLInputElement>("newCardName");
  const name = input.value.trim();
  if (!name) return;
  if (cards.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    input.value = "";
    return;
  }
  const error = await dbInsertCard(name);
  if (error) {
    alert("Could not add: " + error);
    return;
  }
  input.value = "";
  await fetchLookups();
}

async function deleteCardFlow(id: string): Promise<void> {
  const c = cards.find((x) => x.id === id);
  if (!c || !confirm(`Delete card "${c.name}"?`)) return;
  const error = await dbDeleteCard(id);
  if (error) {
    alert("Could not delete: " + error);
    return;
  }
  await fetchLookups();
}

async function addCategory(): Promise<void> {
  const input = $<HTMLInputElement>("newCatName");
  const raw = input.value.trim();
  if (!raw) return;
  const name = titleCase(raw);
  if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    input.value = "";
    return;
  }
  const error = await dbInsertCategory(name);
  if (error) {
    alert("Could not add: " + error);
    return;
  }
  input.value = "";
  await fetchLookups();
}

async function deleteCategoryFlow(id: string): Promise<void> {
  const c = categories.find((x) => x.id === id);
  if (!c || !confirm(`Delete category "${c.name}"?`)) return;
  const error = await dbDeleteCategory(id);
  if (error) {
    alert("Could not delete: " + error);
    return;
  }
  await fetchLookups();
}

/* ---------------- form ---------------- */
function buildStaticControls(): void {
  $("curSym").textContent = CURRENCY;
  $<HTMLInputElement>("fDate").value = todayStr();
  $("headNames").textContent = PEOPLE.map((p) => p.name.toUpperCase()).join(" + ") + " · LEDGER";

  $("fPaidBy").innerHTML = PEOPLE.map(
    (p, i) => `<button class="chip c${i}" data-p="${i}">${esc(p.name)}</button>`,
  ).join("");
  $("fPaidBy").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-p]");
    if (!b) return;
    sel.paidBy = Number(b.dataset["p"]) as 0 | 1;
    paintChips();
  });

  $("fMode").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-m]");
    if (!b) return;
    sel.mode = b.dataset["m"]!;
    paintChips();
  });
  $("modeManageBtn").addEventListener("click", () => {
    $("modeManagePanel").classList.toggle("hidden");
  });
  $("addModeBtn").addEventListener("click", () => void addMode());
  $<HTMLInputElement>("newModeName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void addMode();
  });

  $("cardManageBtn").addEventListener("click", () => {
    $("cardManagePanel").classList.toggle("hidden");
  });
  $("addCardBtn").addEventListener("click", () => void addCardFromManage());
  $<HTMLInputElement>("newCardName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void addCardFromManage();
  });

  $("catManageBtn").addEventListener("click", () => {
    $("catManagePanel").classList.toggle("hidden");
  });
  $("addCatBtn").addEventListener("click", () => void addCategory());
  $<HTMLInputElement>("newCatName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void addCategory();
  });

  $("fRecurring").addEventListener("click", () => {
    sel.recurring = !sel.recurring;
    if (!sel.recurring) sel.emi = false;
    paintChips();
    validate();
  });

  $("fEmi").addEventListener("click", () => {
    sel.emi = !sel.emi;
    paintChips();
    validate();
  });
  $("fEmiMonths").addEventListener("input", validate);

  $("fShare0Label").textContent = PEOPLE[0].name + "'s share";
  $("fShare1Label").textContent = PEOPLE[1].name + "'s share";
  $("fSplit").innerHTML =
    `<button class="chip" data-split="no">Just me</button>` +
    `<button class="chip" data-split="equal">Split equally</button>` +
    `<button class="chip" data-split="custom">Custom split</button>`;
  $("fSplit").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-split]");
    if (!b) return;
    sel.splitMode = b.dataset["split"] as SplitMode;
    sel.split = sel.splitMode !== "no";
    if (sel.splitMode === "custom") {
      const [s0, s1] = splitShares();
      const f0 = $<HTMLInputElement>("fShare0");
      const f1 = $<HTMLInputElement>("fShare1");
      if (!f0.value) f0.value = s0 ? s0.toFixed(2) : "";
      if (!f1.value) f1.value = s1 ? s1.toFixed(2) : "";
    }
    paintChips();
    validate();
  });
  ["fShare0", "fShare1"].forEach((id) =>
    $(id).addEventListener("input", () => {
      validate();
      renderSplitPreview();
    }),
  );

  ["fAmount", "fDesc"].forEach((id) =>
    $(id).addEventListener("input", () => {
      validate();
      renderSplitPreview();
    }),
  );
  $("saveBtn").addEventListener("click", () => void saveExpense());
  $("cancelBtn").addEventListener("click", resetForm);
  $("syncBtn").addEventListener("click", () => void fetchAll());
  $("csvBtn").addEventListener("click", () => exportCSV(expenses));

  $<HTMLSelectElement>("histMonth").addEventListener("change", (e) => {
    histMonth = (e.target as HTMLSelectElement).value;
    renderHistory();
  });
  $<HTMLSelectElement>("histCat").addEventListener("change", (e) => {
    histCat = (e.target as HTMLSelectElement).value;
    renderHistory();
  });
  $("histPerson").innerHTML =
    `<button class="chip" data-hp="-1">Both</button>` +
    PEOPLE.map((p, i) => `<button class="chip c${i}" data-hp="${i}">${esc(p.name)}</button>`).join("");
  $("histPerson").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-hp]");
    if (!b) return;
    histPerson = Number(b.dataset["hp"]);
    renderHistory();
  });
  $<HTMLSelectElement>("insMonth").addEventListener("change", (e) => {
    insMonth = (e.target as HTMLSelectElement).value;
    renderInsights();
  });

  document.querySelectorAll<HTMLElement>("nav [data-tab]").forEach((b) =>
    b.addEventListener("click", () => switchTab(b.dataset["tab"] as Tab)),
  );

  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const edit = target.closest<HTMLElement>("[data-edit]");
    if (edit) {
      startEdit(edit.dataset["edit"]!);
      return;
    }
    const del = target.closest<HTMLElement>("[data-del]");
    if (del) {
      void deleteExpenseFlow(del.dataset["del"]!);
      return;
    }
    const delMode = target.closest<HTMLElement>("[data-del-mode]");
    if (delMode) {
      void deleteModeFlow(delMode.dataset["delMode"]!);
      return;
    }
    const delCard = target.closest<HTMLElement>("[data-del-card]");
    if (delCard) {
      void deleteCardFlow(delCard.dataset["delCard"]!);
      return;
    }
    const delCat = target.closest<HTMLElement>("[data-del-cat]");
    if (delCat) {
      void deleteCategoryFlow(delCat.dataset["delCat"]!);
      return;
    }
    const row = target.closest<HTMLElement>("[data-row]");
    if (row) {
      openRow = openRow === row.dataset["row"] ? null : (row.dataset["row"] ?? null);
      renderLists();
    }
  });

  paintChips();
  validate();
}

function paintChips(): void {
  $("fPaidBy")
    .querySelectorAll<HTMLElement>(".chip")
    .forEach((b) => b.classList.toggle("on", Number(b.dataset["p"]) === sel.paidBy));
  $("fMode")
    .querySelectorAll<HTMLElement>(".chip")
    .forEach((b) => b.classList.toggle("on", b.dataset["m"] === sel.mode));
  $("cardWrap").classList.toggle("hidden", !isCardMode(sel.mode));
  $("fRecurring").classList.toggle("on", sel.recurring);
  $("fRecurring").setAttribute("aria-pressed", String(sel.recurring));
  $("emiWrap").classList.toggle("hidden", !sel.recurring);
  $("fEmi").classList.toggle("on", sel.emi);
  $("fEmi").setAttribute("aria-pressed", String(sel.emi));
  $("emiMonthsWrap").classList.toggle("hidden", !(sel.recurring && sel.emi));
  $("fSplit")
    .querySelectorAll<HTMLElement>(".chip")
    .forEach((b) => b.classList.toggle("on", b.dataset["split"] === sel.splitMode));
  $("customSplitWrap").classList.toggle("hidden", sel.splitMode !== "custom");
  renderSplitPreview();
}

function renderSplitPreview(): void {
  const amt = parseFloat($<HTMLInputElement>("fAmount").value) || 0;
  const preview = $("splitPreview");
  if (sel.splitMode === "equal" && amt > 0) {
    const [h0, h1] = equalShares(amt);
    preview.textContent = `${PEOPLE[0].name} ${CURRENCY}${fmt(h0)} · ${PEOPLE[1].name} ${CURRENCY}${fmt(h1)}`;
  } else {
    preview.textContent = "";
  }
  $("splitErr").textContent =
    sel.split && sel.splitMode === "custom" && !splitValid()
      ? "Shares must add up to the total amount."
      : "";
}

function emiValid(): boolean {
  if (!sel.recurring || !sel.emi) return true;
  return parseInt($<HTMLInputElement>("fEmiMonths").value, 10) > 0;
}

function validate(): void {
  $<HTMLButtonElement>("saveBtn").disabled = !(
    parseFloat($<HTMLInputElement>("fAmount").value) > 0 &&
    $<HTMLInputElement>("fDesc").value.trim() &&
    splitValid() &&
    emiValid()
  );
}

function resetForm(): void {
  editingId = null;
  $<HTMLInputElement>("fAmount").value = "";
  $<HTMLInputElement>("fDesc").value = "";
  $<HTMLInputElement>("fNote").value = "";
  $<HTMLInputElement>("fCard").value = "";
  $<HTMLInputElement>("fShare0").value = "";
  $<HTMLInputElement>("fShare1").value = "";
  $<HTMLInputElement>("fEmiMonths").value = "";
  $<HTMLInputElement>("fDate").value = todayStr();
  $<HTMLSelectElement>("fCat").value = categories[0]?.name ?? "";
  sel.mode = modes[0]?.name ?? sel.mode;
  sel.recurring = false;
  sel.emi = false;
  sel.split = false;
  sel.splitMode = "no";
  const saveBtn = $<HTMLButtonElement>("saveBtn");
  saveBtn.textContent = "Add expense";
  saveBtn.disabled = true;
  $("cancelBtn").classList.add("hidden");
  paintChips();
}

function startEdit(id: string): void {
  const x = expenses.find((e) => e.id === id);
  if (!x) return;
  editingId = id;
  $<HTMLInputElement>("fAmount").value = String(x.amount);
  $<HTMLInputElement>("fDesc").value = x.description;
  $<HTMLInputElement>("fDate").value = x.date;
  $<HTMLSelectElement>("fCat").value = x.category;
  sel.paidBy = Math.max(0, PEOPLE.findIndex((p) => p.name === x.paid_by)) as 0 | 1;
  sel.mode = x.mode;
  sel.recurring = !!x.recurring;
  sel.emi = !!x.emi;
  $<HTMLInputElement>("fEmiMonths").value = x.emi && x.emi_months ? String(x.emi_months) : "";
  sel.split = !!x.split;
  if (sel.split) {
    const s0 = Number(x.share_p0) || 0;
    const s1 = Number(x.share_p1) || 0;
    const isEqual = Math.abs(s0 - s1) < 0.01 && Math.abs(s0 + s1 - Number(x.amount)) < 0.01;
    sel.splitMode = isEqual ? "equal" : "custom";
    $<HTMLInputElement>("fShare0").value = s0 ? s0.toFixed(2) : "";
    $<HTMLInputElement>("fShare1").value = s1 ? s1.toFixed(2) : "";
  } else {
    sel.splitMode = "no";
    $<HTMLInputElement>("fShare0").value = "";
    $<HTMLInputElement>("fShare1").value = "";
  }
  $<HTMLInputElement>("fCard").value = x.card || "";
  $<HTMLInputElement>("fNote").value = x.note || "";
  const saveBtn = $<HTMLButtonElement>("saveBtn");
  saveBtn.textContent = "Save changes";
  $("cancelBtn").classList.remove("hidden");
  paintChips();
  validate();
  switchTab("add");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------------- rendering ---------------- */
function switchTab(t: Tab): void {
  document.querySelectorAll<HTMLElement>("nav [data-tab]").forEach((b) => b.classList.toggle("on", b.dataset["tab"] === t));
  $("pane-add").classList.toggle("hidden", t !== "add");
  $("pane-history").classList.toggle("hidden", t !== "history");
  $("pane-insights").classList.toggle("hidden", t !== "insights");
  $("pane-audit").classList.toggle("hidden", t !== "audit");
  renderAll();
}

function renderModeChips(): void {
  $("fMode").innerHTML = modes
    .map((m) => `<button type="button" class="chip" data-m="${esc(m.name)}">${esc(m.name)}</button>`)
    .join("");
}

function renderModeManageList(): void {
  $("modeManageList").innerHTML = modes.length
    ? modes
        .map(
          (m) =>
            `<button type="button" class="chip delchip" data-del-mode="${m.id}">${esc(m.name)}${m.is_card ? " 💳" : ""} <span class="x">×</span></button>`,
        )
        .join("")
    : `<span style="font-size:12.5px;color:var(--faint)">No payment modes yet.</span>`;
}

function renderCardOptions(): void {
  $("cardList").innerHTML = cards.map((c) => `<option value="${esc(c.name)}"></option>`).join("");
}

function renderCardManageList(): void {
  $("cardManageList").innerHTML = cards.length
    ? cards
        .map(
          (c) => `<button type="button" class="chip delchip" data-del-card="${c.id}">${esc(c.name)} <span class="x">×</span></button>`,
        )
        .join("")
    : `<span style="font-size:12.5px;color:var(--faint)">No cards yet.</span>`;
}

function renderCategoryOptions(): void {
  const catSel = $<HTMLSelectElement>("fCat");
  const current = catSel.value;
  catSel.innerHTML = categories.map((c) => `<option>${esc(c.name)}</option>`).join("");
  if (categories.some((c) => c.name === current)) catSel.value = current;
  else if (categories.length) catSel.value = categories[0]!.name;

  const histSel = $<HTMLSelectElement>("histCat");
  histSel.innerHTML = `<option>All</option>` + categories.map((c) => `<option>${esc(c.name)}</option>`).join("");
  histSel.value = histCat === "All" || categories.some((c) => c.name === histCat) ? histCat : "All";
}

function renderCategoryManageList(): void {
  $("catManageList").innerHTML = categories.length
    ? categories
        .map(
          (c) => `<button type="button" class="chip delchip" data-del-cat="${c.id}">${esc(c.name)} <span class="x">×</span></button>`,
        )
        .join("")
    : `<span style="font-size:12.5px;color:var(--faint)">No categories yet.</span>`;
}

function months(): string[] {
  const s = new Set(expenses.map((x) => monthOf(x.date)));
  s.add(monthOf(todayStr()));
  return [...s].sort().reverse();
}

function splitBarHTML(byPerson: [number, number]): string {
  const total = byPerson[0] + byPerson[1];
  const pct = total ? (byPerson[0] / total) * 100 : 50;
  return `<div class="splitbar">${total > 0 ? `<div class="s0" style="width:${pct}%"></div><div class="s1"></div>` : ""}</div>
    <div class="splitnames">${PEOPLE.map(
      (p, i) =>
        `<span><span class="dot" style="background:var(--p${i})"></span><b>${esc(p.name)}</b>
       <span class="mono" style="opacity:.75">${CURRENCY}${fmt(byPerson[i]!)}</span></span>`,
    ).join("")}
    </div>`;
}

function rowHTML(x: Expense): string {
  const i = personIdx(x.paid_by, PEOPLE);
  const d = new Date(x.date + "T00:00").toLocaleDateString("en", { day: "numeric", month: "short" });
  const open = openRow === x.id;
  return `<div class="row">
    <div class="rowmain" data-row="${x.id}">
      <span class="rowbar" style="background:var(--p${i})"></span>
      <div style="flex:1;min-width:0">
        <div class="rowdesc">${esc(x.description)} ${x.emi ? "🏷️" : x.recurring ? "🔁" : ""} ${x.split ? "⇄" : ""}</div>
        <div class="rowsub">${d} · ${esc(x.category)} · ${esc(x.paid_by)}</div>
      </div>
      <div class="rowamt">${CURRENCY}${fmt(x.amount)}</div>
    </div>
    ${
      open
        ? `<div class="rowdetail">
        <span>${esc(x.mode)}${x.card ? " · " + esc(x.card) : ""}</span>
        ${x.split ? `<span>${splitLabel(x, PEOPLE, CURRENCY)}</span>` : ""}
        ${x.emi ? `<span>EMI${x.emi_months ? ` · ${x.emi_months} months` : ""}</span>` : ""}
        ${x.note ? `<span>"${esc(x.note)}"</span>` : ""}
        <span style="flex:1"></span>
        <button class="linkbtn" style="color:var(--green)" data-edit="${x.id}">Edit</button>
        <button class="linkbtn" style="color:var(--danger)" data-del="${x.id}">Delete</button>
      </div>`
        : ""
    }
  </div>`;
}

function fillMonthSelect(el: HTMLSelectElement, val: string): void {
  el.innerHTML = months()
    .map((m) => `<option value="${m}" ${m === val ? "selected" : ""}>${monthLabel(m)}</option>`)
    .join("");
}

function renderHeader(): void {
  const tm = monthOf(todayStr());
  const rows = expenses.filter((x) => monthOf(x.date) === tm);
  const total = rows.reduce((s, x) => s + Number(x.amount), 0);
  const byP: [number, number] = [0, 1].map((i) =>
    rows.reduce((s, x) => s + personSpend(x, i as 0 | 1, PEOPLE), 0),
  ) as [number, number];
  $("headMonth").textContent = monthLabel(tm) + " so far";
  $("headTotal").textContent = CURRENCY + fmt(total);
  $("headSplit").innerHTML = splitBarHTML(byP);
}

function renderLists(): void {
  $("recentList").innerHTML =
    expenses
      .slice(0, 6)
      .map(rowHTML)
      .join("") || `<div class="empty">No expenses yet. Add your first one above.</div>`;
  renderHistory();
}

function renderHistory(): void {
  fillMonthSelect($<HTMLSelectElement>("histMonth"), histMonth);
  $("histPerson")
    .querySelectorAll<HTMLElement>(".chip")
    .forEach((b) => b.classList.toggle("on", Number(b.dataset["hp"]) === histPerson));
  const rows = expenses.filter(
    (x) =>
      monthOf(x.date) === histMonth &&
      (histPerson === -1 || personIdx(x.paid_by, PEOPLE) === histPerson) &&
      (histCat === "All" || x.category === histCat),
  );
  $("histCount").textContent = rows.length + (rows.length === 1 ? " entry" : " entries");
  $("histTotal").textContent = CURRENCY + fmt(rows.reduce((s, x) => s + Number(x.amount), 0));
  $("histList").innerHTML = rows.map(rowHTML).join("") || `<div class="empty">Nothing matches these filters.</div>`;
}

function renderInsights(): void {
  fillMonthSelect($<HTMLSelectElement>("insMonth"), insMonth);
  const rows = expenses.filter((x) => monthOf(x.date) === insMonth);
  const total = rows.reduce((s, x) => s + Number(x.amount), 0);
  const byP: [number, number] = [0, 1].map((i) =>
    rows.reduce((s, x) => s + personSpend(x, i as 0 | 1, PEOPLE), 0),
  ) as [number, number];

  const byCat: Record<string, number> = {};
  rows.forEach((x) => (byCat[x.category] = (byCat[x.category] ?? 0) + Number(x.amount)));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0]![1] : 1;

  const byMode: Record<string, number> = {};
  rows.forEach((x) => {
    const k = x.card ? `${x.mode} · ${x.card}` : x.mode;
    byMode[k] = (byMode[k] ?? 0) + Number(x.amount);
  });
  const modes = Object.entries(byMode).sort((a, b) => b[1] - a[1]);

  const subs = rows.filter((x) => x.recurring);
  const subTotal = subs.reduce((s, x) => s + Number(x.amount), 0);

  const trend: [string, number][] = [];
  const [ty, tm] = insMonth.split("-").map(Number) as [number, number];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(ty, tm - 1 - k, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    trend.push([ym, expenses.filter((x) => monthOf(x.date) === ym).reduce((s, x) => s + Number(x.amount), 0)]);
  }
  const maxT = Math.max(1, ...trend.map((t) => t[1]));

  $("insBody").innerHTML = `
    <div class="box">
      <div class="label">Total spent · ${monthLabel(insMonth)}</div>
      <div class="mono" style="font-size:34px;font-weight:700;margin-bottom:16px">${CURRENCY}${fmt(total)}</div>
      ${splitBarHTML(byP)}
    </div>
    <div class="box">
      <div class="label">By category</div>
      ${
        cats.length
          ? cats
              .map(
                ([c, v]) => `
        <div class="catrow">
          <div class="cathead"><b>${esc(c)}</b><span class="mono" style="color:var(--faint)">${CURRENCY}${fmt(v)}</span></div>
          <div class="cattrack"><div class="catfill" style="width:${(v / maxCat) * 100}%"></div></div>
        </div>`,
              )
              .join("")
          : `<div class="empty" style="padding:0">Nothing yet this month.</div>`
      }
    </div>
    <div class="box">
      <div class="label">Subscriptions this month</div>
      ${
        subs.length
          ? subs
              .map(
                (s) => `
          <div class="lline"><span>${s.emi ? "🏷️" : "🔁"} ${esc(s.description)}${s.emi ? ` <span style="color:var(--faint)">(EMI${s.emi_months ? ` · ${s.emi_months}mo` : ""})</span>` : ""}</span><span class="mono">${CURRENCY}${fmt(s.amount)}</span></div>`,
              )
              .join("") +
            `<div class="lline" style="border:none;font-weight:700;padding-top:10px"><span>Total recurring</span><span class="mono">${CURRENCY}${fmt(subTotal)}</span></div>`
          : `<div class="empty" style="padding:0">No recurring expenses logged.</div>`
      }
    </div>
    <div class="box">
      <div class="label">By payment mode</div>
      ${
        modes.length
          ? modes
              .map(
                ([m, v]) => `
        <div class="lline"><span>${esc(m)}</span><span class="mono">${CURRENCY}${fmt(v)}</span></div>`,
              )
              .join("")
          : `<div class="empty" style="padding:0">Nothing yet this month.</div>`
      }
    </div>
    <div class="box">
      <div class="label">Last 6 months</div>
      <div class="trend">
        ${trend
          .map(
            ([ym, v]) => `
          <div class="trendcol">
            <div class="trendv">${v ? fmt(Math.round(v)) : ""}</div>
            <div class="trendbar ${ym === insMonth ? "now" : ""}" style="height:${Math.max(3, (v / maxT) * 70)}%"></div>
            <div class="trendm">${monthLabel(ym).split(" ")[0]}</div>
          </div>`,
          )
          .join("")}
      </div>
    </div>`;
}

/* ---------------- audit log ---------------- */
function nameFor(email: string | null): string {
  const p = PEOPLE.find((p) => p.email.toLowerCase() === String(email ?? "").toLowerCase());
  return p ? p.name : (email ?? "Unknown");
}

function renderAudit(): void {
  if (!auditRows.length) {
    $("auditBody").innerHTML = `<div class="box empty">No changes recorded yet. Everything you add, edit or delete will show up here.</div>`;
    return;
  }
  $("auditBody").innerHTML = auditRows
    .map((a) => {
      const who = esc(nameFor(a.changed_by_email));
      const when = new Date(a.happened_at).toLocaleString("en", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
      const o = a.old_data ?? {};
      const n = a.new_data ?? {};
      let title = "";
      let detail = "";
      if (a.action === "INSERT") {
        title = `${who} added "${esc(n.description)}"`;
        detail = `${CURRENCY}${fmt(n.amount ?? 0)} · ${esc(n.category)} · ${esc(n.date)}`;
      } else if (a.action === "DELETE") {
        title = `${who} deleted "${esc(o.description)}"`;
        detail = `was ${CURRENCY}${fmt(o.amount ?? 0)} · ${esc(o.category)} · ${esc(o.date)}`;
      } else {
        title = `${who} edited "${esc(n.description ?? o.description)}"`;
        const changes: string[] = [];
        for (const f of Object.keys(FIELD_LABELS) as (keyof Expense)[]) {
          let ov: unknown = o[f];
          let nv: unknown = n[f];
          if (String(ov ?? "") !== String(nv ?? "")) {
            if (f === "amount" || f === "share_p0" || f === "share_p1") {
              ov = ov == null ? ov : CURRENCY + fmt(ov as number);
              nv = nv == null ? nv : CURRENCY + fmt(nv as number);
            }
            if (f === "recurring" || f === "split") {
              ov = ov ? "yes" : "no";
              nv = nv ? "yes" : "no";
            }
            const show = (v: unknown) => (v === "" || v == null ? "—" : esc(v));
            changes.push(`${FIELD_LABELS[f]}: ${show(ov)} → ${show(nv)}`);
          }
        }
        detail = changes.join(" · ") || "No visible change";
      }
      const tag =
        a.action === "INSERT"
          ? ["Added", "var(--green)"]
          : a.action === "DELETE"
            ? ["Deleted", "var(--danger)"]
            : ["Edited", "var(--p1)"];
      return `<div class="box" style="padding:14px 16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--faint)">
        <span style="font-weight:700;letter-spacing:.04em;color:${tag[1]}">${tag[0]}</span>
        <span>${when}</span>
      </div>
      <div style="font-size:14.5px;font-weight:600;margin-top:4px">${title}</div>
      <div style="font-size:13px;color:var(--faint);margin-top:3px">${detail}</div>
    </div>`;
    })
    .join("");
}

function renderAll(): void {
  renderHeader();
  renderLists();
  renderInsights();
  renderAudit();
}

export function initApp(): void {
  wireAuth();
}
