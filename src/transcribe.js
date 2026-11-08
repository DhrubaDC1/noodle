// Voice-thought logic kept free of React Native imports so scripts/selfcheck.mjs can run it.
import { saveTranscript } from './db.js';

// null for typed/shared thoughts. A voice thought keeps audio_path until it is transcribed:
// with a transcribe job it is "listening", without one (5 failures) it is "failed".
export function voiceState(item) {
  if (!item.audio_path) return null;
  return item.transcribing ? 'listening' : 'failed';
}

export function clock(ms) {
  const seconds = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function finalError(message) {
  return Object.assign(new Error(message), { final: true }); // retrying cannot help
}

// Transcribes, stores the text (which queues analyze/embed/link), then deletes the audio.
// Returns true when the transcript was saved.
export async function runTranscribe(db, job, { transcribe, removeAudio }) {
  if (!job.audio_path) throw finalError('Recording missing');
  const text = (await transcribe(job.audio_path)).trim();
  if (!text) throw finalError('No speech heard');
  const audioPath = await saveTranscript(db, job, text);
  if (audioPath === null) return false;
  try { await removeAudio(audioPath); } catch { /* a leftover file is harmless; the text is saved */ }
  return true;
}
