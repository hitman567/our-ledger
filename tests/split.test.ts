import { describe, expect, it } from "vitest";
import {
  equalShares,
  flatmateLabel,
  isCustomSplitValid,
  isMyShareValid,
  myCost,
  personIdx,
  personSpend,
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
    emi: false,
    emi_months: null,
    emi_index: null,
    subscription_id: null,
    my_share: null,
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

  it("attributes only the payer's own share when a flatmate share is set", () => {
    // Ayush pays 300 for groceries shared with flatmates; only 100 is his.
    const x = expense({ amount: 300, paid_by: "Ayush", split: false, my_share: 100 });
    expect(personSpend(x, 0, PEOPLE)).toBe(100);
    expect(personSpend(x, 1, PEOPLE)).toBe(0);
  });
});

describe("myCost", () => {
  it("falls back to the full amount when no flatmate share is set", () => {
    expect(myCost(expense({ amount: 300, my_share: null }))).toBe(300);
  });
  it("uses the flatmate share when set", () => {
    expect(myCost(expense({ amount: 300, my_share: 100 }))).toBe(100);
  });
});

describe("isMyShareValid", () => {
  it("accepts a share that's a real slice of the total", () => {
    expect(isMyShareValid(300, 100)).toBe(true);
  });
  it("rejects a non-positive amount or share, or a share over the total", () => {
    expect(isMyShareValid(0, 100)).toBe(false);
    expect(isMyShareValid(300, 0)).toBe(false);
    expect(isMyShareValid(300, -50)).toBe(false);
    expect(isMyShareValid(300, 400)).toBe(false);
  });
  it("accepts a share equal to the full amount", () => {
    expect(isMyShareValid(300, 300)).toBe(true);
  });
});

describe("flatmateLabel", () => {
  it("is blank when no flatmate share is set", () => {
    expect(flatmateLabel(expense({ my_share: null }), "₹")).toBe("");
  });
  it("shows the card total, your share, and the flatmates' portion", () => {
    const x = expense({ amount: 300, my_share: 100 });
    expect(flatmateLabel(x, "₹")).toBe("Card total ₹300 · Your share ₹100 · Flatmates ₹200");
  });
  it("omits the flatmates' portion when the share covers the whole amount", () => {
    const x = expense({ amount: 300, my_share: 300 });
    expect(flatmateLabel(x, "₹")).toBe("Card total ₹300 · Your share ₹300");
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
