-- Security rules for members and the calendar.
-- Each check raises an exception on failure; psql runs with ON_ERROR_STOP.

\set ON_ERROR_STOP on

-- Seed as superuser: two parents, two sons.
insert into members (id, email, name, role) values
  ('00000000-0000-0000-0000-000000000001', 'laura@example.com', 'Laura', 'genitore'),
  ('00000000-0000-0000-0000-000000000002', 'emanuele@example.com', 'Emanuele', 'genitore'),
  ('00000000-0000-0000-0000-000000000003', 'diego@example.com', 'Diego', 'figlio'),
  ('00000000-0000-0000-0000-000000000004', 'alessio@example.com', 'Alessio', 'figlio');

create function pg_temp.login(email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('email', email)::text, false);
$$;

create function pg_temp.expect_denied(sql text, label text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAIL: % was allowed', label;
exception when insufficient_privilege or check_violation then
  raise notice 'ok: % denied', label;
end $$;

create function pg_temp.expect(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- A son creates an event for himself (case-insensitive email match).
select pg_temp.login('DIEGO@example.com');
set role authenticated;
select pg_temp.expect(my_member_id() = '00000000-0000-0000-0000-000000000003', 'email match ignores case');
select pg_temp.expect(not is_parent(), 'son is not a parent');
select save_event(null, 'Calcetto', '2026-10-14 17:00+02', '2026-10-14 18:00+02', false, ' ', null,
  'weekly', '{3}', null, '{60}', true, array['00000000-0000-0000-0000-000000000003'::uuid]);
select pg_temp.expect((select count(*) from events) = 1, 'son sees his event');
select pg_temp.expect((select location from events) is null, 'blank location stored as null');
select pg_temp.expect((select count(*) from event_members) = 1, 'event members saved');
select pg_temp.expect_denied(
  $$ insert into events (title, starts_at, ends_at, created_by)
     values ('Finto', now(), now(), '00000000-0000-0000-0000-000000000004') $$,
  'son creating an event as his brother');
select pg_temp.expect_denied(
  $$ insert into members (email, name, role) values ('x@example.com', 'X', 'genitore') $$,
  'son adding a member');
update members set role = 'genitore' where email = 'diego@example.com';
reset role;
select pg_temp.expect((select role from members where email = 'diego@example.com') = 'figlio', 'son cannot promote himself');

-- His brother can see it but cannot change or delete it.
select pg_temp.login('alessio@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from events) = 1, 'brother sees family events');
update events set title = 'Cambiato';
delete from events;
select pg_temp.expect((select title from events) = 'Calcetto', 'brother cannot edit or delete');
select pg_temp.expect_denied(
  $$ select save_event((select id from events), 'Cambiato', now(), now(), false, null, null,
       'none', null, null, '{}', false, '{}') $$,
  'brother editing through save_event');
delete from event_members;
select pg_temp.expect((select count(*) from event_members) = 1, 'brother cannot remove event members');
reset role;

-- A parent can edit anyone's event and manage members.
select pg_temp.login('laura@example.com');
set role authenticated;
select pg_temp.expect(is_parent(), 'mother is a parent');
select save_event((select id from events), 'Calcetto (spostato)', '2026-10-15 17:00+02', '2026-10-15 18:00+02',
  false, 'Palestra', null, 'weekly', '{4}', '2026-12-31', '{30}', false,
  array['00000000-0000-0000-0000-000000000003'::uuid, '00000000-0000-0000-0000-000000000004'::uuid]);
select pg_temp.expect((select title from events) = 'Calcetto (spostato)', 'parent edits a son''s event');
select pg_temp.expect((select count(*) from event_members) = 2, 'parent replaces event members');
insert into members (email, name, role) values ('valentino@example.com', 'Valentino', 'figlio');
select pg_temp.expect((select count(*) from members) = 5, 'parent adds a member');
delete from members where email = 'laura@example.com';
select pg_temp.expect((select count(*) from members) = 5, 'parent cannot delete herself');
reset role;

-- Someone who signed in but is not in the family sees nothing.
select pg_temp.login('stranger@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from members) = 0, 'stranger sees no members');
select pg_temp.expect((select count(*) from events) = 0, 'stranger sees no events');
select pg_temp.expect_denied(
  $$ select save_event(null, 'Spam', now(), now(), false, null, null, 'none', null, null, '{}', false, '{}') $$,
  'stranger creating an event');
reset role;

-- Anonymous visitors have no access at all.
set role anon;
select pg_temp.expect_denied($$ select * from members $$, 'anonymous reading members');
select pg_temp.expect_denied($$ select * from events $$, 'anonymous reading events');
reset role;

-- Push subscriptions are private to their owner.
insert into push_subscriptions (member_id, endpoint, p256dh, auth)
values ('00000000-0000-0000-0000-000000000001', 'https://push.example/laura', 'k', 'a');
select pg_temp.login('diego@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from push_subscriptions) = 0, 'son cannot see mother''s subscription');
insert into push_subscriptions (member_id, endpoint, p256dh, auth)
values ('00000000-0000-0000-0000-000000000003', 'https://push.example/diego', 'k', 'a');
select pg_temp.expect((select count(*) from push_subscriptions) = 1, 'son saves his own subscription');
select pg_temp.expect_denied(
  $$ insert into push_subscriptions (member_id, endpoint, p256dh, auth)
     values ('00000000-0000-0000-0000-000000000001', 'https://push.example/fake', 'k', 'a') $$,
  'son saving a subscription for his mother');
select pg_temp.expect_denied($$ select * from sent_reminders $$, 'reading sent reminders');
reset role;


-- Household expenses: parents only.
select pg_temp.login('laura@example.com');
set role authenticated;
insert into expenses (amount_cents, category, spent_on, paid_by, created_by)
values (4250, 'spesa', '2026-10-13', '00000000-0000-0000-0000-000000000002', my_member_id());
select pg_temp.expect((select count(*) from expenses) = 1, 'parent adds an expense');
select pg_temp.expect_denied(
  $$ insert into expenses (amount_cents, category, created_by)
     values (100, 'spesa', '00000000-0000-0000-0000-000000000002') $$,
  'parent adding an expense as the other parent');
select pg_temp.expect_denied(
  $$ insert into expenses (amount_cents, category, created_by) values (100, 'gioielli', my_member_id()) $$,
  'expense with an unknown category');
select pg_temp.expect_denied(
  $$ insert into expenses (amount_cents, category, created_by) values (0, 'spesa', my_member_id()) $$,
  'expense of zero');
reset role;

select pg_temp.login('emanuele@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from expenses) = 1, 'other parent sees expenses');
update expenses set amount_cents = 4300;
select pg_temp.expect((select amount_cents from expenses) = 4300, 'other parent edits an expense');
reset role;

select pg_temp.login('diego@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from expenses) = 0, 'son cannot see expenses');
select pg_temp.expect_denied(
  $$ insert into expenses (amount_cents, category, created_by) values (100, 'svago', my_member_id()) $$,
  'son adding an expense');
update expenses set amount_cents = 1;
delete from expenses;
reset role;
select pg_temp.expect((select amount_cents from expenses) = 4300, 'son cannot edit or delete expenses');

-- Pocket money: parents record it, each son sees only his own.
select pg_temp.login('laura@example.com');
set role authenticated;
insert into allowances (member_id, amount_cents, given_on, created_by) values
  ('00000000-0000-0000-0000-000000000003', 1000, '2026-10-12', my_member_id()),
  ('00000000-0000-0000-0000-000000000004', 500, '2026-10-12', my_member_id());
select pg_temp.expect((select count(*) from allowances) = 2, 'parent records pocket money');
select pg_temp.expect_denied(
  $$ insert into allowances (member_id, amount_cents, created_by)
     values ('00000000-0000-0000-0000-000000000002', 1000, my_member_id()) $$,
  'pocket money for a parent');
select pg_temp.expect_denied(
  $$ update allowances set member_id = '00000000-0000-0000-0000-000000000002' $$,
  'moving pocket money to a parent');
reset role;

select pg_temp.login('diego@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from allowances) = 1, 'son sees only his own pocket money');
select pg_temp.expect((select amount_cents from allowances) = 1000, 'son sees his amount');
select pg_temp.expect_denied(
  $$ insert into allowances (member_id, amount_cents, created_by) values (my_member_id(), 5000, my_member_id()) $$,
  'son giving himself pocket money');
update allowances set amount_cents = 99999;
delete from allowances;
reset role;
select pg_temp.expect((select sum(amount_cents) from allowances) = 1500, 'son cannot edit or delete pocket money');

select pg_temp.login('stranger@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from expenses) = 0, 'stranger sees no expenses');
select pg_temp.expect((select count(*) from allowances) = 0, 'stranger sees no pocket money');
reset role;

set role anon;
select pg_temp.expect_denied($$ select * from expenses $$, 'anonymous reading expenses');
select pg_temp.expect_denied($$ select * from allowances $$, 'anonymous reading pocket money');
reset role;

-- Chores: parents assign them to sons, each son sees and ticks only his own.
select pg_temp.login('laura@example.com');
set role authenticated;
insert into chores (id, title, assigned_to, schedule, weekdays, created_by) values
  ('00000000-0000-0000-0000-0000000000c1', 'Lavastoviglie', '00000000-0000-0000-0000-000000000003', 'days', '{1,3,5}', my_member_id()),
  ('00000000-0000-0000-0000-0000000000c2', 'Portare giù la spazzatura', '00000000-0000-0000-0000-000000000004', 'daily', null, my_member_id());
select pg_temp.expect((select count(*) from chores) = 2, 'parent assigns chores');
select pg_temp.expect_denied(
  $$ insert into chores (title, assigned_to, schedule, created_by)
     values ('Bollette', '00000000-0000-0000-0000-000000000002', 'daily', my_member_id()) $$,
  'chore for a parent');
select pg_temp.expect_denied(
  $$ insert into chores (title, assigned_to, schedule, created_by)
     values ('Senza data', '00000000-0000-0000-0000-000000000003', 'once', my_member_id()) $$,
  'one-off chore without a due date');
select pg_temp.expect_denied(
  $$ insert into chores (title, assigned_to, schedule, weekdays, created_by)
     values ('Due giorni', '00000000-0000-0000-0000-000000000003', 'weekly', '{1,2}', my_member_id()) $$,
  'weekly chore with two deadlines');
reset role;

select pg_temp.login('diego@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from chores) = 1, 'son sees only his chores');
insert into chore_completions (chore_id, due_on, done_by)
values ('00000000-0000-0000-0000-0000000000c1', '2026-10-12', my_member_id());
select pg_temp.expect((select count(*) from chore_completions) = 1, 'son ticks his chore');
select pg_temp.expect_denied(
  $$ insert into chore_completions (chore_id, due_on, done_by)
     values ('00000000-0000-0000-0000-0000000000c2', '2026-10-12', my_member_id()) $$,
  'son ticking his brother''s chore');
select pg_temp.expect_denied(
  $$ insert into chores (title, assigned_to, schedule, created_by)
     values ('Niente', my_member_id(), 'daily', my_member_id()) $$,
  'son creating a chore');
update chores set title = 'Fatto da solo';
delete from chores;
reset role;
select pg_temp.expect((select count(*) from chores) = 2, 'son cannot edit or delete chores');
select pg_temp.expect((select title from chores where id = '00000000-0000-0000-0000-0000000000c1') = 'Lavastoviglie', 'son cannot rename chores');

select pg_temp.login('alessio@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from chore_completions) = 0, 'brother cannot see completions of others');
delete from chore_completions;
reset role;
select pg_temp.expect((select count(*) from chore_completions) = 1, 'brother cannot untick others');

select pg_temp.login('emanuele@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from chore_completions) = 1, 'parent sees who did what');
delete from chore_completions;
select pg_temp.expect((select count(*) from chore_completions) = 0, 'parent unticks a chore');
reset role;

select pg_temp.login('stranger@example.com');
set role authenticated;
select pg_temp.expect((select count(*) from chores) = 0, 'stranger sees no chores');
reset role;
set role anon;
select pg_temp.expect_denied($$ select * from chores $$, 'anonymous reading chores');
reset role;
