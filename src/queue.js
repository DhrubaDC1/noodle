import * as Network from 'expo-network';
import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { GROQ_KEY_NAME, GROQ_MODEL } from './config';
import { deletedPairs, dueJob, embeddingRows, nextJobTime, pendingEmbeds, saveAnalysis, saveEmbedding, saveLinks, topTags } from './db';
import { getEmbedder } from './embeddingModel';
import { analyzeThought, linkThought, retryDelay } from './groq';
import { blobVector, LINK_THRESHOLD, topSimilar } from './similarity';

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
    let groqRetryAt = 0;
    async function drain() {
      if (busy.current || !mounted) return;
      busy.current = true;
      clearTimeout(timer);
      let key = null;
      let online = false;
      let changedEmbeddings = false;
      try {
        try { key = await SecureStore.getItemAsync(GROQ_KEY_NAME); } catch { /* local embeddings still run */ }
        try {
          const network = await Network.getNetworkStateAsync();
          online = network.isConnected !== false && network.isInternetReachable !== false;
        } catch { /* cached model still works offline */ }
        while (mounted) {
          const canGroq = Boolean(key && online && Date.now() >= groqRetryAt);
          const canEmbed = Date.now() >= embedRetryAt;
          let job = canGroq ? await dueJob(db, 'analyze') : null;
          if (!job && canEmbed) job = await dueJob(db, 'embed');
          if (!job && canGroq && !(await pendingEmbeds(db)).count) job = await dueJob(db, 'link');
          if (!job || !mounted) break;
          try {
            if (job.kind === 'analyze') {
              const tags = (await topTags(db)).map((row) => row.tag);
              const value = await analyzeThought(key, job.text, tags);
              if (mounted && await saveAnalysis(db, job, value, GROQ_MODEL)) analysisChanged();
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
              const chosen = (await linkThought(key, job.text, candidates)).map((link) => ({ ...link, id: randomUUID() }));
              if (mounted && await saveLinks(db, job, candidates, chosen)) analysisChanged();
            }
          } catch (error) {
            if (!mounted) break;
            const delay = retryDelay(job.attempts);
            const reason = error?.message?.startsWith('Groq HTTP ') || /^Invalid (JSON|analysis|links|Groq) response$/.test(error?.message ?? '')
              ? error.message : job.kind === 'embed' ? 'Embedding model unavailable' : job.kind === 'link' ? 'Connection request failed' : 'Analysis request failed';
            await db.runAsync('UPDATE jobs SET attempts = ?, next_try_at = ?, last_error = ? WHERE id = ?', job.attempts + 1, Date.now() + delay, reason, job.id);
            if (job.kind === 'embed') embedRetryAt = Date.now() + delay;
            else groqRetryAt = Date.now() + delay;
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
          if (key && online && now >= groqRetryAt) {
            kinds.push('analyze');
            if (!(await pendingEmbeds(db)).count) kinds.push('link');
          }
          const next = await nextJobTime(db, kinds);
          const times = [next?.next_try_at, embedRetryAt > now ? embedRetryAt : null, key && online && groqRetryAt > now ? groqRetryAt : null].filter((time) => time != null);
          if (times.length) timer = setTimeout(drain, Math.max(1000, Math.min(...times) - now));
        } catch { /* retry on next foreground or network event */ }
      }
    }
    async function resume() {
      embedRetryAt = 0; groqRetryAt = 0;
      try { await db.runAsync("UPDATE jobs SET next_try_at = 0 WHERE last_error IS NOT NULL"); }
      catch { return; }
      if (mounted) drain();
    }
    const kick = DeviceEventEmitter.addListener('analysisKick', resume);
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') resume(); });
    const net = Network.addNetworkStateListener((state) => {
      if (mounted && state.isConnected && state.isInternetReachable !== false) resume();
    });
    drain();
    return () => { mounted = false; clearTimeout(timer); kick.remove(); app.remove(); net.remove(); };
  }, [db]);
  return null;
}
