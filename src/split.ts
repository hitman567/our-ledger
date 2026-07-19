import { esc, fmt } from "./format";
import type { Expense, Person, SplitShares } from "./types";

export function personIdx(paidBy: string, people: readonly [Person, Person]): 0 | 1 {
  return people[0].name === paidBy ? 0 : 1;
}

/**
 * Net all-time balance across every split expense.
 * Positive => people[1] owes people[0]; negative => people[0] owes people[1].
 */
export function computeBalance(rows: readonly Expense[], people: readonly [Person, Person]): number {
  let net = 0;
  for (const x of rows) {
    if (!x.split) continue;
    const payer = personIdx(x.paid_by, people);
    const s0 = Number(x.share_p0) || 0;
    const s1 = Number(x.share_p1) || 0;
    net += payer === 0 ? s1 : -s0;
  }
  return net;
}

export function balanceHTML(
  net: number,
  people: readonly [Person, Person],
  currency: string,
): string {
  if (Math.abs(net) < 0.005) {
    return `<div style="font-size:13.5px;text-align:center">You're all settled up</div>`;
  }
  const owes = net > 0 ? people[1] : people[0];
  const owed = net > 0 ? people[0] : people[1];
  return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:13.5px">
    <span><b>${esc(owes.name)}</b> owes <b>${esc(owed.name)}</b></span>
    <span class="mono" style="font-weight:700;font-size:16px">${currency}${fmt(Math.abs(net))}</span>
  </div>`;
}

export function splitLabel(x: Expense, people: readonly [Person, Person], currency: string): string {
  if (!x.split) return "";
  const payer = personIdx(x.paid_by, people);
  const other = payer === 0 ? 1 : 0;
  const shares: SplitShares = [Number(x.share_p0) || 0, Number(x.share_p1) || 0];
  const owed = shares[other];
  if (owed <= 0) return "Split";
  return `${esc(people[other].name)} owes ${esc(people[payer].name)} ${currency}${fmt(owed)}`;
}

export function equalShares(amount: number): SplitShares {
  const half = amount / 2;
  return [half, half];
}

export function isCustomSplitValid(amount: number, s0: number, s1: number): boolean {
  if (!(amount > 0) || !(s0 >= 0) || !(s1 >= 0)) return false;
  return Math.abs(s0 + s1 - amount) < 0.01;
}
