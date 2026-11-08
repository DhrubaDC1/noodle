-- Run with: supabase test db   (needs Docker and `supabase start`)
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@example.com');

select has_function('public', 'take_ai_call', array['uuid', 'integer'], 'take_ai_call exists');

select ok(public.take_ai_call('00000000-0000-0000-0000-0000000000a1', 3), 'call 1 of 3 is allowed');
select ok(public.take_ai_call('00000000-0000-0000-0000-0000000000a1', 3), 'call 2 of 3 is allowed');
select ok(public.take_ai_call('00000000-0000-0000-0000-0000000000a1', 3), 'call 3 of 3 is allowed');
select ok(not public.take_ai_call('00000000-0000-0000-0000-0000000000a1', 3), 'call 4 is refused');
select is(
  (select calls from public.ai_usage where user_id = '00000000-0000-0000-0000-0000000000a1'),
  3, 'a refused call is not counted');

select ok(public.take_ai_call('00000000-0000-0000-0000-0000000000b2', 3), 'another user has their own count');
select ok(not public.take_ai_call('00000000-0000-0000-0000-0000000000b2', 0), 'a cap of 0 allows nothing');

select ok(
  not has_function_privilege('authenticated', 'public.take_ai_call(uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.take_ai_call(uuid, integer)', 'execute'),
  'the app cannot call take_ai_call');

select * from finish();
rollback;
