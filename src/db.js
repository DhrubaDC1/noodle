// All SQLite access lives here. Functions take the db so screens use useSQLiteContext()
// and the self-check can pass a Node SQLite adapter.
import { EMBEDDING_MODEL, vectorBlob } from './similarity.js';

const COLS = 't.id, t.text, t.source, t.status, t.created_at, t.updated_at, a.title, a.type, a.tags, a.reminder_at, a.reminder_state, a.notification_id, j.id AS pending_job, j.last_error';

export async function migrate(db) {
  const { user_version } = await db.getFirstAsync('PRAGMA user_version');
  if (user_version < 1) {
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
  if (user_version < 2) await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.execAsync(`
      CREATE TABLE analysis (
        thought_id TEXT PRIMARY KEY REFERENCES thoughts(id),
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT NOT NULL,
        entities TEXT NOT NULL,
        reminder_at TEXT,
        model TEXT NOT NULL,
        analyzed_at INTEGER NOT NULL,
        type_override TEXT,
        tags_override TEXT,
        reminder_state TEXT NOT NULL DEFAULT 'suggested',
        notification_id TEXT
      );
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        thought_id TEXT NOT NULL REFERENCES thoughts(id),
        kind TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_try_at INTEGER NOT NULL,
        last_error TEXT,
        UNIQUE(thought_id, kind)
      );
      CREATE INDEX jobs_due ON jobs(next_try_at);
      DROP TRIGGER thoughts_ai;
      DROP TRIGGER thoughts_ad;
      DROP TRIGGER thoughts_au;
      DROP TABLE thoughts_fts;
      CREATE VIRTUAL TABLE thoughts_fts USING fts5(text, title, tags);
      INSERT INTO thoughts_fts(rowid, text, title, tags) SELECT seq, text, '', '' FROM thoughts;
      CREATE TRIGGER thoughts_ai AFTER INSERT ON thoughts BEGIN
        INSERT INTO thoughts_fts(rowid, text, title, tags) VALUES(new.seq, new.text, '', '');
      END;
      CREATE TRIGGER thoughts_ad AFTER DELETE ON thoughts BEGIN
        DELETE FROM thoughts_fts WHERE rowid = old.seq;
      END;
      CREATE TRIGGER thoughts_au AFTER UPDATE OF text ON thoughts BEGIN
        UPDATE thoughts_fts SET text = new.text WHERE rowid = new.seq;
      END;
      CREATE TRIGGER analysis_ai AFTER INSERT ON analysis BEGIN
        UPDATE thoughts_fts SET title = new.title, tags = new.tags
        WHERE rowid = (SELECT seq FROM thoughts WHERE id = new.thought_id);
      END;
      CREATE TRIGGER analysis_au AFTER UPDATE OF title, tags ON analysis BEGIN
        UPDATE thoughts_fts SET title = new.title, tags = new.tags
        WHERE rowid = (SELECT seq FROM thoughts WHERE id = new.thought_id);
      END;
      INSERT INTO jobs(id, thought_id, kind, next_try_at)
        SELECT lower(hex(randomblob(16))), id, 'analyze', 0 FROM thoughts WHERE deleted = 0;
      PRAGMA user_version = 2;
    `);
  });
  if (user_version < 3) await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.execAsync(`
      CREATE TABLE embeddings (
        thought_id TEXT PRIMARY KEY REFERENCES thoughts(id),
        vector BLOB NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE links (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL REFERENCES thoughts(id),
        to_id TEXT NOT NULL REFERENCES thoughts(id),
        relation TEXT NOT NULL,
        reason TEXT NOT NULL,
        strength REAL NOT NULL,
        created_at INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        CHECK(from_id != to_id)
      );
      CREATE UNIQUE INDEX links_pair ON links(min(from_id, to_id), max(from_id, to_id));
      CREATE INDEX links_from ON links(from_id);
      CREATE INDEX links_to ON links(to_id);
      ALTER TABLE jobs ADD COLUMN refresh INTEGER NOT NULL DEFAULT 0;
      INSERT INTO jobs(id, thought_id, kind, next_try_at)
        SELECT lower(hex(randomblob(16))), id, 'embed', 0 FROM thoughts WHERE deleted = 0;
      INSERT INTO jobs(id, thought_id, kind, next_try_at)
        SELECT lower(hex(randomblob(16))), id, 'link', 0 FROM thoughts WHERE deleted = 0;
      PRAGMA user_version = 3;
    `);
  });
}

export async function addThought(db, id, text, source = 'typed') {
  const now = Date.now();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync('INSERT INTO thoughts (id, text, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, text, source, now, now);
    await tx.runAsync("INSERT INTO jobs(id, thought_id, kind, next_try_at) VALUES(lower(hex(randomblob(16))), ?, 'analyze', ?)", id, now);
    await tx.runAsync("INSERT INTO jobs(id, thought_id, kind, next_try_at) VALUES(lower(hex(randomblob(16))), ?, 'embed', ?)", id, now);
    await tx.runAsync("INSERT INTO jobs(id, thought_id, kind, next_try_at) VALUES(lower(hex(randomblob(16))), ?, 'link', ?)", id, now);
  });
}

export function listThoughts(db, limit = 200) {
  return db.getAllAsync(
    `SELECT ${COLS} FROM thoughts t LEFT JOIN analysis a ON a.thought_id = t.id
     LEFT JOIN jobs j ON j.thought_id = t.id AND j.kind = 'analyze'
     WHERE t.deleted = 0 AND t.status != 'archived' ORDER BY t.created_at DESC LIMIT ?`,
    limit
  );
}

export function getThought(db, id) {
  return db.getFirstAsync(`SELECT ${COLS} FROM thoughts t LEFT JOIN analysis a ON a.thought_id = t.id
    LEFT JOIN jobs j ON j.thought_id = t.id AND j.kind = 'analyze' WHERE t.id = ? AND t.deleted = 0`, id);
}

export async function updateThought(db, id, { text = null, status = null }) {
  const now = Date.now();
  if (text === null) return db.runAsync('UPDATE thoughts SET status = ?, updated_at = ? WHERE id = ? AND deleted = 0', status, now, id);
  let result;
  await db.withExclusiveTransactionAsync(async (tx) => {
    result = await tx.runAsync('UPDATE thoughts SET text = ?, updated_at = ? WHERE id = ? AND deleted = 0', text, now, id);
    if (result.changes) {
      await tx.runAsync('DELETE FROM embeddings WHERE thought_id = ?', id);
      for (const kind of ['analyze', 'embed', 'link']) await tx.runAsync(`INSERT INTO jobs(id, thought_id, kind, next_try_at, refresh)
        VALUES(lower(hex(randomblob(16))), ?, ?, ?, ?)
        ON CONFLICT(thought_id, kind) DO UPDATE SET id = excluded.id, attempts = 0,
          next_try_at = excluded.next_try_at, last_error = NULL, refresh = excluded.refresh`, id, kind, now, kind === 'link' ? 1 : 0);
    }
  });
  return result;
}

// Soft delete so sync can propagate it later.
export async function deleteThought(db, id) {
  let result;
  await db.withExclusiveTransactionAsync(async (tx) => {
    result = await tx.runAsync('UPDATE thoughts SET deleted = 1, updated_at = ? WHERE id = ?', Date.now(), id);
    await tx.runAsync('DELETE FROM jobs WHERE thought_id = ?', id);
  });
  return result;
}

// Keep only letters/digits (what FTS5's tokenizer indexes) and prefix-match each word,
// so user input can never be parsed as FTS syntax.
export function toFtsQuery(input) {
  return (input.match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => `"${w}"*`).join(' ');
}

export function searchThoughts(db, input, type = null, tag = null) {
  const q = toFtsQuery(input);
  if (!q && !type && !tag) return Promise.resolve([]);
  return db.getAllAsync(
    `SELECT ${COLS} FROM thoughts t LEFT JOIN analysis a ON a.thought_id = t.id
     LEFT JOIN jobs j ON j.thought_id = t.id AND j.kind = 'analyze'
     WHERE t.deleted = 0 AND (? = '' OR t.seq IN (SELECT rowid FROM thoughts_fts WHERE thoughts_fts MATCH ?))
       AND (? IS NULL OR a.type = ?)
       AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(a.tags) WHERE value = ?))
     ORDER BY t.created_at DESC LIMIT 50`,
    q, q, type, type, tag, tag
  );
}

export function dueJob(db, kind, now = Date.now()) {
  return db.getFirstAsync(`SELECT j.*, t.text FROM jobs j JOIN thoughts t ON t.id = j.thought_id
    WHERE j.kind = ? AND j.next_try_at <= ? AND t.deleted = 0
    ORDER BY t.created_at DESC LIMIT 1`, kind, now);
}

export function nextJobTime(db, kinds) {
  if (!kinds.length) return Promise.resolve(null);
  return db.getFirstAsync(`SELECT MIN(next_try_at) AS next_try_at FROM jobs WHERE kind IN (${kinds.map(() => '?').join(',')})`, ...kinds);
}

export function pendingEmbeds(db) {
  return db.getFirstAsync("SELECT COUNT(*) AS count FROM jobs j JOIN thoughts t ON t.id = j.thought_id WHERE j.kind = 'embed' AND t.deleted = 0");
}

export async function saveEmbedding(db, job, vector) {
  const blob = vectorBlob(vector);
  let saved = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await tx.getFirstAsync("SELECT t.text, j.id FROM thoughts t JOIN jobs j ON j.thought_id = t.id AND j.kind = 'embed' WHERE t.id = ? AND t.deleted = 0", job.thought_id);
    if (!current || current.id !== job.id || current.text !== job.text) return;
    await tx.runAsync(`INSERT INTO embeddings(thought_id,vector,model,created_at) VALUES(?,?,?,?)
      ON CONFLICT(thought_id) DO UPDATE SET vector=excluded.vector, model=excluded.model, created_at=excluded.created_at`,
    job.thought_id, blob, EMBEDDING_MODEL, Date.now());
    await tx.runAsync('DELETE FROM jobs WHERE id = ?', job.id);
    saved = true;
  });
  return saved;
}

export function embeddingRows(db, type = null, tag = null) {
  return db.getAllAsync(`SELECT ${COLS}, e.vector FROM embeddings e JOIN thoughts t ON t.id = e.thought_id
    LEFT JOIN analysis a ON a.thought_id = t.id LEFT JOIN jobs j ON j.thought_id = t.id AND j.kind = 'analyze'
    WHERE t.deleted = 0 AND e.model = ? AND (? IS NULL OR a.type = ?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(a.tags) WHERE value = ?))`,
  EMBEDDING_MODEL, type, type, tag, tag);
}

export function deletedPairs(db, id) {
  return db.getAllAsync('SELECT from_id, to_id FROM links WHERE deleted = 1 AND (from_id = ? OR to_id = ?)', id, id);
}

export function getLinkedThoughts(db, id) {
  return db.getAllAsync(`SELECT l.id AS link_id, l.relation, l.reason, l.strength, t.id, t.text, t.created_at, a.title, a.type
    FROM links l JOIN thoughts t ON t.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
    LEFT JOIN analysis a ON a.thought_id = t.id
    WHERE (l.from_id = ? OR l.to_id = ?) AND l.deleted = 0 AND t.deleted = 0
    ORDER BY l.strength DESC, l.created_at DESC`, id, id, id);
}

export function removeLink(db, linkId) {
  return db.runAsync('UPDATE links SET deleted = 1 WHERE id = ? AND deleted = 0', linkId);
}

export async function saveLinks(db, job, candidates, chosen) {
  let saved = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await tx.getFirstAsync("SELECT t.text, j.id FROM thoughts t JOIN jobs j ON j.thought_id = t.id AND j.kind = 'link' WHERE t.id = ? AND t.deleted = 0", job.thought_id);
    if (!current || current.id !== job.id || current.text !== job.text) return;
    if (job.refresh) await tx.runAsync('DELETE FROM links WHERE deleted = 0 AND (from_id = ? OR to_id = ?)', job.thought_id, job.thought_id);
    for (const link of chosen) {
      const candidate = candidates.find((row) => row.id === link.candidate_id);
      if (!candidate) continue;
      const stillCurrent = await tx.getFirstAsync('SELECT text FROM thoughts WHERE id = ? AND deleted = 0', candidate.id);
      if (!stillCurrent || stillCurrent.text !== candidate.text) continue;
      await tx.runAsync(`INSERT OR IGNORE INTO links(id,from_id,to_id,relation,reason,strength,created_at)
        VALUES(?,?,?,?,?,?,?)`, link.id, job.thought_id, candidate.id, link.relation, link.reason, candidate.strength, Date.now());
    }
    await tx.runAsync('DELETE FROM jobs WHERE id = ?', job.id);
    saved = true;
  });
  return saved;
}

export function topTags(db) {
  return db.getAllAsync(`SELECT value AS tag FROM analysis a, json_each(a.tags)
    JOIN thoughts t ON t.id = a.thought_id WHERE t.deleted = 0
    GROUP BY value ORDER BY COUNT(*) DESC, value LIMIT 30`);
}

export async function saveAnalysis(db, job, value, model) {
  let saved = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await tx.getFirstAsync(`SELECT t.text, j.id FROM thoughts t JOIN jobs j ON j.thought_id = t.id
      WHERE t.id = ? AND t.deleted = 0 AND j.kind = 'analyze'`, job.thought_id);
    if (!current || current.id !== job.id || current.text !== job.text) return;
    await tx.runAsync(`INSERT INTO analysis(thought_id,title,type,tags,entities,reminder_at,model,analyzed_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(thought_id) DO UPDATE SET
      title=excluded.title, type=COALESCE(analysis.type_override, excluded.type),
      tags=COALESCE(analysis.tags_override, excluded.tags), entities=excluded.entities,
      reminder_at=excluded.reminder_at, model=excluded.model, analyzed_at=excluded.analyzed_at,
      reminder_state=CASE WHEN analysis.reminder_at IS NOT excluded.reminder_at AND analysis.notification_id IS NULL THEN 'suggested' ELSE analysis.reminder_state END`,
    job.thought_id, value.title, value.type, JSON.stringify(value.tags), JSON.stringify(value.entities), value.reminder_at, model, Date.now());
    await tx.runAsync('DELETE FROM jobs WHERE id = ?', job.id);
    saved = true;
  });
  return saved;
}

export function editAnalysis(db, id, field, value) {
  if (field === 'type') return db.runAsync('UPDATE analysis SET type = ?, type_override = ? WHERE thought_id = ?', value, value, id);
  if (field === 'tags') return db.runAsync('UPDATE analysis SET tags = ?, tags_override = ? WHERE thought_id = ?', JSON.stringify(value), JSON.stringify(value), id);
  throw new Error('Invalid analysis field');
}

export function setReminderState(db, id, state, notificationId = null) {
  return db.runAsync('UPDATE analysis SET reminder_state = ?, notification_id = ? WHERE thought_id = ?', state, notificationId, id);
}
