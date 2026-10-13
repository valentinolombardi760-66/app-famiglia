-- Household chores assigned to the sons.
-- Parents create and assign them; each son sees only his own and marks them done.

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 80),
  assigned_to uuid not null references public.members (id) on delete cascade,
  -- daily: every day; days: on the listed weekdays; weekly: once a week, by the
  -- listed weekday; once: a single time, by due_on.
  schedule text not null check (schedule in ('daily', 'days', 'weekly', 'once')),
  -- ISO weekdays, 1 = Monday ... 7 = Sunday.
  weekdays smallint[] check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  due_on date,
  -- First day the chore counts (recurring chores don't apply to the past).
  starts_on date not null default current_date,
  created_by uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now(),
  check (schedule <> 'once' or due_on is not null),
  check (schedule not in ('days', 'weekly') or cardinality(weekdays) > 0),
  check (schedule <> 'weekly' or cardinality(weekdays) = 1)
);

create index chores_assigned_to_idx on public.chores (assigned_to);

-- One row per chore occurrence marked done; `due_on` is the day it was due.
create table public.chore_completions (
  chore_id uuid not null references public.chores (id) on delete cascade,
  due_on date not null,
  done_by uuid references public.members (id) on delete set null,
  done_at timestamptz not null default now(),
  primary key (chore_id, due_on)
);

alter table public.chores enable row level security;
alter table public.chore_completions enable row level security;

create policy "parents and the assignee read chores" on public.chores
  for select to authenticated
  using (public.is_parent() or assigned_to = public.my_member_id());

create policy "parents add chores" on public.chores
  for insert to authenticated
  with check (public.is_parent() and public.is_son(assigned_to) and created_by = public.my_member_id());

create policy "parents edit chores" on public.chores
  for update to authenticated
  using (public.is_parent())
  with check (public.is_parent() and public.is_son(assigned_to));

create policy "parents remove chores" on public.chores
  for delete to authenticated using (public.is_parent());

-- Whether the signed-in member may see and tick this chore.
-- security definer so the check doesn't depend on the caller seeing the chore row.
create function public.can_tick_chore(p_chore_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chores c
    where c.id = p_chore_id and (public.is_parent() or c.assigned_to = public.my_member_id())
  )
$$;

create policy "parents and the assignee read completions" on public.chore_completions
  for select to authenticated using (public.can_tick_chore(chore_id));

create policy "parents and the assignee tick chores" on public.chore_completions
  for insert to authenticated
  with check (public.can_tick_chore(chore_id) and done_by = public.my_member_id());

create policy "parents and the assignee untick chores" on public.chore_completions
  for delete to authenticated using (public.can_tick_chore(chore_id));

revoke all on public.chores, public.chore_completions from anon;
grant select, insert, update, delete on public.chores to authenticated;
grant select, insert, delete on public.chore_completions to authenticated;
revoke all on function public.can_tick_chore from public, anon;
grant execute on function public.can_tick_chore to authenticated;
