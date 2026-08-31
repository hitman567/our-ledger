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
