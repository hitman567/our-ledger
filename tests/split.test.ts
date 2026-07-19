import { describe, expect, it } from "vitest";
import {
  computeBalance,
  equalShares,
  isCustomSplitValid,
  personIdx,
  splitLabel,
} from "../src/split";
import type { Expense, Person } from "../src/types";

const PEOPLE: [Person, Person] = [
  { name: "Ayush", email: "ayush@example.com" },
  { name: "Archie", email: "archie@example.com" },
];

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: "1",
    amount: 100,
    description: "test",
    date: "2026-07-19",
    category: "Other",
    paid_by: PEOPLE[0].name,
    mode: "UPI",
    card: "",
    recurring: false,
    note: "",
    created_by: null,
    created_at: "2026-07-19T00:00:00Z",
    split: false,
    share_p0: null,
    share_p1: null,
    ...overrides,
  };
}

describe("personIdx", () => {
  it("resolves the payer's index from their name", () => {
    expect(personIdx("Ayush", PEOPLE)).toBe(0);
    expect(personIdx("Archie", PEOPLE)).toBe(1);
  });
});

describe("equalShares", () => {
  it("splits an amount exactly in half", () => {
    expect(equalShares(200)).toEqual([100, 100]);
    expect(equalShares(99)).toEqual([49.5, 49.5]);
  });
});

describe("isCustomSplitValid", () => {
  it("accepts shares that sum to the total", () => {
    expect(isCustomSplitValid(100, 70, 30)).toBe(true);
  });
  it("rejects shares that don't sum to the total", () => {
    expect(isCustomSplitValid(100, 70, 20)).toBe(false);
  });
  it("rejects negative shares or a non-positive amount", () => {
    expect(isCustomSplitValid(100, -10, 110)).toBe(false);
    expect(isCustomSplitValid(0, 0, 0)).toBe(false);
  });
});

describe("computeBalance", () => {
  it("is zero with no split expenses", () => {
    const rows = [expense({ split: false })];
    expect(computeBalance(rows, PEOPLE)).toBe(0);
  });

  it("credits the payer the other person's share", () => {
    // Ayush pays 200, split equally -> Archie owes Ayush 100
    const rows = [expense({ amount: 200, paid_by: "Ayush", split: true, share_p0: 100, share_p1: 100 })];
    expect(computeBalance(rows, PEOPLE)).toBe(100);
  });

  it("nets opposite-direction split expenses against each other", () => {
    const rows = [
      expense({ amount: 200, paid_by: "Ayush", split: true, share_p0: 100, share_p1: 100 }),
      expense({ amount: 100, paid_by: "Archie", split: true, share_p0: 50, share_p1: 50 }),
    ];
    // Archie owed Ayush 100, now owes 50 less -> net 50
    expect(computeBalance(rows, PEOPLE)).toBe(50);
  });
});

describe("splitLabel", () => {
  it("is blank for a non-split expense", () => {
    expect(splitLabel(expense({ split: false }), PEOPLE, "₹")).toBe("");
  });
  it("names who owes whom", () => {
    const x = expense({ amount: 200, paid_by: "Ayush", split: true, share_p0: 100, share_p1: 100 });
    expect(splitLabel(x, PEOPLE, "₹")).toBe("Archie owes Ayush ₹100");
  });
});
