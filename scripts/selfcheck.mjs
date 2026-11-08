// Runs src/db.js against Node's built-in SQLite: node scripts/selfcheck.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as T from '../src/db.js';
import { AiError, aiInfo, analyzeThought, linkThought, retryDelay, transcribeAudio } from '../src/ai.js';
import { LIMITS, parseAnalysis, parseLinks, validateAnalyze, validateAudio, validateLink } from '../supabase/functions/ai/core.js';
import { clock, runTranscribe, voiceState } from '../src/transcribe.js';
import { MAX_SHARE_CHARS, shareText } from '../src/share.js';
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
assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, 4);
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
assert.throws(() => parseLinks('{bad', []), /Invalid JSON response/);
assert.throws(() => parseLinks(JSON.stringify({ links: [{ candidate_id: 'unknown', relation: 'follow-up', reason: 'Unknown.' }] }), [{ id: 'b' }]), /Invalid links response/);
assert.equal(retryDelay(0), 2000);
assert.equal(retryDelay(20), 3600000);
const realFetch = globalThis.fetch;

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
assert.equal((await oldDb.getFirstAsync('PRAGMA user_version')).user_version, 4);
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
assert.equal((await v2db.getFirstAsync('PRAGMA user_version')).user_version, 4);
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

// ---- Phase 5: voice and share ----
const adapt = (raw) => {
  const d = {
    execAsync: async (q) => raw.exec(q),
    runAsync: async (q, ...p) => raw.prepare(q).run(...p),
    getAllAsync: async (q, ...p) => raw.prepare(q).all(...p),
    getFirstAsync: async (q, ...p) => raw.prepare(q).get(...p) ?? null,
    withExclusiveTransactionAsync: async (task) => {
      raw.exec('BEGIN IMMEDIATE');
      try { await task(d); raw.exec('COMMIT'); } catch (error) { raw.exec('ROLLBACK'); throw error; }
    },
  };
  return d;
};
const kindsFor = async (d, id) => (await d.getAllAsync('SELECT kind FROM jobs WHERE thought_id = ? ORDER BY kind', id)).map((row) => row.kind);
const columns = async (d) => (await d.getAllAsync("SELECT name FROM pragma_table_info('thoughts')")).map((row) => row.name);

// Migration 4 on top of a real phase 4 (version 3) database keeps data and adds nullable columns.
const p4raw = new DatabaseSync(':memory:');
const p4 = adapt(p4raw);
await T.migrate(p4);
await T.addThought(p4, 'kept', 'A phase four thought');
p4raw.exec('ALTER TABLE thoughts DROP COLUMN audio_path; ALTER TABLE thoughts DROP COLUMN audio_ms; PRAGMA user_version = 3;');
assert.ok(!(await columns(p4)).includes('audio_path'), 'test DB looks like phase 4');
const jobsBefore = (await p4.getFirstAsync('SELECT COUNT(*) AS count FROM jobs')).count;
await T.migrate(p4);
await T.migrate(p4);
assert.equal((await p4.getFirstAsync('PRAGMA user_version')).user_version, 4);
assert.ok((await columns(p4)).includes('audio_path') && (await columns(p4)).includes('audio_ms'));
assert.equal((await T.getThought(p4, 'kept')).audio_path, null);
assert.equal((await T.getThought(p4, 'kept')).text, 'A phase four thought');
assert.equal((await p4.getFirstAsync('SELECT COUNT(*) AS count FROM jobs')).count, jobsBefore, 'no jobs added by migration');
assert.equal(voiceState(await T.getThought(p4, 'kept')), null);

// Job ordering: a voice thought only has a transcribe job until transcription succeeds.
await T.addVoiceThought(db, 'v1', 'ExpoAudio/voice-v1.m4a', 42000);
assert.deepEqual(await kindsFor(db, 'v1'), ['transcribe']);
for (const kind of ['analyze', 'embed', 'link']) assert.equal((await T.dueJob(db, kind))?.thought_id === 'v1', false, `no ${kind} before transcript`);
let voiceRow = await T.getThought(db, 'v1');
assert.equal(voiceRow.source, 'voice');
assert.equal(voiceRow.text, '');
assert.equal(voiceRow.audio_ms, 42000);
assert.equal(voiceState(voiceRow), 'listening');

// Failure: 4 failures retry, the 5th keeps the audio and shows "Couldn't transcribe".
for (let i = 0; i < T.MAX_TRANSCRIBE_ATTEMPTS - 1; i++) {
  const j = await T.dueJob(db, 'transcribe', Date.now() + 1e9);
  assert.equal(j.audio_path, 'ExpoAudio/voice-v1.m4a');
  assert.equal(await T.failTranscribe(db, j, 'Transcription request failed', retryDelay(j.attempts)), 'retry');
}
assert.equal((await db.getFirstAsync("SELECT attempts, last_error FROM jobs WHERE thought_id = 'v1'")).attempts, 4);
assert.equal(await T.failTranscribe(db, await T.dueJob(db, 'transcribe', Date.now() + 1e9), 'Transcription request failed', 0), 'failed');
assert.deepEqual(await kindsFor(db, 'v1'), [], 'no jobs left, nothing queued behind a failed transcript');
voiceRow = await T.getThought(db, 'v1');
assert.equal(voiceRow.audio_path, 'ExpoAudio/voice-v1.m4a', 'failed transcription keeps the recording');
assert.equal(voiceState(voiceRow), 'failed');
assert.equal((await T.updateThought(db, 'v1', { text: 'typed over it' })).changes, 0, 'cannot edit text before transcript');
await T.retryTranscribe(db, 'v1');
await T.retryTranscribe(db, 'v1');
assert.deepEqual(await kindsFor(db, 'v1'), ['transcribe'], 'retry queues exactly one job');
assert.equal((await db.getFirstAsync("SELECT attempts FROM jobs WHERE thought_id = 'v1'")).attempts, 0);
assert.equal(voiceState(await T.getThought(db, 'v1')), 'listening');
await T.retryTranscribe(db, 'a-typed-thought-or-missing');

// An empty transcript is final: straight to the failed state without 5 paid retries.
const silentJob = await T.dueJob(db, 'transcribe');
const removed = [];
await assert.rejects(runTranscribe(db, silentJob, { transcribe: async () => '  \n', removeAudio: (path) => removed.push(path) }), (error) => error.final === true && /No speech heard/.test(error.message));
assert.equal(await T.failTranscribe(db, silentJob, 'No speech heard', 0, true), 'failed');
assert.deepEqual(removed, [], 'audio kept when nothing was transcribed');
await T.retryTranscribe(db, 'v1');

// Success: text stored, audio removed, then analyze/embed/link queued.
const okJob = await T.dueJob(db, 'transcribe');
const seen = [];
assert.equal(await runTranscribe(db, okJob, {
  transcribe: async (path) => { seen.push(path); return '  Remind me to book the Sylhet trip  '; },
  removeAudio: (path) => removed.push(path),
}), true);
assert.deepEqual(seen, ['ExpoAudio/voice-v1.m4a']);
assert.deepEqual(removed, ['ExpoAudio/voice-v1.m4a'], 'audio file deleted after success');
voiceRow = await T.getThought(db, 'v1');
assert.equal(voiceRow.text, 'Remind me to book the Sylhet trip');
assert.equal(voiceRow.audio_path, null);
assert.equal(voiceState(voiceRow), null);
assert.deepEqual(await kindsFor(db, 'v1'), ['analyze', 'embed', 'link']);
assert.equal((await T.searchThoughts(db, 'sylhet'))[0].id, 'v1', 'transcript is searchable');
assert.equal(await runTranscribe(db, okJob, { transcribe: async () => 'again', removeAudio: (path) => removed.push(path) }), false, 'stale job saves nothing');
assert.equal(removed.length, 1);
assert.equal((await T.getThought(db, 'v1')).text, 'Remind me to book the Sylhet trip');

// A failing delete never loses the saved transcript; a deleted thought keeps no audio path.
await T.addVoiceThought(db, 'v2', 'ExpoAudio/voice-v2.m4a', 5000);
assert.equal(await runTranscribe(db, await db.getFirstAsync("SELECT j.*, t.audio_path FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = 'v2'"),
  { transcribe: async () => 'Second voice note', removeAudio: () => { throw new Error('disk'); } }), true);
assert.equal((await T.getThought(db, 'v2')).text, 'Second voice note');
await T.addVoiceThought(db, 'v3', 'ExpoAudio/voice-v3.m4a', 3000);
await T.deleteThought(db, 'v3');
assert.equal(await db.getFirstAsync("SELECT audio_path FROM thoughts WHERE id = 'v3'").then((row) => row.audio_path), null);
assert.deepEqual(await kindsFor(db, 'v3'), []);
assert.equal(clock(42000), '0:42');
assert.equal(clock(120000), '2:00');
assert.equal(clock(null), '0:00');

// AI function calls: request building and response validation for analyze, link, transcribe and info.
const client = { url: 'https://proj.supabase.co', publishableKey: 'sb_publishable_test', getToken: async () => 'jwt-123' };
const sent = [];
const reply = (status, body) => { globalThis.fetch = async (url, options) => { sent.push({ url: String(url), options }); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); }; };
const analysis = { title: 'Trip with Nadia', type: 'todo', tags: ['travel', 'friends'], entities: ['Nadia'], reminder_at: null };

reply(200, { model: 'qwen/test', analysis });
const analyzed = await analyzeThought(client, 'x'.repeat(LIMITS.text + 500), Array.from({ length: 40 }, (_, i) => `tag-${i}`));
assert.deepEqual(analyzed, { value: analysis, model: 'qwen/test' });
assert.equal(sent[0].url, 'https://proj.supabase.co/functions/v1/ai');
assert.equal(sent[0].options.method, 'POST');
assert.equal(sent[0].options.headers.Authorization, 'Bearer jwt-123');
assert.equal(sent[0].options.headers.apikey, 'sb_publishable_test');
assert.equal(sent[0].options.headers['Content-Type'], 'application/json');
const analyzeBody = JSON.parse(sent[0].options.body);
assert.equal(analyzeBody.action, 'analyze');
assert.equal(analyzeBody.text.length, LIMITS.text, 'long text is cut to the function limit');
assert.equal(analyzeBody.tags.length, LIMITS.tags);
assert.equal(validateAnalyze(analyzeBody).ok, true, 'what the app sends passes the function validation');
assert.equal(JSON.stringify(analyzeBody).includes('gsk_'), false);
assert.equal(Object.keys(analyzeBody).sort().join(), 'action,tags,text', 'no model, key or prompt comes from the app');

reply(200, { model: 'm', analysis: { ...analysis, type: 'unknown' } });
await assert.rejects(analyzeThought(client, 'hi', []), /Invalid AI response/);
reply(200, { model: 'm' });
await assert.rejects(analyzeThought(client, 'hi', []), /Invalid AI response/);

const candidates = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, text: 'y'.repeat(LIMITS.candidateText + 50), title: i ? null : 'T' }));
reply(200, { model: 'm', links: [{ candidate_id: 'c1', relation: 'follow-up', reason: ' Same trip. ' }, { candidate_id: 'c1', relation: 'follow-up', reason: 'dup' }] });
const linked2 = await linkThought(client, 'Trip', candidates);
assert.deepEqual(linked2.links, [{ candidate_id: 'c1', relation: 'follow-up', reason: 'Same trip.' }], 'duplicates dropped, reason trimmed');
const linkBody = JSON.parse(sent.at(-1).options.body);
assert.equal(linkBody.action, 'link');
assert.equal(linkBody.candidates.length, LIMITS.candidates, 'at most 8 candidates');
assert.equal(linkBody.candidates[1].text.length, LIMITS.candidateText);
assert.deepEqual(Object.keys(linkBody.candidates[0]).sort(), ['id', 'text', 'title'], 'candidates carry no embeddings or strengths');
assert.equal(validateLink(linkBody).ok, true);
reply(200, { model: 'm', links: [{ candidate_id: 'unknown', relation: 'follow-up', reason: 'No.' }] });
await assert.rejects(linkThought(client, 'Trip', candidates), /Invalid AI response/);
reply(200, { model: 'm', links: [] });
const callsBefore = sent.length;
assert.deepEqual((await linkThought(client, 'Trip', [])).links, []);
assert.equal(sent.length, callsBefore, 'no candidates, no call');

reply(200, { model: 'whisper', text: ' hello ' });
assert.equal(await transcribeAudio(client, new Blob(['audio'], { type: 'audio/mp4' })), ' hello ');
const form = sent.at(-1).options.body;
assert.equal(form.get('action'), 'transcribe');
assert.ok(form.get('file') instanceof Blob);
assert.equal(sent.at(-1).options.headers['Content-Type'], undefined, 'fetch must set the multipart boundary');
assert.equal(sent.at(-1).options.headers.Authorization, 'Bearer jwt-123');
reply(200, { nope: 1 });
await assert.rejects(transcribeAudio(client, new Blob(['x'])), /Invalid AI response/);

reply(200, { models: { chat: 'qwen/test', stt: 'whisper' }, daily_cap: 500 });
assert.deepEqual(await aiInfo(client), { chat: 'qwen/test', stt: 'whisper' });
assert.equal(sent.at(-1).options.method, 'GET');
assert.equal(sent.at(-1).options.body, undefined);

// Errors: short messages by code, never the body. A signed-out phone makes no request at all.
reply(429, { error: { code: 'rate_limited', message: 'Daily AI limit reached. Try again tomorrow.' } });
await assert.rejects(transcribeAudio(client, new Blob(['x'])), (error) => error instanceof AiError && error.code === 'rate_limited' && error.message === 'Daily AI limit reached');
reply(401, '<html>Invalid JWT</html>');
await assert.rejects(analyzeThought(client, 'hi', []), (error) => error instanceof AiError && error.code === 'unauthorized' && error.message === 'Sign in again');
reply(502, { error: { code: 'upstream_failed', message: 'x' } });
await assert.rejects(analyzeThought(client, 'hi', []), (error) => error.code === 'upstream_failed' && error.message === 'AI service busy');
reply(500, '<html>boom</html>');
await assert.rejects(analyzeThought(client, 'hi', []), (error) => error.message === 'AI HTTP 500');
const before = sent.length;
await assert.rejects(analyzeThought({ ...client, getToken: async () => null }, 'hi', []), (error) => error instanceof AiError && error.code === 'unauthorized');
assert.equal(sent.length, before, 'signed out: no request');

// The same rules the function applies to what arrives.
assert.equal(validateAnalyze({ text: '  ' }).ok, false);
assert.deepEqual(validateAnalyze({ text: ' hi ', tags: ['ok-tag', 'Bad Tag', 'x'.repeat(41)] }).value, { text: 'hi', tags: ['ok-tag'] });
assert.equal(validateLink({ text: 'hi', candidates: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, text: 'x' })) }).ok, false, 'more than 8 candidates');
assert.equal(validateLink({ text: 'hi', candidates: [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }] }).ok, false, 'duplicate candidate ids');
assert.equal(validateAudio(new Blob([new Uint8Array(LIMITS.audioBytes + 1)])).ok, false, 'audio over the cap');
assert.equal(validateAudio(new Blob([])).ok, false);
assert.equal(validateAudio('not a file').ok, false);
assert.equal(validateAudio(new Blob(['ok'])).ok, true);
globalThis.fetch = realFetch;

// Shared text normalisation.
assert.equal(shareText({ text: 'https://example.com/a', meta: { title: 'Great article' } }), 'Great article\nhttps://example.com/a');
assert.equal(shareText({ text: 'Great article https://example.com/a', meta: { title: 'Great article' } }), 'Great article https://example.com/a', 'subject already in text is not repeated');
assert.equal(shareText({ text: '  \n spaced out \t ' }), 'spaced out');
assert.equal(shareText({ text: '', webUrl: ' https://example.com ' }), 'https://example.com');
assert.equal(shareText({ text: null, meta: { title: ' Only a title ' } }), 'Only a title');
assert.equal(shareText({ text: 'x'.repeat(MAX_SHARE_CHARS + 500) }).length, MAX_SHARE_CHARS);
assert.equal(MAX_SHARE_CHARS, 2000);
assert.equal(shareText({ text: 'a'.repeat(MAX_SHARE_CHARS - 1) + '😀' }), 'a'.repeat(MAX_SHARE_CHARS - 1), 'cap never splits an emoji');
for (const empty of [undefined, {}, { text: '   ' }, { text: '', webUrl: null, meta: { title: '  ' } }, { text: null, meta: null }]) assert.equal(shareText(empty), '', 'empty share ignored');

console.log('selfcheck ok');
