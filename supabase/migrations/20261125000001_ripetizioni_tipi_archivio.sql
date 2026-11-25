-- Calendar: skip or change a single repetition, event types (sport, visits,
-- school), what to bring, who drives. Chores: an end date, so a chore can be
-- archived or changed from today on without rewriting its history.
-- Members: removing someone no longer deletes the events they created.

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

-- Removing a member keeps the events they created for the family.
alter table public.events alter column created_by drop not null;
alter table public.events drop constraint events_created_by_fkey;
alter table public.events add constraint events_created_by_fkey
  foreign key (created_by) references public.members (id) on delete set null;

alter table public.events
  -- Days (family time zone) on which a repetition was cancelled.
  add column skipped_dates date[] not null default '{}',
  add column kind text not null default 'impegno' check (kind in ('impegno', 'sport', 'visita', 'scuola')),
  -- What to bring: bag, documents, kit...
  add column bring text check (bring is null or length(bring) <= 300),
  -- Who takes them there; any family member.
  add column driver_id uuid references public.members (id) on delete set null;

-- The old version has fewer parameters; replace it rather than add an overload.
drop function public.save_event(uuid, text, timestamptz, timestamptz, boolean, text, text, text,
  smallint[], date, integer[], boolean, uuid[]);

-- Creates or updates an event and who it is for in one transaction.
-- With p_split_from, the new event replaces part of an existing repeating one:
--   'only'      cancels that one repetition (p_split_date) of the original;
--   'following' ends the original the day before p_split_date.
-- security invoker: the row level security policies still decide what the caller may do.
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
  p_member_ids uuid[],
  p_kind text default 'impegno',
  p_bring text default null,
  p_driver_id uuid default null,
  p_split_from uuid default null,
  p_split_date date default null,
  p_split_mode text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_orig uuid;
begin
  if p_split_from is not null then
    if p_id is not null or p_split_date is null or p_split_mode not in ('only', 'following') then
      raise exception 'Richiesta non valida' using errcode = '22023';
    end if;
    if p_split_mode = 'only' then
      update events set
        skipped_dates = array(select distinct d from unnest(array_append(skipped_dates, p_split_date)) d order by d),
        updated_at = now()
      where id = p_split_from and recurrence <> 'none'
      returning id into v_orig;
    else
      update events set recurrence_until = p_split_date - 1, updated_at = now()
      where id = p_split_from and recurrence <> 'none'
      returning id into v_orig;
    end if;
    if v_orig is null then
      raise exception 'Impegno non trovato o non modificabile' using errcode = '42501';
    end if;
  end if;

  if p_id is null then
    insert into events (title, starts_at, ends_at, all_day, location, notes, recurrence,
                        recurrence_weekdays, recurrence_until, reminder_minutes,
                        remind_evening_before, kind, bring, driver_id, created_by)
    values (p_title, p_starts_at, p_ends_at, p_all_day, nullif(trim(p_location), ''),
            nullif(trim(p_notes), ''), p_recurrence, p_recurrence_weekdays, p_recurrence_until,
            coalesce(p_reminder_minutes, '{}'), p_remind_evening_before, coalesce(p_kind, 'impegno'),
            nullif(trim(p_bring), ''), p_driver_id, my_member_id())
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
      kind = coalesce(p_kind, 'impegno'),
      bring = nullif(trim(p_bring), ''),
      driver_id = p_driver_id,
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

-- Cancels (p_skip true) or restores one repetition of a repeating event.
create function public.skip_occurrence(p_id uuid, p_date date, p_skip boolean default true) returns void
language plpgsql security invoker set search_path = public as $$
begin
  update events set
    skipped_dates = case
      when p_skip then array(select distinct d from unnest(array_append(skipped_dates, p_date)) d order by d)
      else array_remove(skipped_dates, p_date)
    end,
    updated_at = now()
  where id = p_id and recurrence <> 'none';
  if not found then
    raise exception 'Impegno non trovato o non modificabile' using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Chores
-- ---------------------------------------------------------------------------

-- Last day a recurring chore counts. Null = no end. Archiving sets it to yesterday.
alter table public.chores add column ends_on date;
alter table public.chores add constraint chores_ends_on_check check (ends_on is null or ends_on >= starts_on - 1);

-- Changes who does a chore or when, from today on: the old chore ends
-- yesterday (its past ticks stay as they were) and a new one starts today,
-- taking over today's and future ticks. Parents only.
-- security definer because it moves ticks made by the son; the parent check is explicit.
create function public.change_chore_from_today(
  p_id uuid,
  p_title text,
  p_assigned_to uuid,
  p_schedule text,
  p_weekdays smallint[],
  p_due_on date,
  p_ends_on date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Europe/Rome')::date;
  v_old chores%rowtype;
  v_new uuid;
begin
  if not is_parent() or not is_son(p_assigned_to) then
    raise exception 'Solo un genitore può farlo' using errcode = '42501';
  end if;
  select * into v_old from chores where id = p_id for update;
  if not found then
    raise exception 'Faccenda non trovata' using errcode = '42501';
  end if;

  -- Nothing in the past to keep: change it in place.
  if v_old.starts_on >= v_today or v_old.schedule = 'once' then
    update chores set title = p_title, assigned_to = p_assigned_to, schedule = p_schedule,
      weekdays = p_weekdays, due_on = p_due_on, ends_on = p_ends_on
    where id = p_id;
    return p_id;
  end if;

  update chores set ends_on = v_today - 1 where id = p_id;
  insert into chores (title, assigned_to, schedule, weekdays, due_on, starts_on, ends_on, created_by)
  values (p_title, p_assigned_to, p_schedule, p_weekdays, p_due_on, v_today, p_ends_on, my_member_id())
  returning id into v_new;
  insert into chore_completions (chore_id, due_on, done_by, done_at)
  select v_new, due_on, done_by, done_at from chore_completions where chore_id = p_id and due_on >= v_today;
  delete from chore_completions where chore_id = p_id and due_on >= v_today;
  return v_new;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.save_event from public, anon;
grant execute on function public.save_event to authenticated;
revoke all on function public.skip_occurrence from public, anon;
grant execute on function public.skip_occurrence to authenticated;
revoke all on function public.change_chore_from_today from public, anon;
grant execute on function public.change_chore_from_today to authenticated;
