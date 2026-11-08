export const EMBEDDING_MODEL = 'all-MiniLM-L6-v2';
export const VECTOR_SIZE = 384;
export const LINK_THRESHOLD = 0.45;

export function vectorBlob(vector) {
  if (!(vector instanceof Float32Array) || vector.length !== VECTOR_SIZE || !vector.every(Number.isFinite)) throw new Error('Invalid embedding vector');
  return new Uint8Array(vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength));
}

export function blobVector(blob) {
  if (!(blob instanceof Uint8Array) || blob.byteLength !== VECTOR_SIZE * 4) throw new Error('Invalid embedding blob');
  const vector = new Float32Array(Uint8Array.from(blob).buffer);
  if (!vector.every(Number.isFinite)) throw new Error('Invalid embedding blob');
  return vector;
}

export function cosineSimilarity(a, b) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function topSimilar(vector, rows, limit, threshold = -1, excluded = new Set()) {
  return rows.flatMap((row) => {
    if (excluded.has(row.id)) return [];
    try {
      const strength = cosineSimilarity(vector, blobVector(row.vector));
      return strength >= threshold ? [{ ...row, strength }] : [];
    } catch { return []; }
  }).sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id)).slice(0, limit);
}

export function meaningWithoutWords(words, meaning, limit = 10) {
  const ids = new Set(words.map((row) => row.id));
  return meaning.filter((row) => {
    if (ids.has(row.id)) return false;
    ids.add(row.id);
    return true;
  }).slice(0, limit);
}
