-- Phase 6 pass B: one copy of each user's thoughts, analysis and links, for syncing phones.
-- Every row belongs to one user (RLS). Conflicts: the row with the larger client updated_at wins.
-- synced_at is set by the server on every write; phones pull by it (a phone that was offline for a
-- week still pushes rows with an old updated_at, which a pull by updated_at would miss).

create function public.set_synced_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.synced_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end $$;

create table public.thoughts (
  user_id uuid not null references auth.users (id) on delete cascade,
  id uuid not null,
  text text not null check (char_length(text) <= 20000),
  source text not null check (source in ('typed', 'voice', 'share')),
  status text not null check (status in ('open', 'done', 'archived')),
  created_at bigint not null,
  updated_at bigint not null,
  deleted integer not null default 0 check (deleted in (0, 1)),
  synced_at bigint not null default 0,
  primary key (user_id, id)
);

create table public.analysis (
  user_id uuid not null references auth.users (id) on delete cascade,
  thought_id uuid not null,
  title text not null check (char_length(title) <= 200),
  type text not null check (type in ('idea', 'project', 'todo', 'memory', 'question')),
  tags jsonb not null check (jsonb_typeof(tags) = 'array'),
  entities jsonb not null check (jsonb_typeof(entities) = 'array'),
  reminder_at text,
  model text not null,
  analyzed_at bigint not null,
  type_override text check (type_override in ('idea', 'project', 'todo', 'memory', 'question')),
  tags_override jsonb check (jsonb_typeof(tags_override) = 'array'),
  updated_at bigint not null,
  synced_at bigint not null default 0,
  primary key (user_id, thought_id)
);

create table public.links (
  user_id uuid not null references auth.users (id) on delete cascade,
  id uuid not null,
  from_id uuid not null,
  to_id uuid not null,
  relation text not null check (relation in ('same-project', 'follow-up', 'similar-idea', 'contradicts')),
  reason text not null check (char_length(reason) <= 300),
  strength double precision not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted integer not null default 0 check (deleted in (0, 1, 2)), -- 1 = removed by the user, 2 = replaced by a re-analysis
  synced_at bigint not null default 0,
  primary key (user_id, id)
);

create index thoughts_pull on public.thoughts (user_id, synced_at);
create index analysis_pull on public.analysis (user_id, synced_at);
create index links_pull on public.links (user_id, synced_at);

create trigger thoughts_synced before insert or update on public.thoughts for each row execute function public.set_synced_at();
create trigger analysis_synced before insert or update on public.analysis for each row execute function public.set_synced_at();
create trigger links_synced before insert or update on public.links for each row execute function public.set_synced_at();

alter table public.thoughts enable row level security;
alter table public.analysis enable row level security;
alter table public.links enable row level security;

-- A user reads and writes only their own rows; nobody deletes (deletes are tombstones).
create policy thoughts_select on public.thoughts for select to authenticated using (user_id = (select auth.uid()));
create policy thoughts_insert on public.thoughts for insert to authenticated with check (user_id = (select auth.uid()));
create policy thoughts_update on public.thoughts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy analysis_select on public.analysis for select to authenticated using (user_id = (select auth.uid()));
create policy analysis_insert on public.analysis for insert to authenticated with check (user_id = (select auth.uid()));
create policy analysis_update on public.analysis for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy links_select on public.links for select to authenticated using (user_id = (select auth.uid()));
create policy links_insert on public.links for insert to authenticated with check (user_id = (select auth.uid()));
create policy links_update on public.links for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.thoughts, public.analysis, public.links from anon, authenticated;
grant select, insert, update on public.thoughts, public.analysis, public.links to authenticated;

-- Phones write through this one function (a batch of up to 500 rows per table), so a stale row
-- can never overwrite a newer one. SECURITY INVOKER: RLS still applies to every statement.
create function public.sync_push(payload jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if jsonb_typeof(payload) is distinct from 'object'
    or jsonb_array_length(coalesce(payload->'thoughts', '[]'::jsonb)) > 500
    or jsonb_array_length(coalesce(payload->'analysis', '[]'::jsonb)) > 500
    or jsonb_array_length(coalesce(payload->'links', '[]'::jsonb)) > 500 then
    raise exception 'bad payload' using errcode = '22023';
  end if;

  insert into public.thoughts as t (user_id, id, text, source, status, created_at, updated_at, deleted)
  select uid, r.id, r.text, r.source, r.status, r.created_at, r.updated_at, r.deleted
  from jsonb_to_recordset(coalesce(payload->'thoughts', '[]'::jsonb))
    as r (id uuid, text text, source text, status text, created_at bigint, updated_at bigint, deleted integer)
  on conflict (user_id, id) do update set
    text = excluded.text, source = excluded.source, status = excluded.status,
    updated_at = excluded.updated_at, deleted = excluded.deleted
  where t.updated_at < excluded.updated_at;

  insert into public.analysis as a (user_id, thought_id, title, type, tags, entities, reminder_at, model, analyzed_at, type_override, tags_override, updated_at)
  select uid, r.thought_id, r.title, r.type, r.tags, r.entities, r.reminder_at, r.model, r.analyzed_at, r.type_override, r.tags_override, r.updated_at
  from jsonb_to_recordset(coalesce(payload->'analysis', '[]'::jsonb))
    as r (thought_id uuid, title text, type text, tags jsonb, entities jsonb, reminder_at text, model text, analyzed_at bigint, type_override text, tags_override jsonb, updated_at bigint)
  on conflict (user_id, thought_id) do update set
    title = excluded.title, type = excluded.type, tags = excluded.tags, entities = excluded.entities,
    reminder_at = excluded.reminder_at, model = excluded.model, analyzed_at = excluded.analyzed_at,
    type_override = excluded.type_override, tags_override = excluded.tags_override, updated_at = excluded.updated_at
  where a.updated_at < excluded.updated_at;

  insert into public.links as l (user_id, id, from_id, to_id, relation, reason, strength, created_at, updated_at, deleted)
  select uid, r.id, r.from_id, r.to_id, r.relation, r.reason, r.strength, r.created_at, r.updated_at, r.deleted
  from jsonb_to_recordset(coalesce(payload->'links', '[]'::jsonb))
    as r (id uuid, from_id uuid, to_id uuid, relation text, reason text, strength double precision, created_at bigint, updated_at bigint, deleted integer)
  on conflict (user_id, id) do update set
    relation = excluded.relation, reason = excluded.reason, strength = excluded.strength,
    updated_at = excluded.updated_at, deleted = excluded.deleted
  where l.updated_at < excluded.updated_at;
end $$;

revoke all on function public.sync_push(jsonb) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
