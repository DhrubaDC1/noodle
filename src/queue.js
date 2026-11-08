import * as Network from 'expo-network';
import { randomUUID } from 'expo-crypto';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { AiError, analyzeThought, linkThought, retryDelay, transcribeAudio } from './ai';
import { aiClient, getAccessToken, supabase } from './auth';
import { audioFile, removeAudio } from './audio';
import { deletedPairs, dueJob, embeddingRows, failTranscribe, nextJobTime, pendingEmbeds, saveAnalysis, saveEmbedding, saveLinks, topTags } from './db';
import { getEmbedder } from './embeddingModel';
import { blobVector, LINK_THRESHOLD, topSimilar } from './similarity';
import { finalError, runTranscribe } from './transcribe';
import { LIMITS } from '../supabase/functions/ai/core';

export function kickAnalysis() { DeviceEventEmitter.emit('analysisKick'); }
export function analysisChanged() { DeviceEventEmitter.emit('analysisChanged'); }
export function embeddingChanged() { DeviceEventEmitter.emit('embeddingChanged'); }

export default function AnalysisRunner() {
  const db = useSQLiteContext();
  const busy = useRef(false);
  useEffect(() => {
    let timer;
    let mounted = true;
    let embedRetryAt = 0;
    let aiRetryAt = 0;
    async function drain() {
      if (busy.current || !mounted) return;
      busy.current = true;
      clearTimeout(timer);
      let signedIn = false;
      let online = false;
      let changedEmbeddings = false;
      try {
        signedIn = Boolean(await getAccessToken()); // signed out: AI jobs wait quietly, local embeddings still run
        try {
          const network = await Network.getNetworkStateAsync();
          online = network.isConnected !== false && network.isInternetReachable !== false;
        } catch { /* cached model still works offline */ }
        while (mounted) {
          const canAi = Boolean(signedIn && online && Date.now() >= aiRetryAt);
          const canEmbed = Date.now() >= embedRetryAt;
          // Transcription first: a voice thought has no analyze/embed/link jobs until it succeeds.
          let job = canAi ? await dueJob(db, 'transcribe') : null;
          if (!job && canAi) job = await dueJob(db, 'analyze');
          if (!job && canEmbed) job = await dueJob(db, 'embed');
          if (!job && canAi && !(await pendingEmbeds(db)).count) job = await dueJob(db, 'link');
          if (!job || !mounted) break;
          try {
            if (job.kind === 'transcribe') {
              const done = await runTranscribe(db, job, { removeAudio, transcribe: (path) => {
                const file = audioFile(path);
                if (!file.exists) throw finalError('Recording file missing');
                if (file.size > LIMITS.audioBytes) throw finalError('Recording too large');
                return transcribeAudio(aiClient, file); // expo-file-system File is a Blob, which Expo's fetch uploads
              } });
              if (mounted && done) analysisChanged();
            } else if (job.kind === 'analyze') {
              const tags = (await topTags(db)).map((row) => row.tag);
              const { value, model } = await analyzeThought(aiClient, job.text, tags);
              if (mounted && await saveAnalysis(db, job, value, model)) analysisChanged();
            } else if (job.kind === 'embed') {
              const vector = await (await getEmbedder()).embed(job.text);
              if (mounted && await saveEmbedding(db, job, vector)) changedEmbeddings = true;
            } else {
              const rows = await embeddingRows(db);
              const current = rows.find((row) => row.id === job.thought_id);
              if (!current) throw new Error('Embedding unavailable');
              const ignored = new Set([job.thought_id]);
              for (const pair of await deletedPairs(db, job.thought_id)) ignored.add(pair.from_id === job.thought_id ? pair.to_id : pair.from_id);
              const candidates = topSimilar(blobVector(current.vector), rows, 8, LINK_THRESHOLD, ignored);
              const chosen = (await linkThought(aiClient, job.text, candidates)).links.map((link) => ({ ...link, id: randomUUID() }));
              if (mounted && await saveLinks(db, job, candidates, chosen)) analysisChanged();
            }
          } catch (error) {
            if (!mounted) break;
            // Signed out mid-run, or the server refuses the session: not the job's fault, so it keeps its attempts.
            if (error instanceof AiError && error.code === 'unauthorized') { aiRetryAt = Date.now() + 60000; break; }
            if (error instanceof AiError && error.code === 'rate_limited') { // the cap resets daily; waiting must not use up a voice note's retries
              aiRetryAt = Date.now() + 3600000;
              await db.runAsync('UPDATE jobs SET next_try_at = ?, last_error = ? WHERE id = ?', aiRetryAt, error.message, job.id);
              break;
            }
            const delay = retryDelay(job.attempts);
            const known = error?.final || error instanceof AiError || /^Invalid AI response$/.test(error?.message ?? '');
            const reason = known ? error.message : job.kind === 'embed' ? 'Embedding model unavailable' : job.kind === 'link' ? 'Connection request failed' : job.kind === 'transcribe' ? 'Transcription request failed' : 'Analysis request failed';
            if (job.kind === 'transcribe') {
              if (await failTranscribe(db, job, reason, delay, error?.final) === 'failed') { analysisChanged(); continue; }
            } else await db.runAsync('UPDATE jobs SET attempts = ?, next_try_at = ?, last_error = ? WHERE id = ?', job.attempts + 1, Date.now() + delay, reason, job.id);
            if (job.kind === 'embed') embedRetryAt = Date.now() + delay;
            else aiRetryAt = Date.now() + delay;
          }
        }
      } catch { /* retry when app foregrounds */ }
      finally {
        busy.current = false;
        if (changedEmbeddings && mounted) embeddingChanged();
        if (!mounted) return;
        try {
          const now = Date.now();
          const kinds = [];
          if (now >= embedRetryAt) kinds.push('embed');
          if (signedIn && online && now >= aiRetryAt) {
            kinds.push('transcribe', 'analyze');
            if (!(await pendingEmbeds(db)).count) kinds.push('link');
          }
          const next = await nextJobTime(db, kinds);
          const times = [next?.next_try_at, embedRetryAt > now ? embedRetryAt : null, signedIn && online && aiRetryAt > now ? aiRetryAt : null].filter((time) => time != null);
          if (times.length) timer = setTimeout(drain, Math.max(1000, Math.min(...times) - now));
        } catch { /* retry on next foreground or network event */ }
      }
    }
    async function resume() {
      embedRetryAt = 0; aiRetryAt = 0;
      try { await db.runAsync("UPDATE jobs SET next_try_at = 0 WHERE last_error IS NOT NULL"); }
      catch { return; }
      if (mounted) drain();
    }
    const kick = DeviceEventEmitter.addListener('analysisKick', resume);
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') resume(); });
    // Signing in starts the waiting jobs. Hop out of the callback first: Supabase calls inside it can deadlock.
    const auth = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => { if (mounted) resume(); }, 0);
    });
    const net = Network.addNetworkStateListener((state) => {
      if (mounted && state.isConnected && state.isInternetReachable !== false) resume();
    });
    drain();
    return () => { mounted = false; clearTimeout(timer); kick.remove(); app.remove(); net.remove(); auth?.data.subscription.unsubscribe(); };
  }, [db]);
  return null;
}
