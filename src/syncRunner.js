// Runs src/sync.js in the background while signed in and sync is switched on (Settings). Saving a
// thought never waits for it: it only reacts to events (saved, analysed, app in front, online again).
import * as Network from 'expo-network';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { retryDelay } from './ai';
import { supabase, useSession } from './auth';
import { getSyncState, setSyncState } from './db';
import { analysisChanged, kickAnalysis } from './queue';
import { syncOnce } from './sync';

export const SYNC_ENABLED = 'enabled';
export function syncNow() { DeviceEventEmitter.emit('syncKick'); }
const changed = (syncing) => DeviceEventEmitter.emit('syncChanged', { syncing });

const remote = {
  async push(payload) {
    const { error } = await supabase.rpc('sync_push', { payload });
    if (error) throw error;
  },
  async pull(table, since, limit) {
    const { data, error } = await supabase.from(table).select('*').gt('synced_at', since).order('synced_at', { ascending: true }).limit(limit);
    if (error) throw error;
    return data;
  },
};

// Short text for Settings; the server's own message is never shown.
const reason = (error) => (error?.code ? 'The server refused it' : 'No connection');

export default function SyncRunner() {
  const db = useSQLiteContext();
  const { session } = useSession();
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId || !supabase) return undefined;
    let mounted = true;
    let busy = false;
    let again = false;
    let attempts = 0;
    let timer;
    const later = (ms) => { clearTimeout(timer); timer = setTimeout(run, ms); };
    async function run() {
      if (busy) { again = true; return; }
      busy = true;
      clearTimeout(timer);
      try {
        if ((await getSyncState(db))[SYNC_ENABLED] !== '1') return;
        const network = await Network.getNetworkStateAsync();
        if (network.isConnected === false || network.isInternetReachable === false) return;
        changed(true);
        const { pulled } = await syncOnce(db, remote, userId);
        attempts = 0;
        if (pulled && mounted) { analysisChanged(); kickAnalysis(); } // refresh lists; embed what arrived
      } catch (error) {
        attempts += 1;
        try { await setSyncState(db, 'last_error', reason(error)); } catch { /* nothing more to do */ }
        if (mounted) later(retryDelay(attempts + 3)); // 32 s, 64 s, ... up to an hour
      } finally {
        busy = false;
        if (mounted) { changed(false); if (again) { again = false; later(1000); } }
      }
    }
    const soon = () => later(4000); // let a burst of edits settle
    const subs = [
      DeviceEventEmitter.addListener('analysisKick', soon), // a thought was saved or retried
      DeviceEventEmitter.addListener('analysisChanged', soon), // analysis or links finished
      DeviceEventEmitter.addListener('localChanged', soon), // deleted, done or archived here
      DeviceEventEmitter.addListener('syncKick', () => { attempts = 0; later(0); }),
      AppState.addEventListener('change', (state) => { if (state === 'active') later(500); }),
      Network.addNetworkStateListener((state) => { if (state.isConnected && state.isInternetReachable !== false) later(1000); }),
    ];
    later(500);
    return () => { mounted = false; clearTimeout(timer); subs.forEach((sub) => sub.remove()); };
  }, [db, userId]);
  return null;
}
