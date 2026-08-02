export interface Person {
  name: string;
  email: string;
}

export type SplitShares = [number, number];

/** A row from the `expenses` table. */
export interface Expense {
  id: string;
  amount: number;
  description: string;
  date: string; // YYYY-MM-DD
  category: string;
  paid_by: string;
  mode: string;
  card: string;
  recurring: boolean;
  note: string;
  created_by: string | null;
  created_at: string;
  split: boolean;
  share_p0: number | null;
  share_p1: number | null;
  emi: boolean;
  emi_months: number | null;
}

/** Fields the app writes when creating or editing an expense. */
export type ExpenseInput = Omit<Expense, "id" | "created_by" | "created_at">;

/** A row from the `cards` table — user-managed card names. */
export interface Card {
  id: string;
  name: string;
}

/** A row from the `payment_modes` table — user-managed payment methods. */
export interface PaymentMode {
  id: string;
  name: string;
  is_card: boolean;
}

export type AuditAction = "INSERT" | "UPDATE" | "DELETE";

/** A row from the read-only `audit_log` table. */
export interface AuditRow {
  id: number;
  happened_at: string;
  action: AuditAction;
  expense_id: string | null;
  changed_by: string | null;
  changed_by_email: string | null;
  old_data: Partial<Expense> | null;
  new_data: Partial<Expense> | null;
}

export type SplitMode = "no" | "equal" | "custom";

export type Tab = "add" | "history" | "insights" | "audit";

/** Transient state of the add/edit form. */
export interface FormSelection {
  paidBy: 0 | 1;
  mode: string;
  recurring: boolean;
  emi: boolean;
  split: boolean;
  splitMode: SplitMode;
}
