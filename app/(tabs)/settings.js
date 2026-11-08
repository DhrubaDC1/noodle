import Storage from 'expo-sqlite/kv-store';
import { useSQLiteContext } from 'expo-sqlite';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, DeviceEventEmitter, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { aiInfo } from '../../src/ai';
import { aiClient, signOut, useSession } from '../../src/auth';
import { getSyncState, setSyncState } from '../../src/db';
import { NoodleMark } from '../../src/icons';
import { embeddingModelStatus } from '../../src/embeddingModel';
import { kickAnalysis } from '../../src/queue';
import { SYNC_ENABLED, syncNow } from '../../src/syncRunner';
import { listTime } from '../../src/ui';
import { font, radius, sticker, type, useTheme } from '../../src/theme';

export const REMINDERS_SETTING = 'suggest_reminders';
const AI_MODEL_CACHE = 'ai_model'; // last model name the function reported, shown while signed out

function TileIcon({ name, color }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    {name === 'cloud' ? <Path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.6 1.5A3.8 3.8 0 0 1 17.5 18Z" /> : name === 'user' ? <><Circle cx="12" cy="8" r="4" /><Path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></> :
      name === 'out' ? <Path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" /> :
      name === 'model' ? <><Rect x="5" y="5" width="14" height="14" rx="3" /><Path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></> :
      name === 'share' ? <Path d="M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /> :
      <><Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>}
  </Svg>;
}

export default function Settings() {
  const db = useSQLiteContext();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const [aiModel, setAiModel] = useState(null);
  const [suggest, setSuggest] = useState(true);
  const [model, setModel] = useState(embeddingModelStatus);
  const [sync, setSync] = useState({});
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('embeddingModelChanged', setModel);
    return () => subscription.remove();
  }, []);

  const loadSync = useCallback(() => { getSyncState(db).then(setSync).catch(() => {}); }, [db]);
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('syncChanged', (event) => { setSyncing(Boolean(event?.syncing)); loadSync(); });
    return () => subscription.remove();
  }, [loadSync]);

  const signedIn = Boolean(session);
  useFocusEffect(useCallback(() => {
    Storage.getItem(REMINDERS_SETTING).then((value) => setSuggest(value !== 'off')).catch(() => Alert.alert('Could not read setting'));
    loadSync();
    Storage.getItem(AI_MODEL_CACHE).then((value) => value && setAiModel(value)).catch(() => {});
    if (!signedIn) return;
    // Ask the function which model it uses; this costs no AI call. Offline or failing: keep the cached name.
    aiInfo(aiClient).then((models) => { setAiModel(models.chat); return Storage.setItem(AI_MODEL_CACHE, models.chat); }).catch(() => {});
  }, [signedIn, loadSync]));

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Your thoughts stay on this phone. New ones wait for the AI until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut().catch(() => Alert.alert('Could not sign out')) },
    ]);
  }

  const syncOn = sync[SYNC_ENABLED] === '1';
  async function setSyncOn(on) {
    try { await setSyncState(db, SYNC_ENABLED, on ? '1' : '0'); loadSync(); if (on) syncNow(); }
    catch { Alert.alert('Could not change sync'); }
  }
  function toggleSync() {
    if (syncOn) { setSyncOn(false); return; }
    Alert.alert('Sync your thoughts?', 'Every thought on this phone is copied to your Noodle account, so your other phones can get it. Turning sync off later stops new copies; ones already saved stay on the server.', [
      { text: 'Not now', style: 'cancel' },
      { text: 'Sync', onPress: () => setSyncOn(true) },
    ]);
  }
  const syncNote = !signedIn ? 'Sign in, then switch sync on to keep your thoughts on every phone.'
    : !syncOn ? 'Off. Your thoughts stay on this phone.'
    : syncing ? 'Syncing…'
    : sync.last_error ? `Waiting: ${sync.last_error}. Tap to try again.`
    : sync.last_synced ? `Synced ${listTime(Number(sync.last_synced))}. Tap to sync now.` : 'Getting ready…';

  async function toggleSuggest() {
    const next = !suggest;
    try { await Storage.setItem(REMINDERS_SETTING, next ? 'on' : 'off'); setSuggest(next); }
    catch { Alert.alert('Could not save setting'); }
  }

  return <View style={[styles.screen, { backgroundColor: c.bg }]}>
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}><Text style={[type.screenTitle, { color: c.text }]}>Settings</Text></View>
    <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}>
      <View style={styles.section}>
        <Text style={[styles.heading, { color: c.text }]}>AI</Text>
        <View style={[styles.group, sticker(c), { backgroundColor: c.surface }]}>
          {signedIn ? <>
            <View style={[styles.row, { borderBottomColor: c.sunken, borderBottomWidth: 2 }]}>
              <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="user" color={c.text} /></View>
              <Text style={[type.row, { color: c.text }]}>Account</Text>
              <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.value, styles.email, { color: c.muted }]}>{session.user.email}</Text>
            </View>
            <Pressable onPress={confirmSignOut} accessibilityRole="button" style={[styles.row, { borderBottomColor: c.sunken, borderBottomWidth: 2 }]}>
              <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="out" color={c.text} /></View>
              <Text style={[type.row, { color: c.text, flex: 1 }]}>Sign out</Text>
              <Text style={[styles.chevron, { color: c.muted }]}>›</Text>
            </Pressable>
          </> : (
            <Pressable onPress={() => router.push('/sign-in')} accessibilityRole="button" style={[styles.row, { borderBottomColor: c.sunken, borderBottomWidth: 2 }]}>
              <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="user" color={c.text} /></View>
              <Text style={[type.row, { color: c.text, flex: 1 }]}>Sign in</Text>
              <Text style={[styles.value, { color: c.muted }]}>AI is off</Text>
              <Text style={[styles.chevron, { color: c.muted }]}>›</Text>
            </Pressable>
          )}
          <View style={styles.row}>
            <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="model" color={c.text} /></View>
            <Text style={[type.row, { color: c.text, flex: 1 }]}>Model</Text>
            <Text style={[styles.value, { color: c.muted }]}>{aiModel ? aiModel.split('/').at(-1) : signedIn ? 'Checking…' : 'Sign in to see'}</Text>
          </View>
          <View style={[styles.row, { borderTopColor: c.sunken, borderTopWidth: 2 }]}>
            <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="model" color={c.text} /></View>
            <Text style={[type.row, { color: c.text, flex: 1 }]}>On-device model</Text>
            <Text style={[styles.value, { color: c.muted }]}>{model.state === 'downloading' ? `${Math.round(model.progress * 100)}%` : model.state === 'ready' ? 'Ready' : model.state === 'loading' ? 'Loading' : model.state === 'unavailable' ? 'App build needed' : model.state === 'error' ? 'Waiting' : 'Not downloaded'}</Text>
          </View>
        </View>
        {model.state === 'error' && <Pressable onPress={async () => {
          try { await db.runAsync("UPDATE jobs SET next_try_at = 0 WHERE kind = 'embed'"); kickAnalysis(); }
          catch { Alert.alert('Could not retry download'); }
        }} accessibilityRole="button" style={styles.retry}><Text style={[type.meta, { color: c.text }]}>Model download failed. Retry</Text></Pressable>}
        {model.state === 'unavailable' && <Text style={[styles.note, { color: c.muted }]}>Linked thoughts and meaning search need an installed development build. Expo Go can only search matching words.</Text>}
        <Text style={[styles.note, { color: c.muted }]}>{signedIn ? "Thoughts go to Noodle's AI service only to be tagged and linked. They are not kept there." : 'Without an account, everything still works except tags and links. Thoughts waiting for the AI are processed once you sign in.'}</Text>
      </View>
      <View style={styles.section}>
        <Text style={[styles.heading, { color: c.text }]}>Reminders</Text>
        <View style={[styles.group, sticker(c), { backgroundColor: c.surface }]}>
          <Pressable onPress={toggleSuggest} accessibilityRole="switch" accessibilityState={{ checked: suggest }} style={styles.row}>
            <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="bell" color={c.text} /></View>
            <Text style={[type.row, { color: c.text, flex: 1 }]}>Suggest reminders</Text>
            <View style={[styles.switch, { backgroundColor: suggest ? c.ink : c.line }]}><View style={[styles.knob, { backgroundColor: c.idea, alignSelf: suggest ? 'flex-end' : 'flex-start' }]} /></View>
          </Pressable>
        </View>
      </View>
      <View style={styles.section}>
        <Text style={[styles.heading, { color: c.text }]}>Backup and sync</Text>
        <View style={[styles.group, sticker(c), { backgroundColor: c.surface }]}>
          {signedIn ? (
            <Pressable onPress={toggleSync} accessibilityRole="switch" accessibilityState={{ checked: syncOn }} style={styles.row}>
              <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="cloud" color={c.text} /></View>
              <Text style={[type.row, { color: c.text, flex: 1 }]}>Sync my thoughts</Text>
              <View style={[styles.switch, { backgroundColor: syncOn ? c.ink : c.line }]}><View style={[styles.knob, { backgroundColor: c.idea, alignSelf: syncOn ? 'flex-end' : 'flex-start' }]} /></View>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push('/sign-in')} accessibilityRole="button" style={styles.row}>
              <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="cloud" color={c.text} /></View>
              <Text style={[type.row, { color: c.text, flex: 1 }]}>Sign in to sync</Text>
              <Text style={[styles.value, { color: c.muted }]}>Off</Text>
              <Text style={[styles.chevron, { color: c.muted }]}>›</Text>
            </Pressable>
          )}
        </View>
        <Pressable disabled={!syncOn || syncing} onPress={syncNow} accessibilityRole="button" style={styles.syncNote}>
          <Text style={[styles.note, { color: c.muted, marginHorizontal: 0 }]}>{syncNote}</Text>
        </Pressable>
      </View>
      <View style={styles.section}>
        <Text style={[styles.heading, { color: c.text }]}>Sharing</Text>
        <View style={[styles.group, sticker(c), { backgroundColor: c.surface }]}>
          <Pressable disabled={Platform.OS !== 'android'} accessibilityRole="button" accessibilityState={{ disabled: Platform.OS !== 'android' }}
            onPress={() => Alert.alert('Share to Noodle', 'In Chrome or any app, tap Share and pick Noodle. The text lands in the compose box so you can edit it, then tap Save.')} style={styles.row}>
            <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="share" color={c.text} /></View>
            <Text style={[type.row, { color: c.text, flex: 1 }]}>Share from other apps</Text>
            {Platform.OS === 'android' ? <Text style={[styles.chevron, { color: c.muted }]}>›</Text> : <Text style={[styles.value, { color: c.muted }]}>Coming soon</Text>}
          </Pressable>
        </View>
      </View>
      <View style={styles.footer}><NoodleMark size={40} color={c.ink} bg={c.bg} /><Text style={[styles.footerText, { color: c.muted }]}>noodle 1.0 · made for one busy brain</Text></View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { paddingHorizontal: 20, paddingBottom: 14 }, body: { paddingHorizontal: 16, paddingTop: 2, gap: 20 },
  section: { gap: 8 }, heading: { marginHorizontal: 4, fontFamily: font.bricolage700, fontSize: 16 },
  group: { borderRadius: radius.lg, overflow: 'hidden' }, row: { minHeight: 58, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  value: { fontFamily: font.figtree600, fontSize: 14 }, chevron: { fontSize: 25, lineHeight: 25 },
  note: { marginHorizontal: 4, fontFamily: font.figtree400, fontSize: 13, lineHeight: 18 },
  switch: { width: 52, height: 32, borderRadius: 16, padding: 4 }, knob: { width: 24, height: 24, borderRadius: 12 },
  footer: { marginTop: 4, alignItems: 'center', gap: 4 }, footerText: { fontFamily: font.figtree600, fontSize: 12 },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  syncNote: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  email: { flex: 1, textAlign: 'right' },
});
