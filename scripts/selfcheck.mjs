// Runs src/db.js against Node's built-in SQLite: node scripts/selfcheck.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as T from '../src/db.js';
import { analyzeThought, linkThought, parseAnalysis, parseLinks, retryDelay } from '../src/groq.js';
import { GROQ_MODEL } from '../src/config.js';
import { blobVector, cosineSimilarity, meaningWithoutWords, topSimilar, vectorBlob, VECTOR_SIZE } from '../src/similarity.js';

const raw = new DatabaseSync(':memory:');
const db = {
  execAsync: async (s) => raw.exec(s),
  runAsync: async (s, ...p) => raw.prepare(s).run(...p),
  getAllAsync: async (s, ...p) => raw.prepare(s).all(...p),
  getFirstAsync: async (s, ...p) => raw.prepare(s).get(...p) ?? null,
  withExclusiveTransactionAsync: async (task) => {
    raw.exec('BEGIN IMMEDIATE');
    try { await task(db); raw.exec('COMMIT'); }
    catch (error) { raw.exec('ROLLBACK'); throw error; }
  },
};

assert.equal(T.toFtsQuery('budget app!'), '"budget"* "app"*');
assert.equal(T.toFtsQuery('"OR NOT ('), '"OR"* "NOT"*');
assert.equal(T.toFtsQuery('  ?? '), '');

await T.migrate(db);
await T.migrate(db); // second run must be a no-op
assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, 3);
assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS count FROM jobs")).count, 0);

await T.addThought(db, 'a', 'Build a budgeting app for tracking spending');
await T.addThought(db, 'b', 'Call Rafi about the trip');
assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS count FROM jobs')).count, 6);
assert.equal((await T.listThoughts(db)).length, 2);

assert.deepEqual((await T.searchThoughts(db, 'budg')).map((r) => r.id), ['a']);
assert.deepEqual(await T.searchThoughts(db, ''), []);

const vector = new Float32Array(VECTOR_SIZE);
vector[0] = 0.6; vector[1] = 0.8;
const other = new Float32Array(VECTOR_SIZE);
other[0] = 1;
const opposite = new Float32Array(VECTOR_SIZE);
opposite[0] = -1;
assert.equal(cosineSimilarity(vector, vector), 1);
assert.ok(Math.abs(cosineSimilarity(vector, other) - 0.6) < 1e-6);
assert.equal(cosineSimilarity(vector, new Float32Array(VECTOR_SIZE)), 0);
const packed = new Uint8Array(vectorBlob(vector).length + 2);
packed.set(vectorBlob(vector), 1);
assert.deepEqual(blobVector(packed.subarray(1, -1)), vector, 'Float32 BLOB round-trip with byte offset');
assert.deepEqual(topSimilar(vector, [
  { id: 'near', vector: vectorBlob(vector) }, { id: 'mid', vector: vectorBlob(other) },
  { id: 'far', vector: vectorBlob(opposite) },
], 1, 0.45).map((row) => row.id), ['near']);
assert.deepEqual(topSimilar(vector, [
  { id: 'near', vector: vectorBlob(vector) }, { id: 'mid', vector: vectorBlob(other) },
  { id: 'far', vector: vectorBlob(opposite) },
], 8, 0.45).map((row) => row.id), ['near', 'mid']);
assert.deepEqual(meaningWithoutWords([{ id: 'near' }], [{ id: 'near' }, { id: 'mid' }, { id: 'mid' }]).map((row) => row.id), ['mid']);

assert.equal((await T.updateThought(db, 'b', { text: 'Call Nadia about the trip' })).changes, 1);
assert.equal((await T.updateThought(db, 'missing', { text: 'Never saved' })).changes, 0);
assert.equal((await T.searchThoughts(db, 'Rafi')).length, 0, 'old text leaves the index');
assert.equal((await T.searchThoughts(db, 'Nadia')).length, 1, 'new text is indexed');

const valid = JSON.stringify({ title: 'Trip with Nadia', type: 'todo', tags: ['travel', 'friends'], entities: ['Nadia'], reminder_at: null });
assert.equal(parseAnalysis(valid).type, 'todo');
assert.throws(() => parseAnalysis('{bad'), /Invalid JSON response/);
assert.throws(() => parseAnalysis(valid.replace('"todo"', '"unknown"')), /Invalid analysis response/);
assert.equal(retryDelay(0), 2000);
assert.equal(retryDelay(20), 3600000);
const realFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  assert.equal(request.model, GROQ_MODEL);
  assert.equal(request.reasoning_effort, 'low');
  assert.equal(request.response_format.json_schema.strict, true);
  assert.match(request.messages[0].content, /Asia\/Dhaka/);
  assert.match(request.messages[0].content, /travel/);
  return new Response(JSON.stringify({ choices: [{ message: { content: valid } }] }), { status: 200 });
};
assert.equal((await analyzeThought('fake-key', 'Trip with Nadia', ['travel'])).title, 'Trip with Nadia');
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body);
  assert.equal(request.response_format.json_schema.name, 'thought_links');
  assert.equal(request.messages[1].content.includes('candidate'), true);
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ links: [{ candidate_id: 'b', relation: 'follow-up', reason: 'Both concern the trip.' }] }) } }] }), { status: 200 });
};
assert.equal((await linkThought('fake-key', 'Trip with Nadia', [{ id: 'b', text: 'Call Nadia' }]))[0].relation, 'follow-up');
assert.throws(() => parseLinks('{bad', []), /Invalid JSON response/);
assert.throws(() => parseLinks(JSON.stringify({ links: [{ candidate_id: 'unknown', relation: 'follow-up', reason: 'Unknown.' }] }), [{ id: 'b' }]), /Invalid links response/);
globalThis.fetch = realFetch;

const embedJob = await T.dueJob(db, 'embed');
assert.equal(await T.saveEmbedding(db, embedJob, vector), true);
assert.deepEqual(blobVector((await db.getFirstAsync('SELECT vector FROM embeddings WHERE thought_id = ?', embedJob.thought_id)).vector), vector);
await T.saveEmbedding(db, await T.dueJob(db, 'embed'), other);
const linkJob = await db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = 'a' AND j.kind = 'link'");
const candidate = { id: 'b', text: 'Call Nadia about the trip', strength: 0.6 };
assert.equal(await T.saveLinks(db, linkJob, [candidate], [{ id: 'link-a-b', candidate_id: 'b', relation: 'similar-idea', reason: 'Both concern plans.' }]), true);
const linked = await T.getLinkedThoughts(db, 'b');
assert.equal(linked.length, 1, 'link visible from either thought');
await T.removeLink(db, linked[0].link_id);
assert.equal((await T.deletedPairs(db, 'a')).length, 1);
assert.equal((await T.getLinkedThoughts(db, 'a')).length, 0);
await T.saveLinks(db, await db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = 'b' AND j.kind = 'link'"), [{ id: 'a', text: 'Build a budgeting app for tracking spending', strength: 0.6 }], [{ id: 'link-b-a', candidate_id: 'a', relation: 'similar-idea', reason: 'Both concern plans.' }]);
assert.equal((await T.getLinkedThoughts(db, 'a')).length, 0, 'removed pair never re-suggested');

const job = await db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = 'a' AND j.kind = 'analyze'");
assert.equal(await T.saveAnalysis(db, job, parseAnalysis(JSON.stringify({ title: 'Budget plan', type: 'project', tags: ['money'], entities: [], reminder_at: null })), 'test-model'), true);
assert.equal((await T.searchThoughts(db, 'plan'))[0].id, 'a', 'AI title indexed');
assert.equal((await T.searchThoughts(db, 'money'))[0].id, 'a', 'AI tag indexed');
assert.equal((await T.topTags(db))[0].tag, 'money');
await T.editAnalysis(db, 'a', 'tags', ['personal-finance']);
await T.editAnalysis(db, 'a', 'type', 'idea');
await T.updateThought(db, 'a', { text: 'A better budgeting app' });
const next = await db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = 'a' AND j.kind = 'analyze'");
await T.saveAnalysis(db, next, parseAnalysis(JSON.stringify({ title: 'Better budget', type: 'project', tags: ['budget'], entities: [], reminder_at: null })), 'test-model');
assert.equal((await T.getThought(db, 'a')).type, 'idea', 'manual type survives reanalysis');
assert.deepEqual(JSON.parse((await T.getThought(db, 'a')).tags), ['personal-finance'], 'manual tags survive reanalysis');
assert.equal((await T.searchThoughts(db, 'finance'))[0].id, 'a', 'edited tag indexed');

await T.updateThought(db, 'b', { status: 'archived' });
assert.equal((await T.getThought(db, 'b')).text, 'Call Nadia about the trip', 'status change keeps text');
assert.equal((await T.listThoughts(db)).length, 1, 'archived hidden from list');
assert.equal((await T.searchThoughts(db, 'Nadia')).length, 1, 'archived still searchable');

await T.deleteThought(db, 'a');
assert.equal(await T.getThought(db, 'a'), null);
assert.equal((await T.searchThoughts(db, 'budget')).length, 0, 'deleted not searchable');

const old = new DatabaseSync(':memory:');
old.exec(`CREATE TABLE thoughts (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'typed', status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX thoughts_created ON thoughts(created_at);
  CREATE VIRTUAL TABLE thoughts_fts USING fts5(text, content='thoughts', content_rowid='seq');
  CREATE TRIGGER thoughts_ai AFTER INSERT ON thoughts BEGIN INSERT INTO thoughts_fts(rowid,text) VALUES(new.seq,new.text); END;
  CREATE TRIGGER thoughts_ad AFTER DELETE ON thoughts BEGIN INSERT INTO thoughts_fts(thoughts_fts,rowid,text) VALUES('delete',old.seq,old.text); END;
  CREATE TRIGGER thoughts_au AFTER UPDATE OF text ON thoughts BEGIN
    INSERT INTO thoughts_fts(thoughts_fts,rowid,text) VALUES('delete',old.seq,old.text);
    INSERT INTO thoughts_fts(rowid,text) VALUES(new.seq,new.text); END;
  INSERT INTO thoughts(id,text,created_at,updated_at) VALUES('old','An older thought',1,1);
  PRAGMA user_version = 1;`);
const oldDb = {
  execAsync: async (s) => old.exec(s),
  runAsync: async (s, ...p) => old.prepare(s).run(...p),
  getAllAsync: async (s, ...p) => old.prepare(s).all(...p),
  getFirstAsync: async (s, ...p) => old.prepare(s).get(...p) ?? null,
  withExclusiveTransactionAsync: async (task) => {
    old.exec('BEGIN IMMEDIATE');
    try { await task(oldDb); old.exec('COMMIT'); }
    catch (error) { old.exec('ROLLBACK'); throw error; }
  },
};
await T.migrate(oldDb);
assert.equal((await oldDb.getFirstAsync('PRAGMA user_version')).user_version, 3);
assert.equal((await T.searchThoughts(oldDb, 'older'))[0].id, 'old');
assert.equal((await oldDb.getFirstAsync('SELECT COUNT(*) AS count FROM jobs')).count, 3, 'old thought queued for every job');

const v2raw = new DatabaseSync(':memory:');
v2raw.exec(`CREATE TABLE thoughts (seq INTEGER PRIMARY KEY, id TEXT UNIQUE, text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'typed', status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE jobs (id TEXT PRIMARY KEY, thought_id TEXT NOT NULL, kind TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_try_at INTEGER NOT NULL, last_error TEXT, UNIQUE(thought_id,kind));
  INSERT INTO thoughts(id,text,created_at,updated_at) VALUES('phase2','Track my spending',1,1);
  PRAGMA user_version = 2;`);
const v2db = {
  execAsync: async (s) => v2raw.exec(s),
  runAsync: async (s, ...p) => v2raw.prepare(s).run(...p),
  getAllAsync: async (s, ...p) => v2raw.prepare(s).all(...p),
  getFirstAsync: async (s, ...p) => v2raw.prepare(s).get(...p) ?? null,
  withExclusiveTransactionAsync: async (task) => {
    v2raw.exec('BEGIN IMMEDIATE');
    try { await task(v2db); v2raw.exec('COMMIT'); }
    catch (error) { v2raw.exec('ROLLBACK'); throw error; }
  },
};
await T.migrate(v2db);
await T.migrate(v2db);
assert.equal((await v2db.getFirstAsync('PRAGMA user_version')).user_version, 3);
assert.deepEqual((await v2db.getAllAsync("SELECT kind FROM jobs ORDER BY kind")).map((row) => row.kind), ['embed', 'link']);
await T.addThought(v2db, 'new', 'A related thought');
const firstLinkJob = await v2db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = 'new' AND j.kind = 'link'");
await T.saveLinks(v2db, firstLinkJob, [{ id: 'phase2', text: 'Track my spending', strength: 0.8 }], [{ id: 'first-link', candidate_id: 'phase2', relation: 'similar-idea', reason: 'Both concern spending.' }]);
assert.equal((await v2db.getFirstAsync('SELECT COUNT(*) AS count FROM links WHERE deleted = 0')).count, 1);
await T.updateThought(v2db, 'new', { text: 'A different thought' });
const refreshJob = await v2db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = 'new' AND j.kind = 'link'");
assert.equal(refreshJob.refresh, 1);
await T.saveLinks(v2db, refreshJob, [], []);
assert.equal((await v2db.getFirstAsync('SELECT COUNT(*) AS count FROM links WHERE deleted = 0')).count, 0, 'edit refreshes active links');


const M = await import('../src/mapData.js');
const mapThoughts = Array.from({ length: 15 }, (_, i) => ({ id: String(i), type: i < 4 ? 'project' : 'idea', tags: JSON.stringify(i < 4 ? ['side-project', 'money'] : [`tag-${i}`]), status: 'open' }));
const mapTopics = M.topicsFrom([...mapThoughts, { id: 'deleted', tags: '["money"]', type: 'todo', deleted: 1 }, { id: 'archived', tags: '["money"]', type: 'todo', status: 'archived' }]);
assert.equal(mapTopics.length, 12);
assert.deepEqual(mapTopics[0], { tag: 'money', name: 'Money', count: 4, ids: ['0','1','2','3'], type: 'project' });
assert.equal(M.topicName('side-project'), 'Side projects');
const dense = [{ tag: 'a', ids: ['1','2'], count: 2 }, { tag: 'b', ids: ['1','2'], count: 2 }, { tag: 'c', ids: ['1'], count: 1 }, { tag: 'd', ids: ['1'], count: 1 }, { tag: 'e', ids: ['1'], count: 1 }];
const topicLinks = M.topicEdges(dense, [], 2);
assert.equal(topicLinks[0].strength, 2);
assert.ok(dense.every((t) => topicLinks.filter((e) => e.source === t.tag || e.target === t.tag).length <= 2));
const chain = Array.from({ length: 10 }, (_, i) => ({ id: String(i), status: 'open' }));
const chainLinks = Array.from({ length: 8 }, (_, i) => ({ from_id: '0', to_id: String(i+1), strength: 8-i, deleted: false })).concat([{ from_id: '1', to_id: '9', strength: 1, deleted: false }, { from_id: '2', to_id: '9', strength: 1, deleted: false }, { from_id: '1', to_id: '8', strength: 10, deleted: true }]);
const hood = M.neighbourhood('0', chain, chainLinks);
assert.equal(hood.nodes.filter((n) => n.hop === 1).length, 6);
assert.equal(hood.nodes.filter((n) => n.id === '9').length, 1);
assert.ok(hood.edges.filter((e) => e.hop === 2 && e.source === '1').length <= 2);
assert.ok(!hood.edges.some((e) => e.deleted));
assert.equal(M.noodlePath({ x: 0, y: 0 }, { x: 30, y: 0 }), 'M0 0C10 12 20 -12 30 0');
const positions = M.layoutMap(dense, topicLinks, 900, 700);
assert.deepEqual(positions.map(({ x,y }) => [x,y]), M.layoutMap(dense, topicLinks, 900, 700).map(({ x,y }) => [x,y]));
for (let i=0; i<positions.length; i++) for (let j=i+1; j<positions.length; j++) assert.ok(Math.hypot(positions[i].x-positions[j].x,positions[i].y-positions[j].y) >= positions[i].radius+positions[j].radius-0.1);

console.log('selfcheck ok');
