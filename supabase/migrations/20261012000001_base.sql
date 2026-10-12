-- Family members, roles and the calendar.
-- Every rule about who can see or change what lives here, in row level
-- security, so it holds even if someone bypasses the app.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

create table public.members (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null check (length(trim(name)) > 0),
  role text not null check (role in ('genitore', 'figlio')),
  color text not null default '#2f6f4f' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

create unique index members_email_key on public.members (lower(email));

-- The member row of whoever is signed in, matched on the verified login email.
-- security definer so it can read members without recursing into its own policy.
create function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members
  where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create function public.is_parent() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and role = 'genitore'
  )
$$;

alter table public.members enable row level security;

create policy "family reads members" on public.members
  for select to authenticated using (public.my_member_id() is not null);

create policy "parents add members" on public.members
  for insert to authenticated with check (public.is_parent());

create policy "parents edit members" on public.members
  for update to authenticated using (public.is_parent()) with check (public.is_parent());

create policy "parents remove members" on public.members
  for delete to authenticated using (public.is_parent() and id <> public.my_member_id());

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  location text,
  notes text,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  -- ISO weekdays, 1 = Monday ... 7 = Sunday
  recurrence_weekdays smallint[] check (recurrence_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  recurrence_until date,
  reminder_minutes integer[] not null default '{}',
  remind_evening_before boolean not null default false,
  created_by uuid not null references public.members (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);

create index events_starts_at_idx on public.events (starts_at);

-- Who an event is for. No rows means the whole family.
create table public.event_members (
  event_id uuid not null references public.events (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  primary key (event_id, member_id)
);

alter table public.events enable row level security;
alter table public.event_members enable row level security;

create policy "family reads events" on public.events
  for select to authenticated using (public.my_member_id() is not null);

create policy "family adds events" on public.events
  for insert to authenticated with check (created_by = public.my_member_id());

create policy "creator or parent edits events" on public.events
  for update to authenticated
  using (public.is_parent() or created_by = public.my_member_id())
  with check (public.is_parent() or created_by = public.my_member_id());

create policy "creator or parent removes events" on public.events
  for delete to authenticated
  using (public.is_parent() or created_by = public.my_member_id());

create policy "family reads event members" on public.event_members
  for select to authenticated using (public.my_member_id() is not null);

create policy "creator or parent sets event members" on public.event_members
  for all to authenticated
  using (exists (
    select 1 from public.events e
    where e.id = event_id and (public.is_parent() or e.created_by = public.my_member_id())
  ))
  with check (exists (
    select 1 from public.events e
    where e.id = event_id and (public.is_parent() or e.created_by = public.my_member_id())
  ));

-- Creates or updates an event and who it is for in one transaction.
-- security invoker: the policies above still decide what the caller may do.
create function public.save_event(
  p_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_all_day boolean,
  p_location text,
  p_notes text,
  p_recurrence text,
  p_recurrence_weekdays smallint[],
  p_recurrence_until date,
  p_reminder_minutes integer[],
  p_remind_evening_before boolean,
  p_member_ids uuid[]
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into events (title, starts_at, ends_at, all_day, location, notes, recurrence,
                        recurrence_weekdays, recurrence_until, reminder_minutes,
                        remind_evening_before, created_by)
    values (p_title, p_starts_at, p_ends_at, p_all_day, nullif(trim(p_location), ''),
            nullif(trim(p_notes), ''), p_recurrence, p_recurrence_weekdays, p_recurrence_until,
            coalesce(p_reminder_minutes, '{}'), p_remind_evening_before, my_member_id())
    returning id into v_id;
  else
    update events set
      title = p_title,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      all_day = p_all_day,
      location = nullif(trim(p_location), ''),
      notes = nullif(trim(p_notes), ''),
      recurrence = p_recurrence,
      recurrence_weekdays = p_recurrence_weekdays,
      recurrence_until = p_recurrence_until,
      reminder_minutes = coalesce(p_reminder_minutes, '{}'),
      remind_evening_before = p_remind_evening_before,
      updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Impegno non trovato o non modificabile' using errcode = '42501';
    end if;
    delete from event_members where event_id = v_id;
  end if;

  insert into event_members (event_id, member_id)
  select v_id, m from unnest(coalesce(p_member_ids, '{}')) as m;

  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Push notifications
-- ---------------------------------------------------------------------------

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "own push subscriptions" on public.push_subscriptions
  for all to authenticated
  using (member_id = public.my_member_id())
  with check (member_id = public.my_member_id());

-- Reminders already sent, so the scheduler never sends one twice.
-- Only the send-reminders function (service role) touches it.
create table public.sent_reminders (
  key text primary key,
  sent_at timestamptz not null default now()
);

alter table public.sent_reminders enable row level security;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users only, never anonymous visitors.
-- ---------------------------------------------------------------------------

revoke all on public.members, public.events, public.event_members,
  public.push_subscriptions, public.sent_reminders from anon;
grant select, insert, update, delete on public.members, public.events,
  public.event_members, public.push_subscriptions to authenticated;
revoke all on function public.save_event from public, anon;
grant execute on function public.save_event to authenticated;
grant execute on function public.my_member_id, public.is_parent to authenticated;
