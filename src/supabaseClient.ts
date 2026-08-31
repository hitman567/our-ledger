import { createClient, type Session } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { AuditRow, Card, Category, Expense, ExpenseInput, PaymentMode, Subscription } from "./types";

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await db.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await db.auth.signOut();
}

export function onAuthStateChange(cb: (session: Session | null) => void): void {
  db.auth.onAuthStateChange((_evt, session) => cb(session));
}

export async function fetchExpenses(): Promise<{ data: Expense[]; error: string | null }> {
  const { data, error } = await db
    .from("expenses")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  return { data: (data as Expense[] | null) ?? [], error: error?.message ?? null };
}

export async function fetchAuditLog(): Promise<AuditRow[]> {
  const { data } = await db
    .from("audit_log")
    .select("*")
    .order("happened_at", { ascending: false })
    .limit(200);
  return (data as AuditRow[] | null) ?? [];
}

export async function insertExpense(rec: ExpenseInput): Promise<string | null> {
  const { error } = await db.from("expenses").insert(rec);
  return error ? error.message : null;
}

export async function insertExpensesBulk(recs: ExpenseInput[]): Promise<string | null> {
  const { error } = await db.from("expenses").insert(recs);
  return error ? error.message : null;
}

/** Used by the subscription catch-up: ignores a unique-violation, since
 * that just means another client already generated this occurrence. */
export async function insertGeneratedExpense(rec: ExpenseInput): Promise<string | null> {
  const { error } = await db.from("expenses").insert(rec);
  return error && error.code !== "23505" ? error.message : null;
}

export async function updateExpense(id: string, rec: ExpenseInput): Promise<string | null> {
  const { error } = await db.from("expenses").update(rec).eq("id", id);
  return error ? error.message : null;
}

export async function deleteExpense(id: string): Promise<string | null> {
  const { error } = await db.from("expenses").delete().eq("id", id);
  return error ? error.message : null;
}

export function subscribeToExpenseChanges(cb: () => void): void {
  db.channel("expenses-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, cb)
    .subscribe();
}

export async function fetchCards(): Promise<Card[]> {
  const { data } = await db.from("cards").select("*").order("name");
  return (data as Card[] | null) ?? [];
}

export async function insertCard(name: string): Promise<string | null> {
  const { error } = await db.from("cards").insert({ name });
  return error && error.code !== "23505" ? error.message : null;
}

export async function deleteCard(id: string): Promise<string | null> {
  const { error } = await db.from("cards").delete().eq("id", id);
  return error ? error.message : null;
}

export async function fetchPaymentModes(): Promise<PaymentMode[]> {
  const { data } = await db.from("payment_modes").select("*").order("name");
  return (data as PaymentMode[] | null) ?? [];
}

export async function insertPaymentMode(name: string, isCard: boolean): Promise<string | null> {
  const { error } = await db.from("payment_modes").insert({ name, is_card: isCard });
  return error && error.code !== "23505" ? error.message : null;
}

export async function deletePaymentMode(id: string): Promise<string | null> {
  const { error } = await db.from("payment_modes").delete().eq("id", id);
  return error ? error.message : null;
}

export async function fetchCategories(): Promise<Category[]> {
  const { data } = await db.from("categories").select("*").order("name");
  return (data as Category[] | null) ?? [];
}

export async function insertCategory(name: string): Promise<string | null> {
  const { error } = await db.from("categories").insert({ name });
  return error && error.code !== "23505" ? error.message : null;
}

export async function deleteCategory(id: string): Promise<string | null> {
  const { error } = await db.from("categories").delete().eq("id", id);
  return error ? error.message : null;
}

export async function fetchSubscriptions(): Promise<Subscription[]> {
  const { data } = await db.from("subscriptions").select("*").order("next_due");
  return (data as Subscription[] | null) ?? [];
}

export async function insertSubscription(rec: Omit<Subscription, "id">): Promise<string | null> {
  const { error } = await db.from("subscriptions").insert(rec);
  return error ? error.message : null;
}

export async function updateSubscription(id: string, patch: Partial<Subscription>): Promise<string | null> {
  const { error } = await db.from("subscriptions").update(patch).eq("id", id);
  return error ? error.message : null;
}

export function subscribeToLookupChanges(cb: () => void): void {
  db.channel("lookups-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "cards" }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "payment_modes" }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "categories" }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions" }, cb)
    .subscribe();
}
