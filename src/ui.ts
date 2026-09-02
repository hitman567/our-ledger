import { CURRENCY, FIELD_LABELS, PEOPLE } from "./config";
import { exportCSV } from "./csv";
import { addInterval, cycleEndDate, dayAfter, dueDateFor, esc, fmt, monthLabel, monthOf, todayStr } from "./format";
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
  fetchSubscriptions,
  insertCard as dbInsertCard,
  insertCategory as dbInsertCategory,
  insertExpense,
  insertExpensesBulk as dbInsertExpensesBulk,
  insertGeneratedExpense as dbInsertGeneratedExpense,
  insertPaymentMode as dbInsertPaymentMode,
  insertSubscription as dbInsertSubscription,
  onAuthStateChange,
  signIn as dbSignIn,
  signOut as dbSignOut,
  subscribeToExpenseChanges,
  subscribeToLookupChanges,
  updateCard as dbUpdateCard,
  updateExpense as dbUpdateExpense,
  updateSubscription as dbUpdateSubscription,
} from "./supabaseClient";
import type {
  AuditRow,
  Card,
  Category,
  Expense,
  ExpenseInput,
  FormSelection,
  PaymentMode,
  SplitMode,
  Subscription,
  SubscriptionFrequency,
  Tab,
} from "./types";

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

let expenses: Expense[] = [];
let cards: Card[] = [];
let modes: PaymentMode[] = [];
let categories: Category[] = [];
let subscriptions: Subscription[] = [];
let editingId: string | null = null;
let openRow: string | null = null;
const sel: FormSelection = {
  paidBy: 0,
  mode: "UPI",
  recurring: false,
  emi: false,
  subFrequency: "monthly",
  split: false,
  splitMode: "no",
};
let histMonth = monthOf(todayStr());
let histPerson = -1;
let histCat = "All";
let insMonth = monthOf(todayStr());
let auditRows: AuditRow[] = [];
let filterMode = "All";
let filterCard = "All";
let filterFrom = "";
let filterTo = "";

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
  const [c, m, cat, subs] = await Promise.all([fetchCards(), fetchPaymentModes(), fetchCategories(), fetchSubscriptions()]);
  cards = c;
  modes = m;
  categories = cat;
  subscriptions = subs;
  if (modes.length && !modes.some((x) => x.name === sel.mode)) sel.mode = modes[0]!.name;
  renderModeChips();
  renderCardOptions();
  renderModeManageList();
  renderCardManageList();
  renderCategoryOptions();
  renderCategoryManageList();
  renderSubscriptionsPage();
  renderFilterBox();
  paintChips();
}

/**
 * Generates any expense rows an active subscription is due for (possibly
 * several, if the app hasn't been opened in a while), advancing each
 * subscription's `next_due` as it goes. Runs on every boot so a
 * subscription auto-renews without anyone re-entering it.
 */
async function runSubscriptionCatchup(): Promise<void> {
  const subs = await fetchSubscriptions();
  const today = todayStr();
  let generatedAny = false;
  for (const s of subs) {
    if (!s.active) continue;
    let next = s.next_due;
    let skip = s.skip_next;
    let iterations = 0;
    while (next <= today && iterations < 60) {
      iterations++;
      if (skip) {
        skip = false;
      } else {
        const rec: ExpenseInput = {
          amount: s.amount,
          description: s.description,
          date: next,
          category: s.category,
          paid_by: s.paid_by,
          mode: s.mode,
          card: s.card,
          recurring: true,
          note: s.note,
          split: s.split,
          share_p0: s.share_p0,
          share_p1: s.share_p1,
          emi: false,
          emi_months: null,
          emi_index: null,
          subscription_id: s.id,
        };
        await dbInsertGeneratedExpense(rec);
        generatedAny = true;
      }
      next = addInterval(next, s.frequency, 1);
    }
    if (next !== s.next_due || skip !== s.skip_next) {
      await dbUpdateSubscription(s.id, { next_due: next, skip_next: skip });
    }
  }
  if (generatedAny) await fetchAll();
  await fetchLookups();
}

let booted = false;
function boot(): void {
  if (booted) {
    void fetchAll();
    void fetchLookups();
    void runSubscriptionCatchup();
    return;
  }
  booted = true;
  buildStaticControls();
  void fetchLookups();
  void fetchAll();
  void runSubscriptionCatchup();
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
  const date = $<HTMLInputElement>("fDate").value || todayStr();
  const category = $<HTMLSelectElement>("fCat").value;
  const paidBy = PEOPLE[sel.paidBy].name;
  const note = $<HTMLInputElement>("fNote").value.trim();
  const isEmi = sel.recurring && sel.emi;
  const emiMonths = isEmi ? parseInt($<HTMLInputElement>("fEmiMonths").value, 10) || null : null;
  const base = {
    amount,
    description,
    category,
    paid_by: paidBy,
    mode: sel.mode,
    card: cardName,
    note,
    split: sel.split,
    share_p0: sel.split ? share_p0 : null,
    share_p1: sel.split ? share_p1 : null,
  };

  const saveBtn = $<HTMLButtonElement>("saveBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  let error: string | null;
  if (editingId) {
    const existing = expenses.find((x) => x.id === editingId);
    const rec: ExpenseInput = {
      ...base,
      date,
      recurring: sel.recurring,
      emi: isEmi,
      emi_months: emiMonths,
      emi_index: existing?.emi_index ?? null,
      subscription_id: existing?.subscription_id ?? null,
    };
    error = await dbUpdateExpense(editingId, rec);
  } else if (isEmi && emiMonths && emiMonths > 0) {
    // Generate the full EMI schedule now, one row per month.
    const recs: ExpenseInput[] = Array.from({ length: emiMonths }, (_, i) => ({
      ...base,
      date: addInterval(date, "monthly", i),
      recurring: true,
      emi: true,
      emi_months: emiMonths,
      emi_index: i + 1,
      subscription_id: null,
    }));
    error = await dbInsertExpensesBulk(recs);
  } else {
    const rec: ExpenseInput = {
      ...base,
      date,
      recurring: sel.recurring,
      emi: false,
      emi_months: null,
      emi_index: null,
      subscription_id: null,
    };
    error = await insertExpense(rec);
    if (!error && sel.recurring) {
      // Register the recurring rule so future occurrences auto-generate.
      const subError = await dbInsertSubscription({
        description,
        amount,
        category,
        paid_by: paidBy,
        mode: sel.mode,
        card: cardName,
        note,
        frequency: sel.subFrequency,
        next_due: addInterval(date, sel.subFrequency, 1),
        active: true,
        skip_next: false,
        split: sel.split,
        share_p0: sel.split ? share_p0 : null,
        share_p1: sel.split ? share_p1 : null,
      });
      if (subError) alert("Expense saved, but couldn't schedule future auto-renewals: " + subError);
    }
  }

  saveBtn.textContent = editingId ? "Save changes" : "Add expense";
  if (error) {
    alert("Could not save: " + error);
    saveBtn.disabled = false;
    return;
  }
  resetForm();
  await fetchAll();
  await fetchLookups();
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

async function updateCardDateFlow(id: string, field: "billing_date" | "due_date", raw: string): Promise<void> {
  const n = parseInt(raw, 10);
  const value = n >= 1 && n <= 31 ? n : null;
  const patch: Partial<Card> = field === "billing_date" ? { billing_date: value } : { due_date: value };
  const error = await dbUpdateCard(id, patch);
  if (error) {
    alert("Could not save: " + error);
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

async function skipSubscriptionFlow(id: string): Promise<void> {
  const error = await dbUpdateSubscription(id, { skip_next: true });
  if (error) {
    alert("Could not update: " + error);
    return;
  }
  await fetchLookups();
}

async function stopSubscriptionFlow(id: string): Promise<void> {
  const s = subscriptions.find((x) => x.id === id);
  if (!s || !confirm(`Stop "${s.description}"? No further charges will be added automatically.`)) return;
  const error = await dbUpdateSubscription(id, { active: false });
  if (error) {
    alert("Could not stop: " + error);
    return;
  }
  if (subsExpandedId === id) subsExpandedId = null;
  await fetchLookups();
}

/** Resumes a stopped subscription, skipping past any periods it missed
 * while inactive rather than immediately generating a backlog of charges. */
async function resumeSubscriptionFlow(id: string): Promise<void> {
  const s = subscriptions.find((x) => x.id === id);
  if (!s) return;
  const today = todayStr();
  let next = s.next_due;
  while (next < today) next = addInterval(next, s.frequency, 1);
  const error = await dbUpdateSubscription(id, { active: true, next_due: next });
  if (error) {
    alert("Could not resume: " + error);
    return;
  }
  await fetchLookups();
}

async function updateSubscriptionFieldFlow(id: string, field: string, raw: string): Promise<void> {
  let patch: Partial<Subscription>;
  if (field === "amount") {
    const n = parseFloat(raw);
    if (!(n > 0)) {
      alert("Amount must be greater than 0.");
      await fetchLookups();
      return;
    }
    patch = { amount: n };
  } else if (field === "description") {
    if (!raw.trim()) {
      await fetchLookups();
      return;
    }
    patch = { description: raw.trim() };
  } else if (field === "category") {
    patch = { category: raw };
  } else if (field === "paid_by") {
    patch = { paid_by: raw };
  } else if (field === "frequency") {
    patch = { frequency: raw as SubscriptionFrequency };
  } else if (field === "next_due") {
    if (!raw) {
      await fetchLookups();
      return;
    }
    patch = { next_due: raw };
  } else {
    return;
  }
  const error = await dbUpdateSubscription(id, patch);
  if (error) alert("Could not save: " + error);
  await fetchLookups();
}

/**
 * One-time fix for recurring expenses added before subscription rules
 * existed: finds each such expense (grouped by description, payer,
 * category, mode and card, keeping the most recent occurrence per group)
 * that has no matching active subscription yet, and creates one so it
 * starts auto-renewing monthly going forward.
 */
async function backfillSubscriptionsFlow(): Promise<void> {
  const groups = new Map<string, Expense>();
  for (const x of expenses) {
    if (!x.recurring || x.emi || x.subscription_id) continue;
    const key = `${x.description.toLowerCase()}|${x.paid_by}|${x.category}|${x.mode}|${x.card.toLowerCase()}`;
    const existing = groups.get(key);
    if (!existing || x.date > existing.date) groups.set(key, x);
  }
  const toCreate = [...groups.values()].filter(
    (x) => !subscriptions.some((s) => s.active && s.description.toLowerCase() === x.description.toLowerCase() && s.paid_by === x.paid_by),
  );
  if (!toCreate.length) {
    alert("Nothing to fix — every recurring expense already has an active auto-renew rule.");
    return;
  }
  const names = toCreate.map((x) => `${x.description} (${x.paid_by})`).join(", ");
  if (
    !confirm(
      `Enable monthly auto-renew for ${toCreate.length} existing recurring expense${toCreate.length === 1 ? "" : "s"}?\n\n${names}\n\nIf any of these should renew yearly instead, stop it under "Manage" afterward and re-add it with the right frequency.`,
    )
  )
    return;
  for (const x of toCreate) {
    await dbInsertSubscription({
      description: x.description,
      amount: x.amount,
      category: x.category,
      paid_by: x.paid_by,
      mode: x.mode,
      card: x.card,
      note: x.note,
      frequency: "monthly",
      next_due: addInterval(x.date, "monthly", 1),
      active: true,
      skip_next: false,
      split: x.split,
      share_p0: x.share_p0,
      share_p1: x.share_p1,
    });
  }
  await runSubscriptionCatchup();
  alert(`Enabled auto-renew for ${toCreate.length} expense${toCreate.length === 1 ? "" : "s"}.`);
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

  $("fSubFreq").innerHTML =
    `<button type="button" class="chip" data-freq="monthly">Monthly</button>` +
    `<button type="button" class="chip" data-freq="yearly">Annually</button>`;
  $("fSubFreq").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-freq]");
    if (!b) return;
    sel.subFrequency = b.dataset["freq"] as SubscriptionFrequency;
    paintChips();
  });
  $("subManageBtn").addEventListener("click", () => switchTab("subscriptions"));

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
  $<HTMLSelectElement>("filterMode").addEventListener("change", (e) => {
    filterMode = (e.target as HTMLSelectElement).value;
    renderFilterBox();
  });
  $<HTMLSelectElement>("filterCard").addEventListener("change", (e) => {
    filterCard = (e.target as HTMLSelectElement).value;
    renderFilterBox();
  });
  $<HTMLInputElement>("filterFrom").addEventListener("change", (e) => {
    filterFrom = (e.target as HTMLInputElement).value;
    renderFilterBox();
  });
  $<HTMLInputElement>("filterTo").addEventListener("change", (e) => {
    filterTo = (e.target as HTMLInputElement).value;
    renderFilterBox();
  });
  $("useCycleBtn").addEventListener("click", () => {
    const card = filterCard !== "All" ? cards.find((c) => c.name === filterCard) : undefined;
    if (!card?.billing_date) return;
    const cycle = currentCardCycle(card.billing_date);
    filterFrom = cycle.start;
    filterTo = cycle.end;
    renderFilterBox();
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
    const skipSub = target.closest<HTMLElement>("[data-skip-sub]");
    if (skipSub) {
      void skipSubscriptionFlow(skipSub.dataset["skipSub"]!);
      return;
    }
    const stopSub = target.closest<HTMLElement>("[data-stop-sub]");
    if (stopSub) {
      void stopSubscriptionFlow(stopSub.dataset["stopSub"]!);
      return;
    }
    const resumeSub = target.closest<HTMLElement>("[data-resume-sub]");
    if (resumeSub) {
      void resumeSubscriptionFlow(resumeSub.dataset["resumeSub"]!);
      return;
    }
    const subPayerBtn = target.closest<HTMLElement>("[data-sub-payer]");
    if (subPayerBtn) {
      void updateSubscriptionFieldFlow(subPayerBtn.dataset["subPayer"]!, "paid_by", subPayerBtn.dataset["payerName"]!);
      return;
    }
    const subFreqBtn = target.closest<HTMLElement>("[data-sub-freq]");
    if (subFreqBtn) {
      void updateSubscriptionFieldFlow(subFreqBtn.dataset["subFreq"]!, "frequency", subFreqBtn.dataset["freqValue"]!);
      return;
    }
    const payerFilterBtn = target.closest<HTMLElement>("[data-payer-filter]");
    if (payerFilterBtn) {
      subsPayerFilter = payerFilterBtn.dataset["payerFilter"]!;
      renderSubscriptionsPage();
      return;
    }
    const subRow = target.closest<HTMLElement>("[data-sub-row]");
    if (subRow) {
      const id = subRow.dataset["subRow"]!;
      subsExpandedId = subsExpandedId === id ? null : id;
      renderSubscriptionsPage();
      return;
    }
    const row = target.closest<HTMLElement>("[data-row]");
    if (row) {
      openRow = openRow === row.dataset["row"] ? null : (row.dataset["row"] ?? null);
      renderLists();
    }
  });

  document.addEventListener("change", (e) => {
    const target = e.target as HTMLInputElement;
    const billing = target.closest<HTMLInputElement>("[data-card-billing]");
    if (billing) {
      void updateCardDateFlow(billing.dataset["cardBilling"]!, "billing_date", billing.value);
      return;
    }
    const due = target.closest<HTMLInputElement>("[data-card-due]");
    if (due) {
      void updateCardDateFlow(due.dataset["cardDue"]!, "due_date", due.value);
      return;
    }
    const subField = target.closest<HTMLElement>("[data-sub-field]");
    if (subField) {
      const id = subField.dataset["subId"]!;
      const field = subField.dataset["subField"]!;
      void updateSubscriptionFieldFlow(id, field, (subField as HTMLInputElement | HTMLSelectElement).value);
      return;
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
  $("subFreqWrap").classList.toggle("hidden", !(sel.recurring && !sel.emi));
  $("fSubFreq")
    .querySelectorAll<HTMLElement>(".chip")
    .forEach((b) => b.classList.toggle("on", b.dataset["freq"] === sel.subFrequency));
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
  sel.subFrequency = "monthly";
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
  $("pane-subscriptions").classList.toggle("hidden", t !== "subscriptions");
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
          (c) => `<div class="box" style="padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="font-weight:600;font-size:13.5px">${esc(c.name)}</div>
          <button type="button" class="linkbtn" style="color:var(--danger)" data-del-card="${c.id}">Delete</button>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <div style="flex:1">
            <div class="label" style="font-size:11px">Billing date</div>
            <input class="input" type="number" min="1" max="31" placeholder="e.g. 5" data-card-billing="${c.id}" value="${c.billing_date ?? ""}" />
          </div>
          <div style="flex:1">
            <div class="label" style="font-size:11px">Due date</div>
            <input class="input" type="number" min="1" max="31" placeholder="e.g. 25" data-card-due="${c.id}" value="${c.due_date ?? ""}" />
          </div>
        </div>
      </div>`,
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

const SUB_ICONS: Record<string, string> = {
  home: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9h12v-9"/></svg>`,
  wifi: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5.5 12.3a10 10 0 0 1 13 0"/><path d="M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none"/></svg>`,
  play: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5-6-3.5Z" fill="currentColor" stroke="none"/></svg>`,
  cloud: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H7a4 4 0 1 1 .4-7.98A5.5 5.5 0 0 1 18 12.5a3.5 3.5 0 0 1-.5 6.5Z"/></svg>`,
  heart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5c-3.8-2.3-7.5-5.4-7.5-9.4a4.1 4.1 0 0 1 7.5-2.3 4.1 4.1 0 0 1 7.5 2.3c0 4-3.7 7.1-7.5 9.4Z"/></svg>`,
  spark: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 3c.6 3.8 1.4 5.6 3 7.2 1.6 1.6 3.4 2.4 7.2 3-3.8.6-5.6 1.4-7.2 3-1.6 1.6-2.4 3.4-3 7.2-.6-3.8-1.4-5.6-3-7.2-1.6-1.6-3.4-2.4-7.2-3 3.8-.6 5.6-1.4 7.2-3 1.6-1.6 2.4-3.4 3-7.2Z"/></svg>`,
};
const CATEGORY_ICON: Record<string, keyof typeof SUB_ICONS> = {
  "Rent & Home": "home",
  "Utilities & Bills": "wifi",
  Entertainment: "play",
  Subscriptions: "cloud",
  Health: "heart",
};
const CHEVRON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
const INFO_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>`;

function iconFor(category: string): string {
  return SUB_ICONS[CATEGORY_ICON[category] ?? "spark"]!;
}

let subsExpandedId: string | null = null;
let subsPayerFilter = "All";

function pendingBackfillCount(): number {
  const groups = new Map<string, Expense>();
  for (const x of expenses) {
    if (!x.recurring || x.emi || x.subscription_id) continue;
    const key = `${x.description.toLowerCase()}|${x.paid_by}|${x.category}|${x.mode}|${x.card.toLowerCase()}`;
    const existing = groups.get(key);
    if (!existing || x.date > existing.date) groups.set(key, x);
  }
  return [...groups.values()].filter(
    (x) => !subscriptions.some((s) => s.active && s.description.toLowerCase() === x.description.toLowerCase() && s.paid_by === x.paid_by),
  ).length;
}

function subscriptionRowHTML(s: Subscription): string {
  const expanded = subsExpandedId === s.id;
  const i = personIdx(s.paid_by, PEOPLE);
  const dueLabel = new Date(s.next_due + "T00:00").toLocaleDateString("en", { day: "numeric", month: "short" });
  const dueText = (s.skip_next ? "Skipping next, then " : "Due ") + dueLabel;
  let html = `<div class="row">
    <div class="rowmain" data-sub-row="${s.id}">
      <span class="rowbar" style="background:var(--p${i})"></span>
      <div class="iconc">${iconFor(s.category)}</div>
      <div style="flex:1;min-width:0">
        <div class="rowdesc">${esc(s.description)} <span style="color:var(--p${i});font-weight:700;font-size:11.5px">&middot; ${esc(s.paid_by)}</span></div>
        <div class="rowsub">${s.frequency === "monthly" ? "Monthly" : "Yearly"} &middot; ${dueText}</div>
      </div>
      <div class="rowamt">${CURRENCY}${fmt(s.amount)}</div>
      <div class="chev${expanded ? " open" : ""}">${CHEVRON_SVG}</div>
    </div>`;
  if (expanded) {
    html += `<div class="detail">
      <div class="two">
        <div>
          <div class="label">Description</div>
          <input class="input" data-sub-id="${s.id}" data-sub-field="description" value="${esc(s.description)}" />
        </div>
        <div>
          <div class="label">Amount</div>
          <input class="input mono" type="number" step="0.01" min="0.01" data-sub-id="${s.id}" data-sub-field="amount" value="${s.amount}" />
        </div>
      </div>
      <div style="margin-top:10px">
        <div class="label">Category</div>
        <select class="input" data-sub-id="${s.id}" data-sub-field="category">
          ${categories.map((c) => `<option ${c.name === s.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
        </select>
      </div>
      <div class="two" style="margin-top:10px">
        <div>
          <div class="label">Paid by</div>
          <div style="display:flex;gap:8px">
            ${PEOPLE.map(
              (p, idx) =>
                `<button type="button" class="chip ${s.paid_by === p.name ? `on c${idx}` : ""}" data-sub-payer="${s.id}" data-payer-name="${esc(p.name)}">${esc(p.name)}</button>`,
            ).join("")}
          </div>
        </div>
        <div>
          <div class="label">Frequency</div>
          <div style="display:flex;gap:8px">
            <button type="button" class="chip ${s.frequency === "monthly" ? "on" : ""}" data-sub-freq="${s.id}" data-freq-value="monthly">Monthly</button>
            <button type="button" class="chip ${s.frequency === "yearly" ? "on" : ""}" data-sub-freq="${s.id}" data-freq-value="yearly">Yearly</button>
          </div>
        </div>
      </div>
      <div style="margin-top:10px">
        <div class="label">Next due</div>
        <input class="input" type="date" data-sub-id="${s.id}" data-sub-field="next_due" value="${s.next_due}" />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button type="button" class="smallbtn" data-skip-sub="${s.id}" ${s.skip_next ? "disabled" : ""}>${s.skip_next ? "Skipping…" : "Skip next"}</button>
        <button type="button" class="smallbtn" style="color:var(--danger)" data-stop-sub="${s.id}">Stop</button>
      </div>
    </div>`;
  }
  return html + `</div>`;
}

function stoppedSubscriptionRowHTML(s: Subscription): string {
  const i = personIdx(s.paid_by, PEOPLE);
  return `<div class="row">
    <div class="rowmain" style="opacity:.55;cursor:default">
      <span class="rowbar" style="background:var(--p${i})"></span>
      <div class="iconc">${iconFor(s.category)}</div>
      <div style="flex:1;min-width:0">
        <div class="rowdesc">${esc(s.description)} <span style="color:var(--p${i});font-weight:700;font-size:11.5px">&middot; ${esc(s.paid_by)}</span></div>
        <div class="rowsub">${s.frequency === "monthly" ? "Monthly" : "Yearly"} &middot; ${CURRENCY}${fmt(s.amount)}</div>
      </div>
      <button type="button" class="smallbtn" data-resume-sub="${s.id}" style="flex:none">Resume</button>
    </div>
  </div>`;
}

function renderSubscriptionsPage(): void {
  const pending = pendingBackfillCount();
  $("subsBanner").innerHTML = pending
    ? `<div class="box" style="display:flex;gap:12px;align-items:flex-start;border:1.5px dashed var(--line);margin-bottom:16px">
        <div class="iconc">${INFO_SVG}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:13.5px">${pending} bill${pending === 1 ? "" : "s"} aren't auto-renewing yet</div>
          <div class="rowsub" style="margin-top:2px">Added before auto-renew existed &mdash; enable it once and they'll stop needing manual entry.</div>
        </div>
        <button type="button" class="smallbtn" id="backfillSubsBtn" style="flex:none">Fix now</button>
      </div>`
    : "";
  document.getElementById("backfillSubsBtn")?.addEventListener("click", () => void backfillSubscriptionsFlow());

  $("subsPayerFilter").innerHTML = ["All", ...PEOPLE.map((p) => p.name)]
    .map((name, idx) => {
      const on = subsPayerFilter === name;
      const cls = on ? (idx === 0 ? "on" : `on c${idx - 1}`) : "";
      return `<button type="button" class="chip ${cls}" data-payer-filter="${esc(name)}">${esc(name)}</button>`;
    })
    .join("");

  const visible = subsPayerFilter === "All" ? subscriptions : subscriptions.filter((s) => s.paid_by === subsPayerFilter);
  const active = visible.filter((s) => s.active);
  const stopped = visible.filter((s) => !s.active);

  $("subsActiveCount").textContent = String(active.length);
  $("subsActiveTotal").textContent = fmt(active.reduce((sum, s) => sum + Number(s.amount), 0));

  $("subsActiveList").innerHTML = active.length
    ? active.map(subscriptionRowHTML).join("")
    : `<div class="empty">No active bills${subsPayerFilter === "All" ? "" : ` for ${esc(subsPayerFilter)}`}.</div>`;

  $("subsStoppedWrap").innerHTML = stopped.length
    ? `<div class="label" style="margin-top:20px">Stopped</div><div class="listbox">${stopped.map(stoppedSubscriptionRowHTML).join("")}</div>`
    : "";
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
        ${x.emi ? `<span>EMI${x.emi_index && x.emi_months ? ` · ${x.emi_index}/${x.emi_months}` : x.emi_months ? ` · ${x.emi_months} months` : ""}</span>` : ""}
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

/** The last ~13 billing cycles for a card, oldest first. */
function cardCycles(billingDate: number): { start: string; end: string }[] {
  const [ty, tm] = todayStr().split("-").map(Number);
  const ends: string[] = [];
  // k starts one cycle earlier than we display, purely to derive the
  // oldest displayed cycle's start date from a real previous cycle-end.
  for (let k = -12; k <= 1; k++) {
    const total = tm! - 1 + k;
    const y = ty! + Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12 + 1;
    ends.push(cycleEndDate(y, m, billingDate));
  }
  const sorted = [...new Set(ends)].sort();
  return sorted.slice(1).map((end, i) => ({ end, start: dayAfter(sorted[i]!) }));
}

function dateLabel(d: string): string {
  return new Date(d + "T00:00").toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

/** The billing cycle a card's current statement is accumulating in. */
function currentCardCycle(billingDate: number): { start: string; end: string } {
  const cycles = cardCycles(billingDate);
  const today = todayStr();
  const idx = cycles.findIndex((c) => today <= c.end);
  return cycles[idx >= 0 ? idx : cycles.length - 1]!;
}

function renderFilterBox(): void {
  const modeSel = $<HTMLSelectElement>("filterMode");
  modeSel.innerHTML = `<option value="All">All payment modes</option>` + modes.map((m) => `<option value="${esc(m.name)}">${esc(m.name)}</option>`).join("");
  modeSel.value = filterMode === "All" || modes.some((m) => m.name === filterMode) ? filterMode : "All";
  filterMode = modeSel.value;

  const cardSel = $<HTMLSelectElement>("filterCard");
  cardSel.innerHTML = `<option value="All">All cards</option>` + cards.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");
  cardSel.value = filterCard === "All" || cards.some((c) => c.name === filterCard) ? filterCard : "All";
  filterCard = cardSel.value;

  const fromEl = $<HTMLInputElement>("filterFrom");
  const toEl = $<HTMLInputElement>("filterTo");
  if (!filterFrom) filterFrom = monthOf(todayStr()) + "-01";
  if (!filterTo) filterTo = todayStr();
  fromEl.value = filterFrom;
  toEl.value = filterTo;

  const selectedCard = filterCard !== "All" ? cards.find((c) => c.name === filterCard) : undefined;
  $("useCycleBtn").classList.toggle("hidden", !selectedCard?.billing_date);

  let dueInfo = "";
  if (selectedCard?.billing_date && selectedCard.due_date) {
    const cycle = currentCardCycle(selectedCard.billing_date);
    dueInfo = ` · current cycle due ${dateLabel(dueDateFor(cycle.end, selectedCard.billing_date, selectedCard.due_date))}`;
  }

  const rows = expenses.filter((x) => {
    if (filterMode !== "All" && x.mode !== filterMode) return false;
    if (filterCard !== "All" && x.card.toLowerCase() !== filterCard.toLowerCase()) return false;
    if (filterFrom && x.date < filterFrom) return false;
    if (filterTo && x.date > filterTo) return false;
    return true;
  });
  const total = rows.reduce((s, x) => s + Number(x.amount), 0);
  $("filterBody").innerHTML = `
    <div class="mono" style="font-size:26px;font-weight:700">${CURRENCY}${fmt(total)}</div>
    <div class="rowsub" style="margin-top:2px">${rows.length} ${rows.length === 1 ? "expense" : "expenses"}${dueInfo}</div>
    <div class="listbox" style="margin-top:12px">${rows.map(rowHTML).join("") || `<div class="empty">No expenses match these filters.</div>`}</div>`;
}

function renderInsights(): void {
  fillMonthSelect($<HTMLSelectElement>("insMonth"), insMonth);
  renderFilterBox();
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
  renderSubscriptionsPage();
  renderAudit();
}

export function initApp(): void {
  wireAuth();
}
