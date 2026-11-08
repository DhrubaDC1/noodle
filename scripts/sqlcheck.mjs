// Runs supabase/migrations/*.sql in PGlite (Postgres in WebAssembly, no Docker) with stand-ins for
// Supabase's roles and auth.uid(), and checks the daily cap, row-level security and sync_push.
// Run: npm run sqlcheck. `supabase test db` (pgTAP, needs Docker) is the check against the real stack.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;
`);
const dir = new URL('../supabase/migrations/', import.meta.url);
for (const file of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(file, dir), 'utf8'));

const A = '00000000-0000-0000-0000-0000000000a1';
const B = '00000000-0000-0000-0000-0000000000b2';
await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@example.com'), ('${B}', 'b@example.com')`);

// Run a query as a Supabase role (and user): RLS and grants apply exactly as for the app.
async function as(role, user, sql, params) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user ?? ''}', false)`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const fails = (promise, code) => assert.rejects(promise, (error) => (code ? error.code === code : true), `expected error ${code ?? ''}`);

// ---- ai_usage: the daily cap
const take = async (user, cap) => (await as('service_role', null, 'select public.take_ai_call($1, $2) as ok', [user, cap]))[0].ok;
assert.deepEqual([await take(A, 3), await take(A, 3), await take(A, 3), await take(A, 3)], [true, true, true, false], 'call 4 of 3 refused');
assert.equal((await db.query('select calls from public.ai_usage where user_id = $1', [A])).rows[0].calls, 3, 'a refused call is not counted');
assert.equal(await take(B, 3), true, 'another user has their own count');
assert.equal(await take(B, 0), false, 'a cap of 0 allows nothing');
await fails(as('authenticated', A, 'select public.take_ai_call($1, 5)', [A]), '42501');
await fails(as('anon', null, 'select public.take_ai_call($1, 5)', [A]), '42501');
await fails(as('authenticated', A, 'select * from public.ai_usage'), '42501');

// ---- sync
const T1 = '10000000-0000-0000-0000-000000000001';
const T2 = '10000000-0000-0000-0000-000000000002';
const thought = (id, text, updated, extra = {}) => ({ id, text, source: 'typed', status: 'open', created_at: 1000, updated_at: updated, deleted: 0, ...extra });
const push = (user, payload) => as('authenticated', user, 'select public.sync_push($1::jsonb)', [JSON.stringify(payload)]);
const mine = (user, table = 'thoughts') => as('authenticated', user, `select * from public.${table} order by 2`);

await push(A, { thoughts: [thought(T1, 'first', 100), thought(T2, 'second', 100)] });
let rows = await mine(A);
assert.equal(rows.length, 2);
assert.ok(Number(rows[0].synced_at) > 1.7e12, 'server stamps synced_at in epoch ms');
assert.equal(rows[0].user_id, A, 'user_id comes from the JWT, not the payload');

await push(A, { thoughts: [thought(T1, 'older edit', 50)] });
assert.equal((await mine(A))[0].text, 'first', 'an older update does not overwrite');
await push(A, { thoughts: [thought(T1, 'newer edit', 200)] });
const edited = (await mine(A))[0];
assert.equal(edited.text, 'newer edit', 'a newer update wins');
assert.ok(Number(edited.synced_at) >= Number(rows[0].synced_at), 'synced_at moves forward on update');
await push(A, { thoughts: [thought(T2, '', 300, { deleted: 1 })] });
assert.equal((await mine(A))[1].deleted, 1, 'a delete is a tombstone row');

await push(A, {
  analysis: [{ thought_id: T1, title: 'Edited', type: 'idea', tags: ['x'], entities: [], reminder_at: null, model: 'm', analyzed_at: 5, type_override: null, tags_override: null, updated_at: 5 }],
  links: [{ id: '20000000-0000-0000-0000-000000000001', from_id: T1, to_id: T2, relation: 'follow-up', reason: 'Because.', strength: 0.6, created_at: 5, updated_at: 5, deleted: 2 }],
});
assert.equal((await mine(A, 'analysis')).length, 1);
assert.equal((await mine(A, 'links'))[0].deleted, 2);

assert.equal((await mine(B)).length, 0, 'another user sees nothing');
await push(B, { thoughts: [thought(T1, 'B has the same id', 1)] });
assert.equal((await mine(B))[0].text, 'B has the same id');
assert.equal((await mine(A))[0].text, 'newer edit', 'same id for another user is a separate row');

await fails(as('authenticated', A, "delete from public.thoughts"), '42501');
await fails(as('authenticated', A, `insert into public.thoughts (user_id, id, text, source, status, created_at, updated_at) values ('${B}', gen_random_uuid(), 'x', 'typed', 'open', 1, 1)`), '42501');
await fails(push(A, { thoughts: [thought(T1, 'x', 999, { status: 'bogus' })] }), '23514');
await fails(push(A, { thoughts: Array.from({ length: 501 }, (_, i) => thought(`30000000-0000-0000-0000-${String(i).padStart(12, '0')}`, 'x', 1)) }), '22023');
await fails(as('anon', null, 'select public.sync_push($1::jsonb)', ['{}']), '42501');
await fails(as('authenticated', '', 'select public.sync_push($1::jsonb)', ['{}']), '42501');
assert.equal((await as('anon', null, 'select 1 as one'))[0].one, 1);
await fails(as('anon', null, 'select * from public.thoughts'), '42501');

console.log('sqlcheck ok');
