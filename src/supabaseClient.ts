import { createClient, type Session } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import type { AuditRow, Expense, ExpenseInput } from "./types";

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
