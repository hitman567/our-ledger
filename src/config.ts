import type { Person } from "./types";

function requireEnv(key: string): string {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(
      `Missing ${key}. Copy .env.example to .env and fill in your Supabase project's values.`,
    );
  }
  return value;
}

export const SUPABASE_URL = requireEnv("VITE_SUPABASE_URL");
export const SUPABASE_ANON_KEY = requireEnv("VITE_SUPABASE_ANON_KEY");

export const PEOPLE: [Person, Person] = [
  { name: "Ayush", email: "tiwary.tiwaryayush@gmail.com" },
  { name: "Archie", email: "ranaarchana181@gmail.com" },
];

export const CURRENCY = "₹";

export const CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transport",
  "Rent & Home",
  "Utilities & Bills",
  "Subscriptions",
  "Shopping",
  "Health",
  "Entertainment",
  "Travel",
  "Other",
];

export const MODES = ["Cash", "UPI", "Debit Card", "Credit Card", "Bank Transfer", "Other"];
export const CARD_MODES = ["Debit Card", "Credit Card"];

export const FIELD_LABELS: Record<string, string> = {
  amount: "Amount",
  description: "Description",
  date: "Date",
  category: "Category",
  paid_by: "Paid by",
  mode: "Mode",
  card: "Card",
  recurring: "Recurring",
  note: "Note",
  split: "Split",
  share_p0: `${PEOPLE[0].name}'s share`,
  share_p1: `${PEOPLE[1].name}'s share`,
  emi: "EMI",
  emi_months: "EMI tenure (months)",
};
