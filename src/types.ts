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
  /** Which installment this row is, e.g. 3 of 12 (EMIs only). */
  emi_index: number | null;
  /** The subscription rule that auto-generated this row, if any. */
  subscription_id: string | null;
}

/** Fields the app writes when creating or editing an expense. */
export type ExpenseInput = Omit<Expense, "id" | "created_by" | "created_at">;

/** A row from the `cards` table — user-managed card names. */
export interface Card {
  id: string;
  name: string;
  /** Day of month (1-31) the statement is generated, if known. */
  billing_date: number | null;
  /** Day of month (1-31) payment is due, if known. */
  due_date: number | null;
}

/** A row from the `payment_modes` table — user-managed payment methods. */
export interface PaymentMode {
  id: string;
  name: string;
  is_card: boolean;
}

/** A row from the `categories` table — user-managed expense categories. */
export interface Category {
  id: string;
  name: string;
}

export type SubscriptionFrequency = "monthly" | "yearly";

/**
 * A row from the `subscriptions` table — a recurring-expense rule the app
 * checks on load, automatically inserting the next due occurrence(s) into
 * `expenses` so it doesn't need to be re-entered by hand each period.
 */
export interface Subscription {
  id: string;
  description: string;
  amount: number;
  category: string;
  paid_by: string;
  mode: string;
  card: string;
  note: string;
  frequency: SubscriptionFrequency;
  next_due: string; // YYYY-MM-DD
  active: boolean;
  skip_next: boolean;
  split: boolean;
  share_p0: number | null;
  share_p1: number | null;
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
  subFrequency: SubscriptionFrequency;
  split: boolean;
  splitMode: SplitMode;
}
