// Sync logic with no React Native imports, so scripts/selfcheck.mjs can run it against two databases
// and a fake server. `remote` is { push(payload), pull(table, since, limit) } (src/syncRunner.js builds it
// from the Supabase client).
//
// Push: rows changed since the last push, oldest first, in batches. Pull: rows the server stamped
// (synced_at) after our cursor. Conflicts: the row with the larger updated_at wins, on the server (sync_push)
// and here (apply*). The pull cursor is the server's clock, not ours, so a phone that was offline for a
// week and pushes old edits still reaches every other phone.
import { applyRemoteAnalysis, applyRemoteLinks, applyRemoteThoughts, getSyncState, queueMissingAnalysis, resetSync, setSyncState, syncRows, SYNC_KEY } from './db.js';

export const PUSH_BATCH = 200;
export const PULL_PAGE = 1000; // larger than one push batch, so rows stamped in the same ms never fill a page
export const PULL_OVERLAP_MS = 10000; // re-read the last seconds: commits can land slightly out of order
export const ORPHAN_DELAY_MS = 10 * 60 * 1000;
const TABLES = ['thoughts', 'analysis', 'links']; // apply in this order: analysis and links point at thoughts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parse = (text) => (text == null ? null : JSON.parse(text));

// Local row -> the shape sync_push expects. A deleted thought is sent as a tombstone without its text.
export function toRemote(table, row) {
  if (table === 'thoughts') return { ...row, text: row.deleted ? '' : row.text };
  if (table === 'analysis') return { ...row, tags: parse(row.tags), entities: parse(row.entities), tags_override: parse(row.tags_override) };
  return row;
}

const idsOf = (table, row) => (table === 'links' ? [row.id, row.from_id, row.to_id] : table === 'analysis' ? [row.thought_id] : [row.id]);

async function push(db, remote, state) {
  let pushed = 0;
  for (const table of TABLES) {
    const key = SYNC_KEY[table];
    let at = Number(state[`push_${table}`] ?? 0);
    let after = '';
    for (;;) {
      const rows = await syncRows(db, table, at, after, PUSH_BATCH);
      if (!rows.length) break;
      const valid = rows.filter((row) => idsOf(table, row).every((id) => UUID.test(id)));
      if (valid.length) await remote.push({ [table]: valid.map((row) => toRemote(table, row)) });
      pushed += valid.length;
      const last = rows.at(-1);
      at = last.updated_at; after = last[key];
      // Saved cursor: rows at exactly this updated_at are sent again next time (harmless). Never beyond the real
      // time: if this phone's clock was once ahead and then corrected, newer edits would otherwise look already sent.
      await setSyncState(db, `push_${table}`, Math.min(at, Date.now()));
      if (rows.length < PUSH_BATCH) break;
    }
  }
  return pushed;
}

async function pull(db, remote, state, now) {
  let pulled = 0;
  const inserted = [];
  for (const table of TABLES) {
    const stored = Number(state[`pull_${table}`] ?? 0);
    let since = Math.max(0, stored - PULL_OVERLAP_MS);
    let cursor = stored;
    for (;;) {
      const rows = await remote.pull(table, since, PULL_PAGE);
      if (!rows.length) break;
      if (table === 'thoughts') {
        const done = await applyRemoteThoughts(db, rows);
        pulled += done.changed; inserted.push(...done.inserted);
      } else pulled += table === 'analysis' ? await applyRemoteAnalysis(db, rows) : await applyRemoteLinks(db, rows);
      const newest = Math.max(...rows.map((row) => Number(row.synced_at)));
      cursor = Math.max(cursor, newest);
      await setSyncState(db, `pull_${table}`, cursor);
      if (rows.length < PULL_PAGE || newest - 1 <= since) break;
      since = newest - 1;
    }
  }
  if (inserted.length) await queueMissingAnalysis(db, inserted, now + ORPHAN_DELAY_MS);
  return pulled;
}

// One round: push, then pull. Throws on any server or network error; progress made so far is kept.
export async function syncOnce(db, remote, userId, now = Date.now()) {
  let state = await getSyncState(db);
  if (state.user !== userId) { await resetSync(db, userId); state = await getSyncState(db); }
  const pushed = await push(db, remote, state);
  const pulled = await pull(db, remote, state, now);
  await setSyncState(db, 'last_synced', now);
  await setSyncState(db, 'last_error', null);
  return { pushed, pulled };
}
