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
