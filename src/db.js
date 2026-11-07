// All SQLite access lives here. Functions take the db so screens use useSQLiteContext()
// and the self-check can pass a Node SQLite adapter.

const COLS = 'id, text, source, status, created_at, updated_at';

export async function migrate(db) {
  const { user_version } = await db.getFirstAsync('PRAGMA user_version');
  if (user_version >= 1) return;
  // seq is a stable integer rowid for the FTS index; id (UUID) is what sync will use.
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE thoughts (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'typed',
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX thoughts_created ON thoughts(created_at);
    CREATE VIRTUAL TABLE thoughts_fts USING fts5(text, content='thoughts', content_rowid='seq');
    CREATE TRIGGER thoughts_ai AFTER INSERT ON thoughts BEGIN
      INSERT INTO thoughts_fts(rowid, text) VALUES (new.seq, new.text);
    END;
    CREATE TRIGGER thoughts_ad AFTER DELETE ON thoughts BEGIN
      INSERT INTO thoughts_fts(thoughts_fts, rowid, text) VALUES ('delete', old.seq, old.text);
    END;
    CREATE TRIGGER thoughts_au AFTER UPDATE OF text ON thoughts BEGIN
      INSERT INTO thoughts_fts(thoughts_fts, rowid, text) VALUES ('delete', old.seq, old.text);
      INSERT INTO thoughts_fts(rowid, text) VALUES (new.seq, new.text);
    END;
    PRAGMA user_version = 1;
  `);
}

export function addThought(db, id, text, source = 'typed') {
  const now = Date.now();
  return db.runAsync(
    'INSERT INTO thoughts (id, text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    id, text, source, now, now
  );
}

export function listThoughts(db, limit = 200) {
  return db.getAllAsync(
    `SELECT ${COLS} FROM thoughts WHERE deleted = 0 AND status != 'archived' ORDER BY created_at DESC LIMIT ?`,
    limit
  );
}

export function getThought(db, id) {
  return db.getFirstAsync(`SELECT ${COLS} FROM thoughts WHERE id = ? AND deleted = 0`, id);
}

export function updateThought(db, id, { text = null, status = null }) {
  return db.runAsync(
    'UPDATE thoughts SET text = COALESCE(?, text), status = COALESCE(?, status), updated_at = ? WHERE id = ?',
    text, status, Date.now(), id
  );
}

// Soft delete so sync can propagate it later.
export function deleteThought(db, id) {
  return db.runAsync('UPDATE thoughts SET deleted = 1, updated_at = ? WHERE id = ?', Date.now(), id);
}

// Keep only letters/digits (what FTS5's tokenizer indexes) and prefix-match each word,
// so user input can never be parsed as FTS syntax.
export function toFtsQuery(input) {
  return (input.match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => `"${w}"*`).join(' ');
}

export function searchThoughts(db, input) {
  const q = toFtsQuery(input);
  if (!q) return Promise.resolve([]);
  return db.getAllAsync(
    `SELECT t.id, t.text, t.source, t.status, t.created_at, t.updated_at
     FROM thoughts_fts JOIN thoughts t ON t.seq = thoughts_fts.rowid
     WHERE thoughts_fts MATCH ? AND t.deleted = 0
     ORDER BY bm25(thoughts_fts) LIMIT 50`,
    q
  );
}
