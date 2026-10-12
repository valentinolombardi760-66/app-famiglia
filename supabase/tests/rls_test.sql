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

