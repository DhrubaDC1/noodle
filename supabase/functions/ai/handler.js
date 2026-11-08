// The "ai" function's request handling, free of Deno and Supabase imports so it can be tested with fakes.
import { CHAT_MODEL, STT_MODEL } from './config.js';
import { LIMITS, parseAnalysis, parseLinks, validateAnalyze, validateAudio, validateLink } from './core.js';
import { analyzeBody, linkBody, runChat, runTranscribe } from './groq.js';

const reply = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (status, code, message) => reply(status, { error: { code, message } });
const tooBig = () => fail(413, 'payload_too_large', 'That request is too large.');

// deps: { authenticate(req) -> { userId, takeCall(cap) -> Promise<boolean> } | null, groqKey, cap, fetch? }
export async function handle(req, deps) {
  if (req.method !== 'GET' && req.method !== 'POST') return fail(405, 'bad_request', 'Use GET or POST.');
  const user = await deps.authenticate(req);
  if (!user) return fail(401, 'unauthorized', 'Sign in to use Noodle AI.');
  // Lets Settings show the model without spending a call.
  if (req.method === 'GET') return reply(200, { models: { chat: CHAT_MODEL, stt: STT_MODEL }, daily_cap: deps.cap });
  if (!deps.groqKey) { console.error('GROQ_API_KEY is not set'); return fail(503, 'not_configured', 'Noodle AI is not set up yet.'); }

  const input = await readInput(req);
  if (input.response) return input.response;
  const { action, body, file } = input;

  let checked;
  if (action === 'analyze') checked = validateAnalyze(body);
  else if (action === 'link') checked = validateLink(body);
  else if (action === 'transcribe') checked = validateAudio(file);
  else return fail(400, 'bad_request', 'action must be analyze, link or transcribe.');
  if (!checked.ok) return fail(400, 'bad_request', checked.message);

  // Counted before the Groq call, so a failing upstream cannot be used to dodge the cap.
  let allowed;
  try { allowed = await user.takeCall(deps.cap); } catch (error) { console.error('usage counter failed:', error?.message); return fail(500, 'server_error', 'Something went wrong. Try again.'); }
  if (!allowed) return fail(429, 'rate_limited', 'Daily AI limit reached. Try again tomorrow.');

  const doFetch = deps.fetch ?? fetch;
  try {
    if (action === 'analyze') {
      const content = await runChat(doFetch, deps.groqKey, analyzeBody(checked.value));
      return reply(200, { model: CHAT_MODEL, analysis: parseAnalysis(content) });
    }
    if (action === 'link') {
      const content = await runChat(doFetch, deps.groqKey, linkBody(checked.value));
      return reply(200, { model: CHAT_MODEL, links: parseLinks(content, checked.value.candidates) });
    }
    return reply(200, { model: STT_MODEL, text: await runTranscribe(doFetch, deps.groqKey, checked.value) });
  } catch (error) {
    console.error(`${action} failed:`, error?.message); // our own short messages, never a Groq body
    return fail(502, 'upstream_failed', 'The AI service could not answer. Try again later.');
  }
}

// Reads JSON (analyze, link) or multipart (transcribe) and enforces the body size caps.
async function readInput(req) {
  const length = Number(req.headers.get('content-length') ?? 0);
  try {
    if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      if (length > LIMITS.audioBytes + LIMITS.jsonBytes) return { response: tooBig() };
      const form = await req.formData();
      return { action: form.get('action'), file: form.get('file') };
    }
    if (length > LIMITS.jsonBytes) return { response: tooBig() };
    const text = await req.text();
    if (text.length > LIMITS.jsonBytes) return { response: tooBig() };
    const body = JSON.parse(text);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    return { action: body.action, body };
  } catch {
    return { response: fail(400, 'bad_request', 'The request body is not valid.') };
  }
}
