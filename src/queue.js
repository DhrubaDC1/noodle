import * as Network from 'expo-network';
import * as SecureStore from 'expo-secure-store';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { GROQ_KEY_NAME, GROQ_MODEL } from './config';
import { dueJob, nextJobTime, saveAnalysis, topTags } from './db';
import { analyzeThought, retryDelay } from './groq';

export function kickAnalysis() { DeviceEventEmitter.emit('analysisKick'); }
export function analysisChanged() { DeviceEventEmitter.emit('analysisChanged'); }

export default function AnalysisRunner() {
  const db = useSQLiteContext();
  const busy = useRef(false);
  useEffect(() => {
    let timer;
    let mounted = true;
    let canRun = true;
    async function drain() {
      if (busy.current || !mounted) return;
      busy.current = true;
      clearTimeout(timer);
      try {
        const key = await SecureStore.getItemAsync(GROQ_KEY_NAME);
        if (!mounted) return;
        if (!key) { canRun = false; return; }
        const network = await Network.getNetworkStateAsync();
        if (!mounted) return;
        if (network.isConnected === false || network.isInternetReachable === false) { canRun = false; return; }
        canRun = true;
        while (mounted) {
          const job = await dueJob(db);
          if (!mounted || !job) break;
          if (!await SecureStore.getItemAsync(GROQ_KEY_NAME)) { canRun = false; break; }
          if (!mounted) break;
          try {
            const tags = (await topTags(db)).map((row) => row.tag);
            if (!mounted) break;
            const value = await analyzeThought(key, job.text, tags);
            if (!mounted) break;
            if (await saveAnalysis(db, job, value, GROQ_MODEL)) analysisChanged();
          } catch (error) {
            if (!mounted) break;
            const attempts = job.attempts + 1;
            const reason = error?.message?.startsWith('Groq HTTP ') ? error.message :
              error?.message === 'Invalid JSON response' || error?.message === 'Invalid analysis response' ? error.message : 'Analysis request failed';
            await db.runAsync('UPDATE jobs SET attempts = ?, next_try_at = ?, last_error = ? WHERE id = ?',
              attempts, Date.now() + retryDelay(job.attempts), reason, job.id);
            if (reason === 'Analysis request failed') { canRun = false; break; }
          }
        }
      } catch {
        canRun = false;
      } finally {
        busy.current = false;
        if (mounted && canRun) {
          try {
            const next = await nextJobTime(db);
            if (next?.next_try_at != null) timer = setTimeout(drain, Math.max(1000, next.next_try_at - Date.now()));
          } catch { /* retry on next foreground or network event */ }
        }
      }
    }
    const kick = DeviceEventEmitter.addListener('analysisKick', () => { canRun = true; drain(); });
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') { canRun = true; drain(); } });
    const net = Network.addNetworkStateListener(async (state) => {
      if (mounted && state.isConnected && state.isInternetReachable !== false) {
        canRun = true;
        try {
          await db.runAsync('UPDATE jobs SET next_try_at = 0 WHERE last_error = ?', 'Analysis request failed');
          if (mounted) drain();
        } catch { /* database may close during teardown */ }
      }
    });
    drain();
    return () => { mounted = false; clearTimeout(timer); kick.remove(); app.remove(); net.remove(); };
  }, [db]);
  return null;
}
