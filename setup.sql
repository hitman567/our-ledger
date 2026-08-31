-- Shared Expense Tracker : run this once in Supabase SQL Editor.
-- Safe to run again if you already ran an earlier version.

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  amount numeric not null check (amount > 0),
  description text not null,
  date date not null,
  category text not null default 'Other',
  paid_by text not null,
  mode text not null default 'UPI',
  card text default '',
  recurring boolean not null default false,
  note text default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Splitting an expense between the two of you (added later; safe to run again)
alter table expenses add column if not exists split boolean not null default false;
alter table expenses add column if not exists share_p0 numeric;
alter table expenses add column if not exists share_p1 numeric;

-- EMIs: a recurring expense with a fixed tenure (added later; safe to run again)
alter table expenses add column if not exists emi boolean not null default false;
alter table expenses add column if not exists emi_months integer;

alter table expenses enable row level security;

drop policy if exists "authenticated users full access" on expenses;
create policy "authenticated users full access"
  on expenses for all
  to authenticated
  using (true)
  with check (true);

-- Live sync (ignore error if already added)
do $$ begin
  alter publication supabase_realtime add table expenses;
exception when duplicate_object then null;
end $$;

-- ============ CARDS ============
-- User-managed list of card names (add/delete from the app). Matching is
-- case-insensitive so "HDFC Swiggy" and "HDFC swiggy" can't both exist.

create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists cards_name_lower_idx on cards (lower(name));

alter table cards enable row level security;

drop policy if exists "authenticated users full access" on cards;
create policy "authenticated users full access"
  on cards for all
  to authenticated
  using (true)
  with check (true);

do $$ begin
  alter publication supabase_realtime add table cards;
exception when duplicate_object then null;
end $$;

-- Pick up any card names already sitting in expenses (e.g. from before this
-- table existed), deduped case-insensitively, keeping the earliest casing.
insert into cards (name)
select distinct on (lower(card)) card
from expenses
where card is not null and trim(card) <> ''
order by lower(card), created_at asc
on conflict (lower(name)) do nothing;

-- ============ PAYMENT MODES ============
-- User-managed list of payment methods. is_card marks methods that should
-- prompt for a card name (Debit Card, Credit Card, ...).

create table if not exists payment_modes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_card boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_modes_name_lower_idx on payment_modes (lower(name));

alter table payment_modes enable row level security;

drop policy if exists "authenticated users full access" on payment_modes;
create policy "authenticated users full access"
  on payment_modes for all
  to authenticated
  using (true)
  with check (true);

do $$ begin
  alter publication supabase_realtime add table payment_modes;
exception when duplicate_object then null;
end $$;

insert into payment_modes (name, is_card) values
  ('Cash', false),
  ('UPI', false),
  ('Debit Card', true),
  ('Credit Card', true),
  ('Bank Transfer', false),
  ('Other', false)
on conflict (lower(name)) do nothing;

-- ============ CATEGORIES ============
-- User-managed list of expense categories (add from the app). Matching is
-- case-insensitive so "Groceries" and "groceries" can't both exist.

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists categories_name_lower_idx on categories (lower(name));

alter table categories enable row level security;

drop policy if exists "authenticated users full access" on categories;
create policy "authenticated users full access"
  on categories for all
  to authenticated
  using (true)
  with check (true);

do $$ begin
  alter publication supabase_realtime add table categories;
exception when duplicate_object then null;
end $$;

insert into categories (name) values
  ('Food & Dining'),
  ('Groceries'),
  ('Transport'),
  ('Rent & Home'),
  ('Utilities & Bills'),
  ('Subscriptions'),
  ('Shopping'),
  ('Health'),
  ('Entertainment'),
  ('Travel'),
  ('Other')
on conflict (lower(name)) do nothing;

-- Pick up any category names already sitting in expenses (e.g. from before
-- this table existed), deduped case-insensitively, keeping the earliest casing.
insert into categories (name)
select distinct on (lower(category)) category
from expenses
where category is not null and trim(category) <> ''
order by lower(category), created_at asc
on conflict (lower(name)) do nothing;

-- ============ SUBSCRIPTIONS ============
-- Recurring-expense rules (monthly or yearly). The app checks these on
-- load and automatically inserts the next due occurrence(s) into
-- `expenses`, so a subscription doesn't need to be re-entered by hand
-- each period. Stopping a subscription just marks it inactive; past
-- occurrences it already created stay in the ledger.

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  amount numeric not null check (amount > 0),
  category text not null,
  paid_by text not null,
  mode text not null,
  card text default '',
  note text default '',
  frequency text not null check (frequency in ('monthly', 'yearly')),
  next_due date not null,
  active boolean not null default true,
  skip_next boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

drop policy if exists "authenticated users full access" on subscriptions;
create policy "authenticated users full access"
  on subscriptions for all
  to authenticated
  using (true)
  with check (true);

do $$ begin
  alter publication supabase_realtime add table subscriptions;
exception when duplicate_object then null;
end $$;

-- Which EMI installment a row is (e.g. 3 of 12), and which subscription
-- rule auto-generated a row, if any (added later; safe to run again).
alter table expenses add column if not exists emi_index integer;
alter table expenses add column if not exists subscription_id uuid references subscriptions(id) on delete set null;

-- Belt-and-braces: even if two clients catch up on the same subscription
-- at the same moment, it can't produce two rows for the same date.
create unique index if not exists expenses_subscription_date_idx
  on expenses (subscription_id, date)
  where subscription_id is not null;

-- ============ AUDIT LOG ============
-- Every add, edit, and delete is recorded automatically by the
-- database itself. The app can only READ this log, never change it.

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  happened_at timestamptz not null default now(),
  action text not null,
  expense_id uuid,
  changed_by uuid,
  changed_by_email text,
  old_data jsonb,
  new_data jsonb
);

alter table audit_log enable row level security;

drop policy if exists "audit read only" on audit_log;
create policy "audit read only"
  on audit_log for select
  to authenticated
  using (true);
-- No insert/update/delete policies: the log cannot be tampered with from the app.

create or replace function log_expense_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_log (action, expense_id, changed_by, changed_by_email, old_data, new_data)
  values (
    TG_OP,
    coalesce(new.id, old.id),
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', ''),
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end
$$;

drop trigger if exists expenses_audit on expenses;
create trigger expenses_audit
  after insert or update or delete on expenses
  for each row execute function log_expense_change();
