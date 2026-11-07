// Runs src/db.js against Node's built-in SQLite: node scripts/selfcheck.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import * as T from '../src/db.js';

const raw = new DatabaseSync(':memory:');
const db = {
  execAsync: async (s) => raw.exec(s),
  runAsync: async (s, ...p) => raw.prepare(s).run(...p),
  getAllAsync: async (s, ...p) => raw.prepare(s).all(...p),
  getFirstAsync: async (s, ...p) => raw.prepare(s).get(...p) ?? null,
};

assert.equal(T.toFtsQuery('budget app!'), '"budget"* "app"*');
assert.equal(T.toFtsQuery('"OR NOT ('), '"OR"* "NOT"*');
assert.equal(T.toFtsQuery('  ?? '), '');

await T.migrate(db);
await T.migrate(db); // second run must be a no-op

await T.addThought(db, 'a', 'Build a budgeting app for tracking spending');
await T.addThought(db, 'b', 'Call Rafi about the trip');
assert.equal((await T.listThoughts(db)).length, 2);

assert.deepEqual((await T.searchThoughts(db, 'budg')).map((r) => r.id), ['a']);
assert.deepEqual(await T.searchThoughts(db, ''), []);

await T.updateThought(db, 'b', { text: 'Call Nadia about the trip' });
assert.equal((await T.searchThoughts(db, 'Rafi')).length, 0, 'old text leaves the index');
assert.equal((await T.searchThoughts(db, 'Nadia')).length, 1, 'new text is indexed');

await T.updateThought(db, 'b', { status: 'archived' });
assert.equal((await T.getThought(db, 'b')).text, 'Call Nadia about the trip', 'status change keeps text');
assert.equal((await T.listThoughts(db)).length, 1, 'archived hidden from list');
assert.equal((await T.searchThoughts(db, 'Nadia')).length, 1, 'archived still searchable');

await T.deleteThought(db, 'a');
assert.equal(await T.getThought(db, 'a'), null);
assert.equal((await T.searchThoughts(db, 'budget')).length, 0, 'deleted not searchable');

console.log('selfcheck ok');
