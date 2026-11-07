import { GROQ_BASE_URL, GROQ_MODEL } from './config.js';

const TYPES = ['idea', 'project', 'todo', 'memory', 'question'];
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
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
  let content;
  try { content = (await response.json()).choices?.[0]?.message?.content; } catch { throw new Error('Invalid Groq response'); }
  return parseAnalysis(content);
}
