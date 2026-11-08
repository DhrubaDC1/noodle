-- Daily AI call counter, one row per user per UTC day. Only the Edge Function (service_role) touches it.
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
-- No policies on purpose: the app can never read or write this table.
revoke all on public.ai_usage from anon, authenticated;
grant select, insert, update on public.ai_usage to service_role;

-- Counts one call and returns true, or returns false (without counting) once the user is at the cap.
-- A single INSERT .. ON CONFLICT is atomic, so parallel calls cannot slip past the cap.
create function public.take_ai_call(p_user uuid, p_cap integer)
returns boolean
language sql
volatile
set search_path = ''
as $$
  with hit as (
    insert into public.ai_usage as u (user_id, day, calls)
    select p_user, (now() at time zone 'utc')::date, 1
    where p_cap > 0
    on conflict (user_id, day) do update set calls = u.calls + 1 where u.calls < p_cap
    returning 1
  )
  select exists (select 1 from hit);
$$;

revoke all on function public.take_ai_call(uuid, integer) from public, anon, authenticated;
grant execute on function public.take_ai_call(uuid, integer) to service_role;
