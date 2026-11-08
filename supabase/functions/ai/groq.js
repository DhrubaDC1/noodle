// Everything that talks to Groq. Only the Edge Function imports this file.
import { CHAT_MODEL, CHAT_TIMEOUT_MS, GROQ_BASE_URL, STT_MODEL, STT_TIMEOUT_MS, TIMEZONE } from './config.js';
import { RELATIONS, TYPES } from './core.js';

const analysisSchema = {
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

export function analyzeBody({ text, tags }, now = new Date()) {
  const clock = now.toLocaleString('en-GB', { timeZone: TIMEZONE, dateStyle: 'full', timeStyle: 'long' });
  return {
    model: CHAT_MODEL,
    reasoning_effort: 'low',
    response_format: { type: 'json_schema', json_schema: { name: 'thought_analysis', strict: true, schema: analysisSchema } },
    messages: [
      { role: 'system', content: `Analyze one English thought. Return a short title, type, 1-4 lowercase hyphenated tags, named entities as strings, and a future reminder_at ISO 8601 time with offset or null. Do not invent a reminder. Current date and time: ${clock}. Timezone: ${TIMEZONE}. Prefer existing tags when suitable: ${tags.join(', ')}.` },
      { role: 'user', content: text },
    ],
  };
}

export function linkBody({ text, candidates }) {
  return {
    model: CHAT_MODEL,
    reasoning_effort: 'low',
    response_format: { type: 'json_schema', json_schema: { name: 'thought_links', strict: true, schema: linkSchema } },
    messages: [
      { role: 'system', content: 'Choose only genuinely related earlier thoughts. Return no links when connection is weak. Each reason is one short sentence explaining the connection. Use candidate_id exactly as given. Relations: same-project, follow-up, similar-idea, contradicts.' },
      { role: 'user', content: JSON.stringify({ thought: text, candidates }) },
    ],
  };
}

export function transcribeForm(file) {
  const form = new FormData();
  form.append('file', file, 'voice.m4a');
  form.append('model', STT_MODEL);
  form.append('language', 'en');
  form.append('response_format', 'json');
  return form;
}

// Returns Groq's parsed JSON. On any failure it throws a bare Error whose message holds only the
// status code: Groq's body can echo request details, so it is never passed on.
async function post(doFetch, key, path, init, timeoutMs) {
  let response;
  try {
    response = await doFetch(`${GROQ_BASE_URL}${path}`, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${key}`, ...init.headers }, body: init.body,
    });
  } catch (error) { throw new Error(error?.name === 'TimeoutError' ? 'Groq timed out' : 'Groq unreachable'); }
  if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
  try { return await response.json(); } catch { throw new Error('Groq sent invalid JSON'); }
}

export const runChat = (doFetch, key, body) =>
  post(doFetch, key, '/chat/completions', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, CHAT_TIMEOUT_MS)
    .then((data) => data?.choices?.[0]?.message?.content);

export async function runTranscribe(doFetch, key, file) {
  const data = await post(doFetch, key, '/audio/transcriptions', { headers: {}, body: transcribeForm(file) }, STT_TIMEOUT_MS);
  if (typeof data?.text !== 'string') throw new Error('Groq sent no text');
  return data.text;
}
