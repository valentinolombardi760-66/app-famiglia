-- Household expenses and pocket money.
-- Expenses: only parents can see or change them.
-- Pocket money: parents record it; each son sees only his own.
-- Amounts are stored in cents to avoid rounding errors.

-- ---------------------------------------------------------------------------
-- Household expenses
-- ---------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 10000000),
  category text not null check (category in ('spesa', 'bollette', 'auto', 'scuola', 'svago', 'altro')),
  spent_on date not null default current_date,
  paid_by uuid references public.members (id) on delete set null,
  note text,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);

create index expenses_spent_on_idx on public.expenses (spent_on);

alter table public.expenses enable row level security;

create policy "parents read expenses" on public.expenses
  for select to authenticated using (public.is_parent());

create policy "parents add expenses" on public.expenses
  for insert to authenticated
  with check (public.is_parent() and created_by = public.my_member_id());

create policy "parents edit expenses" on public.expenses
  for update to authenticated using (public.is_parent()) with check (public.is_parent());

create policy "parents remove expenses" on public.expenses
  for delete to authenticated using (public.is_parent());

-- ---------------------------------------------------------------------------
-- Pocket money
-- ---------------------------------------------------------------------------

create table public.allowances (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 10000000),
  given_on date not null default current_date,
  note text,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);

create index allowances_member_given_idx on public.allowances (member_id, given_on);

alter table public.allowances enable row level security;

-- Pocket money only goes to sons.
create function public.is_son(p_member_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where id = p_member_id and role = 'figlio')
$$;

create policy "parents and the son himself read allowances" on public.allowances
  for select to authenticated
  using (public.is_parent() or member_id = public.my_member_id());

create policy "parents add allowances" on public.allowances
  for insert to authenticated
  with check (public.is_parent() and public.is_son(member_id) and created_by = public.my_member_id());

create policy "parents edit allowances" on public.allowances
  for update to authenticated
  using (public.is_parent())
  with check (public.is_parent() and public.is_son(member_id));

create policy "parents remove allowances" on public.allowances
  for delete to authenticated using (public.is_parent());

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only, never anonymous visitors.
-- ---------------------------------------------------------------------------

revoke all on public.expenses, public.allowances from anon;
grant select, insert, update, delete on public.expenses, public.allowances to authenticated;
revoke all on function public.is_son from public, anon;
grant execute on function public.is_son to authenticated;
