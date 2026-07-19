import { PEOPLE } from "./config";
import type { Expense } from "./types";

export function exportCSV(expenses: readonly Expense[]): void {
  const head = `date,description,amount,category,paid_by,mode,card,recurring,note,split,${PEOPLE[0].name}_share,${PEOPLE[1].name}_share`;
  const rows = [...expenses]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) =>
      [
        x.date,
        x.description,
        x.amount,
        x.category,
        x.paid_by,
        x.mode,
        x.card || "",
        x.recurring ? "yes" : "no",
        x.note || "",
        x.split ? "yes" : "no",
        x.share_p0 ?? "",
        x.share_p1 ?? "",
      ]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
  const blob = new Blob([[head, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "expenses.csv";
  a.click();
}
