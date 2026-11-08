// Calls to the Supabase Edge Function "ai" (analyze, link, transcribe). Free of React Native imports so
// scripts/selfcheck.mjs can run it. `client` is { url, publishableKey, getToken() -> access token or null }.
import { checkAnalysis, checkLinks, LIMITS } from '../supabase/functions/ai/core.js';

export function retryDelay(attempts) {
  return Math.min(3600000, 2000 * 2 ** Math.min(attempts, 11));
}

// Short text for the "Retrying: …" line on a card, keyed by the function's error code.
const MESSAGES = {
  unauthorized: 'Sign in again',
  rate_limited: 'Daily AI limit reached',
  not_configured: 'AI is not set up yet',
  upstream_failed: 'AI service busy',
  payload_too_large: 'Too large for AI',
};

export class AiError extends Error {
  constructor(status, code) {
    super(MESSAGES[code] ?? (status === 401 ? MESSAGES.unauthorized : `AI HTTP ${status}`));
    this.status = status;
    this.code = status === 401 ? 'unauthorized' : code;
  }
}

function clip(text, max) {
  let out = text.slice(0, max);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1); // don't split an emoji
  return out;
}

async function call(client, { body, json = true, method = 'POST', timeoutMs }) {
  const token = await client.getToken();
  if (!token) throw new AiError(401, 'unauthorized');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${client.url}/functions/v1/ai`, {
      method, signal: controller.signal, body,
      // No Content-Type for FormData: fetch adds the multipart boundary.
      headers: { Authorization: `Bearer ${token}`, apikey: client.publishableKey, ...(json && body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } finally { clearTimeout(timeout); }
  let data = null;
  try { data = await response.json(); } catch { /* error pages may not be JSON */ }
  if (!response.ok) throw new AiError(response.status, data?.error?.code);
  if (!data || typeof data !== 'object') throw new Error('Invalid AI response');
  return data;
}

export async function analyzeThought(client, text, tags) {
  const data = await call(client, { timeoutMs: 25000, body: JSON.stringify({ action: 'analyze', text: clip(text, LIMITS.text), tags: tags.slice(0, LIMITS.tags) }) });
  try { return { value: checkAnalysis(data.analysis), model: String(data.model) }; } catch { throw new Error('Invalid AI response'); }
}

export async function linkThought(client, text, candidates) {
  if (!candidates.length) return { links: [], model: null };
  const list = candidates.slice(0, LIMITS.candidates).map(({ id, text: body, title }) => ({ id, text: clip(body, LIMITS.candidateText), title: title ? clip(title, LIMITS.title) : null }));
  const data = await call(client, { timeoutMs: 25000, body: JSON.stringify({ action: 'link', text: clip(text, LIMITS.text), candidates: list }) });
  try { return { links: checkLinks(data, list), model: String(data.model) }; } catch { throw new Error('Invalid AI response'); }
}

// `file` is a Blob: an expo-file-system File in the app (Expo's fetch rejects React Native's {uri} parts), a plain Blob in the self-check.
export async function transcribeAudio(client, file) {
  const form = new FormData();
  form.append('action', 'transcribe');
  form.append('file', file, 'voice.m4a');
  const data = await call(client, { json: false, timeoutMs: 65000, body: form });
  if (typeof data.text !== 'string') throw new Error('Invalid AI response');
  return data.text;
}

// Model names for Settings; costs no AI call.
export async function aiInfo(client) {
  const data = await call(client, { method: 'GET', timeoutMs: 15000 });
  if (typeof data.models?.chat !== 'string') throw new Error('Invalid AI response');
  return data.models;
}
