// Capture — Capture.dc.html / CaptureEmpty.dc.html. Phase 1: typed text and
// the list; no tags, pills, reminders or linked thoughts yet.
import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { useShareIntentContext } from 'expo-share-intent';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, Keyboard, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addThought, listThoughts, retryTranscribe } from '../../src/db';
import { useVoiceRecorder } from '../../src/audio';
import { shareText } from '../../src/share';
import { NoodleMark } from '../../src/icons';
import { CaptureEmpty, ComposeBox, SectionTitle, ThoughtCard, daySections, headerDate, listTime } from '../../src/ui';
import { type, useTheme } from '../../src/theme';
import { useSession } from '../../src/auth';
import { kickAnalysis } from '../../src/queue';

// Room for the floating tab bar (54px items + 12px padding + 4px borders),
// the 26px space under it from the mock, and the home indicator.
const TAB_BAR_CLEARANCE = 26 + 70;

export default function Capture() {
  const db = useSQLiteContext();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [source, setSource] = useState('typed');
  const [items, setItems] = useState([]);
  const { session, ready } = useSession();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(() => {
    listThoughts(db).then((rows) => { if (mounted.current) setItems(rows); })
      .catch(() => { if (mounted.current) Alert.alert('Could not load thoughts'); });
  }, [db]);
  useFocusEffect(load);
  useEffect(() => {
    const changed = DeviceEventEmitter.addListener('analysisChanged', load);
    return () => changed.remove();
  }, [load]);

  const onVoiceSaved = useCallback(() => { load(); kickAnalysis(); }, [load]);
  const voice = useVoiceRecorder(db, onVoiceSaved);

  // Android share sheet: pre-fill the compose box; the user edits and taps Save (never auto-saved).
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!hasShareIntent) return;
    const shared = shareText(shareIntent);
    resetShareIntent();
    if (!shared) return;
    // Syncing an Android intent (external system) into the compose box.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${shared}` : shared));
    setSource('share');
    router.navigate('/');
  }, [hasShareIntent, shareIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  async function retry(item) {
    try { await retryTranscribe(db, item.id); load(); kickAnalysis(); }
    catch { Alert.alert('Could not retry'); }
  }

  async function save() {
    const t = text.trim();
    if (!t) return;
    try {
      await addThought(db, randomUUID(), t, source);
      setText(''); // only clear once it is safely stored
      setSource('typed');
      Keyboard.dismiss();
      load();
      kickAnalysis();
    } catch (e) {
      Alert.alert('Could not save', String(e?.message ?? e));
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <NoodleMark size={36} color={c.ink} bg={c.bg} />
        <Text style={[type.wordmark, { color: c.text }]}>noodle</Text>
        <View style={{ flex: 1 }} />
        <Text style={[type.meta, { color: c.muted }]}>{headerDate()}</Text>
      </View>
      <ComposeBox value={text} onChangeText={(value) => { setText(value); if (!value) setSource('typed'); }} onSave={save} voice={voice} />
      {ready && !session && (
        <Pressable onPress={() => router.push('/sign-in')} accessibilityRole="button" style={styles.signInHint}>
          <Text style={[type.meta, { color: c.muted, textDecorationLine: 'underline' }]}>Sign in to switch on Noodle&apos;s AI</Text>
        </Pressable>
      )}
      <SectionList
        sections={daySections(items)}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.list, { paddingTop: 26, paddingBottom: TAB_BAR_CLEARANCE + insets.bottom }]}
        renderSectionHeader={({ section }) => (
          <SectionTitle
            note={section.data.length === 1 ? '1 thought' : `${section.data.length} thoughts`}
            style={section.notFirst && styles.sectionAfter}
          >
            {section.title}
          </SectionTitle>
        )}
        renderItem={({ item }) => <ThoughtCard item={item} time={listTime(item.created_at)} onRetry={retry} />}
        ItemSeparatorComponent={CardGap}
        ListEmptyComponent={<CaptureEmpty />}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}

const CardGap = () => <View style={{ height: 10 }} />;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  list: { paddingHorizontal: 16 },
  sectionAfter: { marginTop: 12 },
  signInHint: { minHeight: 44, paddingHorizontal: 20, justifyContent: 'center' },
});
