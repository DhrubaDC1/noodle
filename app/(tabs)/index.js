// Capture — Capture.dc.html / CaptureEmpty.dc.html. Phase 1: typed text and
// the list; no tags, pills, reminders or linked thoughts yet.
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, Keyboard, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addThought, listThoughts } from '../../src/db';
import { NoodleMark } from '../../src/icons';
import { CaptureEmpty, ComposeBox, SectionTitle, ThoughtCard, daySections, headerDate, listTime } from '../../src/ui';
import { type, useTheme } from '../../src/theme';
import { GROQ_KEY_NAME } from '../../src/config';
import * as SecureStore from 'expo-secure-store';
import { kickAnalysis } from '../../src/queue';

// Room for the floating tab bar (54px items + 12px padding + 4px borders),
// the 26px space under it from the mock, and the home indicator.
const TAB_BAR_CLEARANCE = 26 + 70;

export default function Capture() {
  const db = useSQLiteContext();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [hasKey, setHasKey] = useState(true);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(() => {
    listThoughts(db).then((rows) => { if (mounted.current) setItems(rows); })
      .catch(() => { if (mounted.current) Alert.alert('Could not load thoughts'); });
  }, [db]);
  useFocusEffect(load);
  useFocusEffect(useCallback(() => { SecureStore.getItemAsync(GROQ_KEY_NAME).then((key) => { if (mounted.current) setHasKey(Boolean(key)); }).catch(() => { if (mounted.current) Alert.alert('Could not read key'); }); }, []));
  useEffect(() => {
    const changed = DeviceEventEmitter.addListener('analysisChanged', load);
    const key = DeviceEventEmitter.addListener('analysisKick', () => SecureStore.getItemAsync(GROQ_KEY_NAME).then((value) => { if (mounted.current) setHasKey(Boolean(value)); }).catch(() => { if (mounted.current) Alert.alert('Could not read key'); }));
    return () => { changed.remove(); key.remove(); };
  }, [load]);

  async function save() {
    const t = text.trim();
    if (!t) return;
    try {
      await addThought(db, randomUUID(), t);
      setText(''); // only clear once it is safely stored
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
      <ComposeBox value={text} onChangeText={setText} onSave={save} />
      {!hasKey && <Text style={[type.meta, styles.keyHint, { color: c.muted }]}>Add your Groq key in Settings</Text>}
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
        renderItem={({ item }) => <ThoughtCard item={item} time={listTime(item.created_at)} />}
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
  keyHint: { paddingHorizontal: 20, paddingTop: 10 },
});
