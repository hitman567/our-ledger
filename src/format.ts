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
