import { esc, fmt } from "./format";
import type { Expense, Person, SplitShares } from "./types";

export function personIdx(paidBy: string, people: readonly [Person, Person]): 0 | 1 {
  return people[0].name === paidBy ? 0 : 1;
}

/**
 * How much of an expense's cost counts toward one person's own spending,
 * regardless of who fronted the payment. Split expenses attribute each
 * person's share to them directly; unsplit expenses attribute the full
 * amount to whoever paid.
 */
export function personSpend(x: Expense, i: 0 | 1, people: readonly [Person, Person]): number {
  if (!x.split) return personIdx(x.paid_by, people) === i ? Number(x.amount) || 0 : 0;
  return (i === 0 ? Number(x.share_p0) : Number(x.share_p1)) || 0;
}

export function splitLabel(x: Expense, people: readonly [Person, Person], currency: string): string {
  if (!x.split) return "";
  const shares: SplitShares = [Number(x.share_p0) || 0, Number(x.share_p1) || 0];
  return `Split: ${esc(people[0].name)} ${currency}${fmt(shares[0])} · ${esc(people[1].name)} ${currency}${fmt(shares[1])}`;
}

export function equalShares(amount: number): SplitShares {
  const half = amount / 2;
  return [half, half];
}

export function isCustomSplitValid(amount: number, s0: number, s1: number): boolean {
  if (!(amount > 0) || !(s0 >= 0) || !(s1 >= 0)) return false;
  return Math.abs(s0 + s1 - amount) < 0.01;
}
