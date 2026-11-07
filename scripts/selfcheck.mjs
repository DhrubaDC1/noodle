// Runs src/db.js against Node's built-in SQLite: node scripts/selfcheck.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as T from '../src/db.js';
import { analyzeThought, parseAnalysis, retryDelay } from '../src/groq.js';
import { GROQ_MODEL } from '../src/config.js';

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
assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, 2);
assert.equal((await db.getFirstAsync("SELECT COUNT(*) AS count FROM jobs")).count, 0);

await T.addThought(db, 'a', 'Build a budgeting app for tracking spending');
await T.addThought(db, 'b', 'Call Rafi about the trip');
assert.equal((await db.getFirstAsync('SELECT COUNT(*) AS count FROM jobs')).count, 2);
assert.equal((await T.listThoughts(db)).length, 2);

assert.deepEqual((await T.searchThoughts(db, 'budg')).map((r) => r.id), ['a']);
assert.deepEqual(await T.searchThoughts(db, ''), []);

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
globalThis.fetch = realFetch;

const job = await db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = 'a'");
assert.equal(await T.saveAnalysis(db, job, parseAnalysis(JSON.stringify({ title: 'Budget plan', type: 'project', tags: ['money'], entities: [], reminder_at: null })), 'test-model'), true);
assert.equal((await T.searchThoughts(db, 'plan'))[0].id, 'a', 'AI title indexed');
assert.equal((await T.searchThoughts(db, 'money'))[0].id, 'a', 'AI tag indexed');
assert.equal((await T.topTags(db))[0].tag, 'money');
await T.editAnalysis(db, 'a', 'tags', ['personal-finance']);
await T.editAnalysis(db, 'a', 'type', 'idea');
await T.updateThought(db, 'a', { text: 'A better budgeting app' });
const next = await db.getFirstAsync("SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.thought_id = 'a'");
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
assert.equal((await oldDb.getFirstAsync('PRAGMA user_version')).user_version, 2);
assert.equal((await T.searchThoughts(oldDb, 'older'))[0].id, 'old');
assert.equal((await oldDb.getFirstAsync('SELECT COUNT(*) AS count FROM jobs')).count, 1, 'old thought queued');

console.log('selfcheck ok');
