export function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function fmt(n: number | string): string {
  return Number(n).toLocaleString("en", { maximumFractionDigits: 2 });
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthOf(d: string): string {
  return d.slice(0, 7);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y!, m! - 1, 1).toLocaleString("en", { month: "short", year: "numeric" });
}

/**
 * Adds `count` billing periods to a YYYY-MM-DD date, clamping the day to
 * the target month's last day (e.g. Jan 31 + 1 month -> Feb 28/29).
 */
export function addInterval(dateStr: string, freq: "monthly" | "yearly", count: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const totalMonths = (freq === "yearly" ? 12 : 1) * count;
  const targetY = y! + Math.floor((m! - 1 + totalMonths) / 12);
  const targetM = ((((m! - 1 + totalMonths) % 12) + 12) % 12) + 1;
  const lastDay = new Date(targetY, targetM, 0).getDate();
  const targetD = Math.min(d!, lastDay);
  return `${targetY}-${String(targetM).padStart(2, "0")}-${String(targetD).padStart(2, "0")}`;
}

/**
 * The card billing-cycle end date (YYYY-MM-DD) for the statement generated
 * in calendar month y-m, clamping the billing day to that month's last day.
 */
export function cycleEndDate(y: number, m: number, billingDate: number): string {
  const d = Math.min(billingDate, new Date(y, m, 0).getDate());
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The calendar day after a YYYY-MM-DD date string. */
export function dayAfter(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d! + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * The payment due date for a statement whose cycle ends on `cycleEndStr`.
 * If the due day falls before-or-on the billing day (e.g. billing on the
 * 28th, due on the 15th), it's the 15th of the *next* month, not the same
 * one — that's how card statements normally work.
 */
export function dueDateFor(cycleEndStr: string, billingDate: number, dueDate: number): string {
  const y = Number(cycleEndStr.slice(0, 4));
  const m = Number(cycleEndStr.slice(5, 7));
  const monthsAhead = dueDate > billingDate ? 0 : 1;
  const totalMonths = m - 1 + monthsAhead;
  const targetY = y + Math.floor(totalMonths / 12);
  const targetM = ((totalMonths % 12) + 12) % 12 + 1;
  return cycleEndDate(targetY, targetM, dueDate);
}
