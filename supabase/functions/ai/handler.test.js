// Input validation, daily cap and error hygiene of the "ai" function, with fakes for auth, the
// counter and Groq. Run: npm run test:function   (Node 22; also runs under `deno test`).
// The real counter (take_ai_call) is covered by supabase/tests/database/ai_usage.test.sql.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handle } from './handler.js';
import { CHAT_MODEL, STT_MODEL } from './config.js';
import { LIMITS } from './core.js';

const KEY = 'gsk_test_secret_key';
const analysis = { title: 'Trip with Nadia', type: 'todo', tags: ['travel'], entities: ['Nadia'], reminder_at: null };

// Same rule as take_ai_call: count a call, refuse once the user is at the cap.
function setup({ cap = 500, signedIn = true, groq } = {}) {
  const state = { used: 0, groqCalls: [] };
  const deps = {
    cap, groqKey: KEY,
    authenticate: async () => signedIn ? { userId: 'u1', takeCall: async (limit) => state.used < limit && ++state.used > 0 } : null,
    fetch: async (url, init) => {
      state.groqCalls.push({ url, init });
      return groq ? groq(url, init) : Response.json({ choices: [{ message: { content: JSON.stringify(analysis) } }] });
    },
  };
  return { state, call: (req) => handle(req, deps) };
}
const post = (body, headers = {}) => new Request('http://fn/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const audio = (bytes, action = 'transcribe') => {
  const form = new FormData();
  if (action) form.append('action', action);
  if (bytes != null) form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/mp4' }), 'voice.m4a');
  return new Request('http://fn/ai', { method: 'POST', body: form });
};
const errorOf = async (response) => (await response.json()).error;

test('requires a signed-in user', async () => {
  const { call, state } = setup({ signedIn: false });
  const response = await call(post({ action: 'analyze', text: 'hi' }));
  assert.equal(response.status, 401);
  assert.equal((await errorOf(response)).code, 'unauthorized');
  assert.equal(state.groqCalls.length, 0);
});

test('GET reports the models without spending a call', async () => {
  const { call, state } = setup({ cap: 7 });
  const response = await call(new Request('http://fn/ai'));
  assert.deepEqual(await response.json(), { models: { chat: CHAT_MODEL, stt: STT_MODEL }, daily_cap: 7 });
  assert.equal(state.used, 0);
});

test('analyze builds a Groq request and returns the checked result', async () => {
  const { call, state } = setup();
  const response = await call(post({ action: 'analyze', text: ' Trip with Nadia ', tags: ['travel', 'Not A Tag'] }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { model: CHAT_MODEL, analysis });
  const { url, init } = state.groqCalls[0];
  assert.match(url, /\/chat\/completions$/);
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  const sent = JSON.parse(init.body);
  assert.equal(sent.model, CHAT_MODEL);
  assert.equal(sent.messages[1].content, 'Trip with Nadia');
  assert.match(sent.messages[0].content, /Prefer existing tags when suitable: travel\./, 'malformed tags are dropped');
});

test('link validates candidates and returns only known ids', async () => {
  const links = { links: [{ candidate_id: 'b', relation: 'follow-up', reason: ' Same trip. ' }, { candidate_id: 'zzz', relation: 'follow-up', reason: 'x' }] };
  const { call } = setup({ groq: () => Response.json({ choices: [{ message: { content: JSON.stringify(links) } }] }) });
  const body = { action: 'link', text: 'Trip', candidates: [{ id: 'b', text: 'Call Nadia', title: null }] };
  assert.equal((await call(post(body))).status, 502, 'a link to an unknown id is a bad model answer');
  links.links.pop();
  const ok = await call(post(body));
  assert.deepEqual((await ok.json()).links, [{ candidate_id: 'b', relation: 'follow-up', reason: 'Same trip.' }]);
});

test('transcribe sends the file to Groq whisper', async () => {
  const { call, state } = setup({ groq: () => Response.json({ text: ' hello ' }) });
  const response = await call(audio(100));
  assert.deepEqual(await response.json(), { model: STT_MODEL, text: ' hello ' });
  const form = state.groqCalls[0].init.body;
  assert.equal(form.get('model'), STT_MODEL);
  assert.equal(form.get('language'), 'en');
  assert.equal(form.get('file').size, 100);
});

const bad = [
  ['missing action', post({ text: 'hi' })],
  ['unknown action', post({ action: 'delete', text: 'hi' })],
  ['body is not JSON', post('{nope')],
  ['body is an array', post('[1]')],
  ['analyze: no text', post({ action: 'analyze' })],
  ['analyze: blank text', post({ action: 'analyze', text: '   ' })],
  ['analyze: text too long', post({ action: 'analyze', text: 'a'.repeat(LIMITS.text + 1) })],
  ['analyze: tags not a list', post({ action: 'analyze', text: 'hi', tags: 'travel' })],
  ['link: no candidates', post({ action: 'link', text: 'hi', candidates: [] })],
  ['link: 9 candidates', post({ action: 'link', text: 'hi', candidates: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, text: 'x' })) })],
  ['link: duplicate ids', post({ action: 'link', text: 'hi', candidates: [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }] })],
  ['link: candidate text too long', post({ action: 'link', text: 'hi', candidates: [{ id: 'a', text: 'x'.repeat(LIMITS.candidateText + 1) }] })],
  ['transcribe: no file', audio(null)],
  ['transcribe: empty file', audio(0)],
  ['transcribe: file over the cap', audio(LIMITS.audioBytes + 1)],
];
for (const [name, request] of bad) {
  test(`rejects ${name} without spending a call or calling Groq`, async () => {
    const { call, state } = setup();
    const response = await call(request);
    assert.ok([400, 413].includes(response.status), `status ${response.status}`);
    assert.ok((await errorOf(response)).code);
    assert.equal(state.used, 0);
    assert.equal(state.groqCalls.length, 0);
  });
}

test('rejects a body whose content-length is over the cap', async () => {
  const { call, state } = setup();
  const response = await call(post({ action: 'analyze', text: 'hi' }, { 'content-length': String(LIMITS.jsonBytes + 1) }));
  assert.equal(response.status, 413);
  assert.equal(state.groqCalls.length, 0);
});

test('stops at the daily cap with a clear error', async () => {
  const { call, state } = setup({ cap: 3 });
  for (let i = 0; i < 3; i += 1) assert.equal((await call(post({ action: 'analyze', text: `thought ${i}` }))).status, 200);
  const response = await call(post({ action: 'analyze', text: 'one too many' }));
  assert.equal(response.status, 429);
  const error = await errorOf(response);
  assert.equal(error.code, 'rate_limited');
  assert.match(error.message, /Daily AI limit reached/);
  assert.equal(state.groqCalls.length, 3, 'the refused call never reached Groq');
});

test('never echoes the key or Groq errors', async () => {
  const leaky = [
    () => new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status: 401 }),
    () => { throw new Error(`connect failed with ${KEY}`); },
    () => Response.json({ choices: [{ message: { content: 'not json' } }] }),
  ];
  for (const groq of leaky) {
    const { call } = setup({ groq });
    const response = await call(post({ action: 'analyze', text: 'hi' }));
    assert.equal(response.status, 502);
    const text = JSON.stringify(await response.json());
    assert.ok(!text.includes(KEY) && !/connect failed|bad key|not json/.test(text), text);
    assert.equal((JSON.parse(text)).error.code, 'upstream_failed');
  }
});

test('answers 503 when the Groq secret is missing', async () => {
  const response = await handle(post({ action: 'analyze', text: 'hi' }), { cap: 5, groqKey: undefined, authenticate: async () => ({ userId: 'u', takeCall: async () => true }) });
  assert.equal(response.status, 503);
});
