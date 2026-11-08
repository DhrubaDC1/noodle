import { GROQ_BASE_URL, GROQ_MODEL } from './config.js';

const TYPES = ['idea', 'project', 'todo', 'memory', 'question'];
const RELATIONS = ['same-project', 'follow-up', 'similar-idea', 'contradicts'];
const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' },
    type: { type: 'string', enum: TYPES },
    tags: { type: 'array', items: { type: 'string' } },
    entities: { type: 'array', items: { type: 'string' } },
    reminder_at: { type: ['string', 'null'] },
  },
  required: ['title', 'type', 'tags', 'entities', 'reminder_at'],
};
const linkSchema = {
  type: 'object', additionalProperties: false,
  properties: { links: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    properties: {
      candidate_id: { type: 'string' },
      relation: { type: 'string', enum: RELATIONS },
      reason: { type: 'string' },
    },
    required: ['candidate_id', 'relation', 'reason'],
  } } },
  required: ['links'],
};

// Keep Groq's reason (e.g. json_validate_failed) so a 400 is diagnosable from the card.
async function httpError(response) {
  let detail = '';
  try { const body = (await response.json()).error; detail = body?.code || body?.message || ''; } catch { /* no body */ }
  return new Error(`Groq HTTP ${response.status}${detail ? `: ${String(detail).replace(/\s+/g, ' ').slice(0, 90)}` : ''}`);
}

export function retryDelay(attempts) {
  return Math.min(3600000, 2000 * 2 ** Math.min(attempts, 11));
}

export function parseAnalysis(content) {
  let value;
  try { value = JSON.parse(content); } catch { throw new Error('Invalid JSON response'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    typeof value.title !== 'string' || !value.title.trim() || value.title.length > 80 ||
    !TYPES.includes(value.type) || !Array.isArray(value.tags) ||
    value.tags.length < 1 || value.tags.length > 4 ||
    !value.tags.every((tag) => typeof tag === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) ||
    !Array.isArray(value.entities) || !value.entities.every((entity) => typeof entity === 'string') ||
    (value.reminder_at !== null && (typeof value.reminder_at !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(value.reminder_at) ||
      Number.isNaN(Date.parse(value.reminder_at))))) {
    throw new Error('Invalid analysis response');
  }
  return { ...value, title: value.title.trim() };
}

export async function analyzeThought(key, text, tags) {
  const clock = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'full', timeStyle: 'long' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try { response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: { name: 'thought_analysis', strict: true, schema } },
      messages: [
        { role: 'system', content: `Analyze one English thought. Return a short title, type, 1-4 lowercase hyphenated tags, named entities as strings, and a future reminder_at ISO 8601 time with offset or null. Do not invent a reminder. Current date and time: ${clock}. Timezone: Asia/Dhaka. Prefer existing tags when suitable: ${tags.join(', ')}.` },
        { role: 'user', content: text },
      ],
    }),
  }); } finally { clearTimeout(timeout); }
  if (!response.ok) throw await httpError(response);
  let content;
  try { content = (await response.json()).choices?.[0]?.message?.content; } catch { throw new Error('Invalid Groq response'); }
  return parseAnalysis(content);
}

export function parseLinks(content, candidates) {
  let value;
  try { value = JSON.parse(content); } catch { throw new Error('Invalid JSON response'); }
  const allowed = new Set(candidates.map((row) => row.id));
  if (!value || !Array.isArray(value.links) || value.links.length > candidates.length ||
    value.links.some((link) => !allowed.has(link?.candidate_id) || !RELATIONS.includes(link.relation) ||
      typeof link.reason !== 'string' || !link.reason.trim() || link.reason.length > 160 || /[\r\n]/.test(link.reason))) {
    throw new Error('Invalid links response');
  }
  const seen = new Set();
  return value.links.filter((link) => {
    if (seen.has(link.candidate_id)) return false;
    seen.add(link.candidate_id);
    link.reason = link.reason.trim();
    return true;
  });
}

export async function linkThought(key, text, candidates) {
  if (!candidates.length) return [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try { response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST', signal: controller.signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: { name: 'thought_links', strict: true, schema: linkSchema } },
      messages: [
        { role: 'system', content: 'Choose only genuinely related earlier thoughts. Return no links when connection is weak. Each reason is one short sentence explaining the connection. Use candidate_id exactly as given. Relations: same-project, follow-up, similar-idea, contradicts.' },
        { role: 'user', content: JSON.stringify({ thought: text, candidates: candidates.map(({ id, text: candidateText, title }) => ({ id, text: candidateText, title })) }) },
      ],
    }),
  }); } finally { clearTimeout(timeout); }
  if (!response.ok) throw await httpError(response);
  let content;
  try { content = (await response.json()).choices?.[0]?.message?.content; } catch { throw new Error('Invalid Groq response'); }
  return parseLinks(content, candidates);
}
