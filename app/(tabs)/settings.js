import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { GROQ_KEY_NAME, GROQ_MODEL } from '../../src/config';
import { NoodleMark } from '../../src/icons';
import { kickAnalysis } from '../../src/queue';
import { font, radius, sticker, type, useTheme } from '../../src/theme';

export const REMINDERS_SETTING = 'suggest_reminders';

function TileIcon({ name, color }) {
  return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    {name === 'key' ? <><Circle cx="8" cy="15" r="4" /><Path d="m10.8 12.2 8.7-8.7M16 7l3 3M14 9l2 2" /></> :
      name === 'model' ? <><Rect x="5" y="5" width="14" height="14" rx="3" /><Path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></> :
      <><Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>}
  </Svg>;
}

export default function Settings() {
  const db = useSQLiteContext();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const [key, setKey] = useState(null);
  const [draft, setDraft] = useState('');
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggest, setSuggest] = useState(true);

  useFocusEffect(useCallback(() => {
    SecureStore.getItemAsync(GROQ_KEY_NAME).then(setKey).catch(() => Alert.alert('Could not read key'));
    Storage.getItem(REMINDERS_SETTING).then((value) => setSuggest(value !== 'off')).catch(() => Alert.alert('Could not read setting'));
  }, []));

  async function saveKey() {
    const value = draft.trim();
    if (!value) return;
    setSaving(true);
    try {
      await SecureStore.setItemAsync(GROQ_KEY_NAME, value);
      await db.runAsync('UPDATE jobs SET next_try_at = 0');
      Keyboard.dismiss();
      setKey(value); setDraft(''); setModal(false); kickAnalysis();
    } catch { Alert.alert('Could not save key'); }
    finally { setSaving(false); }
  }

  function removeKey() {
    Alert.alert('Remove Groq key?', 'Thoughts stay on this phone. New analysis waits until you add a key.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await SecureStore.deleteItemAsync(GROQ_KEY_NAME); setKey(null); setDraft(''); setModal(false); kickAnalysis(); }
        catch { Alert.alert('Could not remove key'); }
      } },
    ]);
  }

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
          <Pressable onPress={() => setModal(true)} accessibilityRole="button" accessibilityLabel="Groq API key" style={[styles.row, { borderBottomColor: c.sunken, borderBottomWidth: 2 }]}>
            <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="key" color={c.text} /></View>
            <Text style={[type.row, { color: c.text, flex: 1 }]}>Groq API key</Text>
            <Text style={[styles.value, { color: c.muted }]}>{key ? `•••• ${key.slice(-4)}` : 'Add key'}</Text>
            <Text style={[styles.chevron, { color: c.muted }]}>›</Text>
          </Pressable>
          <View style={styles.row}>
            <View style={[styles.tile, { backgroundColor: c.sunken }]}><TileIcon name="model" color={c.text} /></View>
            <Text style={[type.row, { color: c.text, flex: 1 }]}>Model</Text>
            <Text style={[styles.value, { color: c.muted }]}>{GROQ_MODEL.split('/').at(-1)}</Text>
          </View>
        </View>
        <Text style={[styles.note, { color: c.muted }]}>Your key stays on this phone. Thoughts go to Groq only to be tagged and linked.</Text>
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
      <View style={styles.footer}><NoodleMark size={40} color={c.ink} bg={c.bg} /><Text style={[styles.footerText, { color: c.muted }]}>noodle 1.0 · made for one busy brain</Text></View>
    </ScrollView>
    <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
      <View style={styles.overlay}><View style={[styles.dialog, sticker(c), { backgroundColor: c.surface }]}>
        <Text style={[type.sectionTitle, { color: c.text }]}>Groq API key</Text>
        <Text style={[styles.note, { color: c.muted }]}>Paste a key to {key ? 'change' : 'enable'} analysis.</Text>
        <TextInput value={draft} onChangeText={setDraft} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" placeholder="Paste API key" placeholderTextColor={c.muted} accessibilityLabel="Paste Groq API key" style={[styles.input, { color: c.text, borderColor: c.line }]} />
        <View style={styles.actions}>
          <Pressable onPress={() => { Keyboard.dismiss(); setDraft(''); setModal(false); }} style={[styles.action, { backgroundColor: c.sunken }]}><Text style={[styles.actionText, { color: c.text }]}>Cancel</Text></Pressable>
          <Pressable onPress={saveKey} disabled={!draft.trim() || saving} style={[styles.action, { backgroundColor: c.ink, opacity: !draft.trim() || saving ? 0.5 : 1 }]}><Text style={[styles.actionText, { color: c.onInk }]}>Save</Text></Pressable>
        </View>
        {key && <Pressable onPress={removeKey} style={styles.remove}><Text style={[styles.actionText, { color: c.todoText }]}>Remove key</Text></Pressable>}
      </View></View>
    </Modal>
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
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 }, dialog: { borderRadius: radius.lg, padding: 18, gap: 12 },
  input: { borderWidth: 2, borderRadius: radius.md, minHeight: 48, paddingHorizontal: 12, fontFamily: font.figtree600, fontSize: 16 },
  actions: { flexDirection: 'row', gap: 8 }, action: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontFamily: font.figtree700, fontSize: 15 }, remove: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
