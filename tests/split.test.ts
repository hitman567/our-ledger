import { describe, expect, it } from "vitest";
import { equalShares, isCustomSplitValid, personIdx, personSpend, splitLabel } from "../src/split";
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
    emi: false,
    emi_months: null,
    emi_index: null,
    subscription_id: null,
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

describe("personSpend", () => {
  it("attributes the full amount to the payer when not split", () => {
    const x = expense({ amount: 100, paid_by: "Ayush", split: false });
    expect(personSpend(x, 0, PEOPLE)).toBe(100);
    expect(personSpend(x, 1, PEOPLE)).toBe(0);
  });

  it("attributes each person's own share when split, regardless of payer", () => {
    // Ayush pays 200, split equally -> each person's own spend is 100
    const x = expense({ amount: 200, paid_by: "Ayush", split: true, share_p0: 100, share_p1: 100 });
    expect(personSpend(x, 0, PEOPLE)).toBe(100);
    expect(personSpend(x, 1, PEOPLE)).toBe(100);
  });

  it("handles an uneven custom split", () => {
    const x = expense({ amount: 100, paid_by: "Archie", split: true, share_p0: 70, share_p1: 30 });
    expect(personSpend(x, 0, PEOPLE)).toBe(70);
    expect(personSpend(x, 1, PEOPLE)).toBe(30);
  });
});

describe("splitLabel", () => {
  it("is blank for a non-split expense", () => {
    expect(splitLabel(expense({ split: false }), PEOPLE, "₹")).toBe("");
  });
  it("shows each person's own share", () => {
    const x = expense({ amount: 200, paid_by: "Ayush", split: true, share_p0: 100, share_p1: 100 });
    expect(splitLabel(x, PEOPLE, "₹")).toBe("Split: Ayush ₹100 · Archie ₹100");
  });
});
