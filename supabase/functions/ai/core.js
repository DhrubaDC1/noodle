// Pure rules shared by the Edge Function (Deno) and the app (Metro) and the self-check (Node):
// no Deno, React Native or model IDs in here.
export const TYPES = ['idea', 'project', 'todo', 'memory', 'question'];
export const RELATIONS = ['same-project', 'follow-up', 'similar-idea', 'contradicts'];
export const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const LIMITS = {
  text: 4000, // characters of one thought
  candidateText: 1000,
  title: 200,
  candidates: 8,
  tags: 30,
  tagLength: 40,
  audioBytes: 5 * 1024 * 1024, // a 2-minute 32 kbps voice note is about 0.5 MB
  jsonBytes: 100 * 1024,
};

const fail = (message) => ({ ok: false, message });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateAnalyze(body) {
  if (typeof body.text !== 'string' || !body.text.trim()) return fail('text is required');
  if (body.text.length > LIMITS.text) return fail(`text is longer than ${LIMITS.text} characters`);
  const tags = body.tags ?? [];
  if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) return fail('tags must be a list of strings');
  // Tags land in the prompt, so only well-formed ones pass; a hand-edited odd tag is dropped, not an error.
  return { ok: true, value: { text: body.text.trim(), tags: tags.filter((tag) => tag.length <= LIMITS.tagLength && TAG.test(tag)).slice(0, LIMITS.tags) } };
}

export function validateLink(body) {
  if (typeof body.text !== 'string' || !body.text.trim()) return fail('text is required');
  if (body.text.length > LIMITS.text) return fail(`text is longer than ${LIMITS.text} characters`);
  const list = body.candidates;
  if (!Array.isArray(list) || list.length < 1) return fail('candidates must be a non-empty list');
  if (list.length > LIMITS.candidates) return fail(`at most ${LIMITS.candidates} candidates`);
  const ids = new Set();
  const candidates = [];
  for (const item of list) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || item.id.length > 64 || ids.has(item.id)) return fail('each candidate needs a unique id');
    if (typeof item.text !== 'string' || item.text.length > LIMITS.candidateText) return fail(`candidate text must be a string of at most ${LIMITS.candidateText} characters`);
    if (item.title != null && (typeof item.title !== 'string' || item.title.length > LIMITS.title)) return fail('candidate title is invalid');
    ids.add(item.id);
    candidates.push({ id: item.id, text: item.text, title: item.title ?? null });
  }
  return { ok: true, value: { text: body.text.trim(), candidates } };
}

export function validateAudio(file) {
  if (!(file instanceof Blob)) return fail('file is required');
  if (file.size < 1) return fail('file is empty');
  if (file.size > LIMITS.audioBytes) return fail(`file is larger than ${LIMITS.audioBytes / 1024 / 1024} MB`);
  return { ok: true, value: file };
}

// What the model returned, as an object. Throws when it is not usable.
export function checkAnalysis(value) {
  if (!isObject(value) ||
    typeof value.title !== 'string' || !value.title.trim() || value.title.length > 80 ||
    !TYPES.includes(value.type) || !Array.isArray(value.tags) ||
    value.tags.length < 1 || value.tags.length > 4 ||
    !value.tags.every((tag) => typeof tag === 'string' && TAG.test(tag)) ||
    !Array.isArray(value.entities) || !value.entities.every((entity) => typeof entity === 'string') ||
    (value.reminder_at !== null && (typeof value.reminder_at !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(value.reminder_at) ||
      Number.isNaN(Date.parse(value.reminder_at))))) {
    throw new Error('Invalid analysis response');
  }
  return { ...value, title: value.title.trim() };
}

export function checkLinks(value, candidates) {
  const allowed = new Set(candidates.map((row) => row.id));
  if (!isObject(value) || !Array.isArray(value.links) || value.links.length > candidates.length ||
    value.links.some((link) => !allowed.has(link?.candidate_id) || !RELATIONS.includes(link.relation) ||
      typeof link.reason !== 'string' || !link.reason.trim() || link.reason.length > 160 || /[\r\n]/.test(link.reason))) {
    throw new Error('Invalid links response');
  }
  const seen = new Set();
  return value.links.filter((link) => {
    if (seen.has(link.candidate_id)) return false;
    seen.add(link.candidate_id);
    return true;
  }).map((link) => ({ candidate_id: link.candidate_id, relation: link.relation, reason: link.reason.trim() }));
}

function parseJson(content) {
  try { return JSON.parse(content); } catch { throw new Error('Invalid JSON response'); }
}

export const parseAnalysis = (content) => checkAnalysis(parseJson(content));
export const parseLinks = (content, candidates) => checkLinks(parseJson(content), candidates);
