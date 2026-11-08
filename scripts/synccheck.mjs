// Two phones and a fake server (same last-write-wins rule as the SQL sync_push): src/sync.js against
// src/db.js. Imported by selfcheck.mjs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as T from '../src/db.js';
import { ORPHAN_DELAY_MS, PUSH_BATCH, syncOnce, toRemote } from '../src/sync.js';

async function phone() {
  const raw = new DatabaseSync(':memory:');
  const d = {
    raw,
    execAsync: async (q) => raw.exec(q),
    runAsync: async (q, ...p) => raw.prepare(q).run(...p),
    getAllAsync: async (q, ...p) => raw.prepare(q).all(...p),
    getFirstAsync: async (q, ...p) => raw.prepare(q).get(...p) ?? null,
    withExclusiveTransactionAsync: async (task) => {
      raw.exec('BEGIN IMMEDIATE');
      try { await task(d); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  };
  await T.migrate(d);
  return d;
}

// What sync_push and the pull query do, for one user. A real server stamps synced_at with its own clock.
function server() {
  const tables = { thoughts: new Map(), analysis: new Map(), links: new Map() };
  const key = { thoughts: 'id', analysis: 'thought_id', links: 'id' };
  let clock = 1_800_000_000_000;
  return {
    tables, offline: false, pushes: 0,
    async push(payload) {
      if (this.offline) throw new Error('offline');
      this.pushes += 1;
      for (const [table, rows] of Object.entries(payload)) {
        assert.ok(rows.length <= 500);
        for (const row of rows) {
          const old = tables[table].get(row[key[table]]);
          if (!old || old.updated_at < row.updated_at) tables[table].set(row[key[table]], { ...row, synced_at: ++clock });
        }
      }
    },
    async pull(table, since, limit) {
      if (this.offline) throw new Error('offline');
      return [...tables[table].values()].filter((row) => row.synced_at > since).sort((a, b) => a.synced_at - b.synced_at).slice(0, limit);
    },
  };
}

const user = 'user-1';
const tick = () => new Promise((resolve) => setTimeout(resolve, 5)); // edits on different phones are never in the same millisecond
const base = Date.now() + 1000; // edit times used below are later than anything created before them
const analysisValue = (title, tags = ['trip']) => ({ title, type: 'todo', tags, entities: [], reminder_at: null });
async function analyse(db, id, title, tags) {
  const job = await db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = ? AND j.kind = 'analyze'", id);
  assert.ok(job, 'analyze job exists');
  assert.equal(await T.saveAnalysis(db, job, analysisValue(title, tags), 'test-model'), true);
}
const jobKinds = async (db, id) => (await db.getAllAsync('SELECT kind FROM jobs WHERE thought_id = ? ORDER BY kind', id)).map((row) => row.kind);

const srv = server();
const A = await phone();
const B = await phone();
const t1 = randomUUID();
const t2 = randomUUID();

// A saves and analyses a thought; B gets it with its analysis and only needs to embed it.
await T.addThought(A, t1, 'Book a flight to Sylhet');
await analyse(A, t1, 'Flight to Sylhet');
assert.deepEqual(await syncOnce(A, srv, user, 1000), { pushed: 2, pulled: 0 });
const first = await syncOnce(B, srv, user, 1000);
assert.equal(first.pushed, 0);
assert.equal((await T.getThought(B, t1)).text, 'Book a flight to Sylhet');
assert.equal((await T.getThought(B, t1)).title, 'Flight to Sylhet');
assert.deepEqual(await jobKinds(B, t1), ['embed'], 'only the local embedding is queued: no second AI call');
assert.equal((await T.searchThoughts(B, 'Sylhet')).length, 1, 'search index updated on the receiving phone');
assert.equal((await syncOnce(B, srv, user, 2000)).pushed >= 0, true);
const again = await syncOnce(A, srv, user, 2000);
assert.equal(again.pulled, 0, 'nothing new comes back');

// An edit on B reaches A; A's vector for the old text is dropped and a new one queued.
await A.runAsync("INSERT INTO embeddings(thought_id, vector, model, created_at) VALUES(?, x'00', 'm', 1)", t1);
await A.runAsync("DELETE FROM jobs WHERE thought_id = ? AND kind = 'embed'", t1);
await B.runAsync('UPDATE thoughts SET text = ?, updated_at = ? WHERE id = ?', 'Book a flight to Dhaka', base - 500, t1);
await syncOnce(B, srv, user, 3000);
await syncOnce(A, srv, user, 3000);
assert.equal((await T.getThought(A, t1)).text, 'Book a flight to Dhaka');
assert.equal((await A.getFirstAsync('SELECT COUNT(*) AS n FROM embeddings WHERE thought_id = ?', t1)).n, 0);
assert.ok((await jobKinds(A, t1)).includes('embed'));

// Both edit while apart: the later edit wins on both phones.
await A.runAsync('UPDATE thoughts SET text = ?, updated_at = ? WHERE id = ?', 'Edit from A', base, t1);
await B.runAsync('UPDATE thoughts SET text = ?, updated_at = ? WHERE id = ?', 'Edit from B', base + 1, t1);
for (const db of [A, B, A, B]) await syncOnce(db, srv, user, 4000);
assert.equal((await T.getThought(A, t1)).text, 'Edit from B');
assert.equal((await T.getThought(B, t1)).text, 'Edit from B');

// B was offline for a long time: its old edit is still delivered (pull is by the server's clock).
srv.offline = true;
await assert.rejects(syncOnce(B, srv, user, 4500), /offline/);
srv.offline = false;
await T.addThought(A, t2, 'Call Nadia');
await analyse(A, t2, 'Call Nadia', ['family']);
await syncOnce(A, srv, user, 5000);
await B.runAsync("INSERT INTO thoughts(id, text, created_at, updated_at) VALUES(?, 'Written offline long ago', 1, ?)", randomUUID(), base + 5);
await syncOnce(B, srv, user, 5000);
await syncOnce(A, srv, user, 5000);
assert.equal((await T.searchThoughts(A, 'offline')).length, 1, 'an edit with an old updated_at still reaches the other phone');

// Tag edits (overrides) travel; a reminder state stays per phone.
await tick();
await T.editAnalysis(B, t1, 'tags', ['mine']);
await T.setReminderState(A, t1, 'scheduled', 'notif-1');
await syncOnce(B, srv, user, 6000);
await syncOnce(A, srv, user, 6000);
const merged = await T.getThought(A, t1);
assert.deepEqual(JSON.parse(merged.tags), ['mine']);
assert.equal(merged.reminder_state, 'scheduled', 'reminder state is not overwritten by another phone');
assert.equal((await A.getFirstAsync('SELECT tags_override FROM analysis WHERE thought_id = ?', t1)).tags_override, '["mine"]');

// Links: created on A, removed on B, stays removed on A; a re-analysis replaces and revives the pair.
const linkJob = async (db, id, refresh = 0) => ({ ...(await db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = ? AND j.kind = 'link'", id)), refresh });
await A.runAsync("UPDATE jobs SET next_try_at = 0");
const linkId = randomUUID();
assert.equal(await T.saveLinks(A, await linkJob(A, t2), [{ id: t1, text: 'Edit from B', strength: 0.7 }], [{ id: linkId, candidate_id: t1, relation: 'follow-up', reason: 'Related.' }]), true);
await syncOnce(A, srv, user, 7000);
await syncOnce(B, srv, user, 7000);
assert.equal((await T.getLinkedThoughts(B, t1)).length, 1, 'link reached B');
await tick();
await T.removeLink(B, linkId);
await syncOnce(B, srv, user, 8000);
await syncOnce(A, srv, user, 8000);
assert.equal((await T.getLinkedThoughts(A, t2)).length, 0, 'removal reached A');
assert.equal((await T.deletedPairs(A, t2)).length, 1, 'and A remembers not to suggest it again');

await T.updateThought(A, t2, { text: 'Call Nadia tomorrow' }); // queues a link refresh
const refresh = await linkJob(A, t2, 1);
const second = randomUUID();
const third = randomUUID();
await T.saveLinks(A, refresh, [{ id: t1, text: 'Edit from B', strength: 0.7 }], [{ id: second, candidate_id: t1, relation: 'same-project', reason: 'Fresh.' }]);
assert.equal((await T.getLinkedThoughts(A, t2)).length, 0, 'a removed pair stays removed through a refresh');
await syncOnce(A, srv, user, 9000);
assert.equal(srv.tables.links.get(linkId).deleted, 1);

// A refresh soft-replaces live links (deleted = 2) so the replacement syncs, and a returning pair is revived.
const t3 = randomUUID();
await T.addThought(A, t3, 'Plan the wedding');
await A.runAsync("UPDATE jobs SET next_try_at = 0");
const l1 = randomUUID();
await T.saveLinks(A, await linkJob(A, t3), [{ id: t2, text: 'Call Nadia tomorrow', strength: 0.5 }], [{ id: l1, candidate_id: t2, relation: 'follow-up', reason: 'One.' }]);
await T.updateThought(A, t3, { text: 'Plan the wedding trip' });
await T.saveLinks(A, await linkJob(A, t3, 1), [], []);
assert.equal((await A.getFirstAsync('SELECT deleted FROM links WHERE id = ?', l1)).deleted, 2, 'replaced, not hard-deleted');
await T.updateThought(A, t3, { text: 'Plan the wedding trip again' });
await T.saveLinks(A, await linkJob(A, t3, 1), [{ id: t2, text: 'Call Nadia tomorrow', strength: 0.9 }], [{ id: randomUUID(), candidate_id: t2, relation: 'same-project', reason: 'Two.' }]);
const revived = await A.getAllAsync('SELECT id, deleted, reason FROM links WHERE id = ?', l1);
assert.deepEqual(revived.map((row) => [row.deleted, row.reason]), [[0, 'Two.']], 'the same pair comes back under its old id');

// Delete on A reaches B; its jobs go with it.
await syncOnce(A, srv, user, 9500);
await syncOnce(B, srv, user, 9500);
await tick();
await T.deleteThought(A, t3);
await syncOnce(A, srv, user, 9600);
await syncOnce(B, srv, user, 9600);
assert.equal(await T.getThought(B, t3), null);
assert.deepEqual(await jobKinds(B, t3), []);
assert.equal(srv.tables.thoughts.get(t3).text, '', 'the server keeps a tombstone, not the text');

// A thought that arrives without analysis is analysed by the receiving phone, but only after a delay,
// and not at all once the saving phone's analysis arrives.
const t4 = randomUUID();
await T.addThought(A, t4, 'Orphan thought');
await syncOnce(A, srv, user, 10_000);
await syncOnce(B, srv, user, 10_000);
const orphanJobs = await B.getAllAsync("SELECT kind, next_try_at FROM jobs WHERE thought_id = ? ORDER BY kind", t4);
assert.deepEqual(orphanJobs.map((row) => row.kind), ['analyze', 'embed', 'link']);
assert.equal(orphanJobs.find((row) => row.kind === 'analyze').next_try_at, 10_000 + ORPHAN_DELAY_MS);
await analyse(A, t4, 'Orphan', ['x']);
await syncOnce(A, srv, user, 11_000);
await syncOnce(B, srv, user, 11_000);
assert.ok(!(await jobKinds(B, t4)).includes('analyze'), 'analysis from the other phone cancels the local analyze job');

// Never leaves the phone: an untranscribed voice note, a row without a real UUID.
await T.addVoiceThought(A, randomUUID(), 'ExpoAudio/x.m4a', 1000);
await T.addThought(A, 'not-a-uuid', 'Legacy id');
await syncOnce(A, srv, user, 12_000);
assert.ok(![...srv.tables.thoughts.values()].some((row) => row.text === 'Legacy id' || row.source === 'voice' && row.text === ''));
assert.deepEqual(toRemote('thoughts', { id: 'x', text: 'secret', deleted: 1 }), { id: 'x', text: '', deleted: 1 });
assert.deepEqual(toRemote('analysis', { thought_id: 'x', tags: '["a"]', entities: '[]', tags_override: null }), { thought_id: 'x', tags: ['a'], entities: [], tags_override: null });

// Many rows go in batches; a failing push keeps the progress made and retries cleanly.
const bulk = await phone();
for (let i = 0; i < PUSH_BATCH * 2 + 50; i += 1) await T.addThought(bulk, randomUUID(), `bulk ${i}`);
const bulkServer = server();
const batches = [];
const flaky = { pull: (...args) => bulkServer.pull(...args), push: async (payload) => { batches.push(payload.thoughts.length); if (batches.length === 2) throw new Error('network'); return bulkServer.push(payload); } };
await assert.rejects(syncOnce(bulk, flaky, user, 13_000), /network/);
const rest = await syncOnce(bulk, bulkServer, user, 14_000);
assert.equal(bulkServer.tables.thoughts.size, PUSH_BATCH * 2 + 50, 'every thought arrived exactly once');
assert.ok(rest.pushed >= PUSH_BATCH + 50 && rest.pushed < PUSH_BATCH * 2 + 50 + PUSH_BATCH, 'the batch that failed was not skipped');
const fresh = await phone();
assert.equal((await syncOnce(fresh, bulkServer, user, 15_000)).pulled, PUSH_BATCH * 2 + 50);

// Signing in as someone else sends this phone's data to the new account, from the start.
const other = server();
const before = srv.tables.thoughts.size;
const moved = await syncOnce(A, other, 'user-2', 16_000);
assert.ok(moved.pushed >= before - 1, 'a different account starts from scratch');
assert.equal((await T.getSyncState(A)).user, 'user-2');
assert.equal(srv.tables.thoughts.size, before, 'and the first account is untouched');
