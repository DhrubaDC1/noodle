// Thought detail — Thought.dc.html.
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Keyboard,
  DeviceEventEmitter,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import { deleteThought, editAnalysis, getLinkedThoughts, getThought, removeLink, setReminderState, updateThought } from '../../src/db';
import { ArchiveIcon, BellIcon, ChevronIcon, DoneIcon, MapIcon, ReopenIcon, TrashIcon } from '../../src/icons';
import { BarButton, Empty, SectionTitle, TypePill, moment, reminderTime, reminderSuggestion, tagsOf, thoughtTypes } from '../../src/ui';
import { font, radius, sticker, type, useTheme } from '../../src/theme';
import { analysisChanged, kickAnalysis } from '../../src/queue';

const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RELATION_LABELS = { 'same-project': 'Same project', 'follow-up': 'Follow-up', 'similar-idea': 'Similar idea', contradicts: 'Contradicts' };

export default function ThoughtScreen() {
  const { id } = useLocalSearchParams();
  const db = useSQLiteContext();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const [thought, setThought] = useState(undefined); // undefined = loading, null = not found
  const [links, setLinks] = useState([]);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [typePicker, setTypePicker] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [suggestReminders, setSuggestReminders] = useState(true);
  const [openedAt] = useState(Date.now);

  useEffect(() => {
    let active = true;
    getThought(db, id).then((t) => {
      if (active) { setThought(t); setText(t?.text ?? ''); }
    }).catch(() => { if (active) Alert.alert('Could not load thought'); });
    getLinkedThoughts(db, id).then((rows) => { if (active) setLinks(rows); }).catch(() => {});
    return () => { active = false; };
  }, [db, id]);
  useEffect(() => {
    let active = true;
    const sub = DeviceEventEmitter.addListener('analysisChanged', () => {
      getThought(db, id).then((value) => { if (active) setThought(value); }).catch(() => { if (active) Alert.alert('Could not load thought'); });
      getLinkedThoughts(db, id).then((rows) => { if (active) setLinks(rows); }).catch(() => {});
    });
    const setting = () => Storage.getItem('suggest_reminders').then((value) => { if (active) setSuggestReminders(value !== 'off'); }).catch(() => {});
    setting();
    const app = DeviceEventEmitter.addListener('analysisKick', setting);
    return () => { active = false; sub.remove(); app.remove(); };
  }, [db, id]);

  if (thought === undefined) return null;
  if (thought === null) {
    return (
      <View style={[styles.screen, { backgroundColor: c.bg }]}>
        <Empty>This thought no longer exists.</Empty>
      </View>
    );
  }

  async function apply(action) {
    try {
      await action();
      router.back();
    } catch (e) {
      Alert.alert('Could not update', String(e?.message ?? e));
    }
  }

  async function toggleEdit() {
    if (!editing) {
      setEditing(true);
      return;
    }
    const updatedText = text.trim();
    if (!updatedText) {
      Alert.alert('Thought cannot be empty');
      return;
    }
    if (updatedText === thought.text) {
      setText(thought.text);
      setEditing(false);
      Keyboard.dismiss();
      return;
    }
    setSaving(true);
    try {
      const result = await updateThought(db, id, { text: updatedText });
      if (result.changes !== 1) throw new Error('Thought no longer exists.');
      setThought((current) => ({ ...current, text: updatedText, updated_at: Date.now() }));
      setText(updatedText);
      setEditing(false);
      Keyboard.dismiss();
      kickAnalysis();
      let cancelled = !thought.notification_id;
      if (thought.notification_id) {
        try {
          await Notifications.cancelScheduledNotificationAsync(thought.notification_id);
          await setReminderState(db, id, 'suggested');
          cancelled = true;
        } catch { Alert.alert('Could not cancel old reminder'); }
      }
      setThought((current) => ({ ...current, pending_job: true, notification_id: cancelled ? null : current.notification_id, reminder_state: cancelled ? 'suggested' : current.reminder_state }));
    } catch (e) {
      Alert.alert('Could not save', String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  async function changeType(kind) {
    setTypePicker(false);
    try { await editAnalysis(db, id, 'type', kind); setThought((current) => ({ ...current, type: kind })); analysisChanged(); }
    catch { Alert.alert('Could not change type'); }
  }

  async function changeTags(tags) {
    try { await editAnalysis(db, id, 'tags', tags); setThought((current) => ({ ...current, tags: JSON.stringify(tags) })); analysisChanged(); }
    catch { Alert.alert('Could not change tags'); }
  }

  async function addTag() {
    const tag = newTag.trim().toLowerCase().replace(/^#/, '');
    if (!TAG_PATTERN.test(tag)) { Alert.alert('Use lowercase words and hyphens for tags'); return; }
    const tags = tagsOf(thought);
    if (!tags.includes(tag)) await changeTags([...tags, tag]);
    setNewTag(''); setAddingTag(false);
    Keyboard.dismiss();
  }

  async function remindMe() {
    if (!thought.reminder_at || Date.parse(thought.reminder_at) <= Date.now()) { Alert.alert('Reminder time has passed'); return; }
    try {
      if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('reminders', { name: 'Reminders', importance: AndroidImportance.DEFAULT });
      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted && await Storage.getItem('notification_permission_asked') !== 'yes') {
        await Storage.setItem('notification_permission_asked', 'yes');
        permission = await Notifications.requestPermissionsAsync();
      }
      if (!permission.granted) { Alert.alert('Notifications are off', 'Enable notifications in device settings to receive reminders.'); return; }
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: { title: 'Noodle reminder', body: thought.title },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(thought.reminder_at), channelId: Platform.OS === 'android' ? 'reminders' : undefined },
      });
      try { await setReminderState(db, id, 'scheduled', notificationId); }
      catch (error) { await Notifications.cancelScheduledNotificationAsync(notificationId); throw error; }
      setThought((current) => ({ ...current, reminder_state: 'scheduled', notification_id: notificationId }));
      analysisChanged();
    } catch { Alert.alert('Could not schedule reminder'); }
  }

  async function dismissReminder() {
    try { await setReminderState(db, id, 'dismissed'); setThought((current) => ({ ...current, reminder_state: 'dismissed' })); }
    catch { Alert.alert('Could not dismiss reminder'); }
  }

  function confirmRemoveLink(link) {
    Alert.alert('Remove link?', 'These thoughts will not be suggested together again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await removeLink(db, link.link_id); setLinks((current) => current.filter((item) => item.link_id !== link.link_id)); analysisChanged(); }
        catch { Alert.alert('Could not remove link'); }
      } },
    ]);
  }

  const confirmDelete = () =>
    Alert.alert('Delete this thought?', 'It will be removed from your list and search.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => apply(async () => {
        await deleteThought(db, id);
        if (thought.notification_id) {
          try { await Notifications.cancelScheduledNotificationAsync(thought.notification_id); }
          catch { Alert.alert('Could not cancel old reminder'); }
        }
      }) },
    ]);

  const screen = (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 6, backgroundColor: thought.type ? c[`${thought.type}Tint`] : c.surface }]}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
          >
            <ChevronIcon color={c.text} />
            <Text style={[styles.headerButton, { color: c.text }]}>Back</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={toggleEdit}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Save changes' : 'Edit thought'}
            style={({ pressed }) => [styles.headerAction, (saving || pressed) && { opacity: 0.6 }]}
          >
            <Text style={[styles.headerButton, { color: c.text }]}>{editing ? 'Save' : 'Edit'}</Text>
          </Pressable>
        </View>
        <View style={styles.metaRow}>
          {thought.type && <Pressable onPress={() => setTypePicker(true)} accessibilityRole="button" accessibilityLabel="Change thought type"><TypePill kind={thought.type} large /></Pressable>}
          <Text style={[type.meta, { color: c.muted }]}>
            {moment(thought.created_at)}
            {thought.updated_at !== thought.created_at ? ' · edited' : ''}
            {thought.status === 'archived' ? ' · archived' : ''}
          </Text>
        </View>
        {thought.title && <Text style={[type.detailTitle, styles.title, { color: c.text }]}>{thought.title}</Text>}
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {editing ? (
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            accessibilityLabel="Thought text"
            style={[type.body, { color: c.text }, styles.bodyInput]}
          />
        ) : (
          <Text selectable style={[type.body, { color: c.text }]}>
            {thought.text}
          </Text>
        )}
        {thought.type && <View style={styles.tags}>
          {tagsOf(thought).map((tag) => <Pressable key={tag} onPress={() => changeTags(tagsOf(thought).filter((value) => value !== tag))} accessibilityRole="button" accessibilityLabel={`Remove tag ${tag}`} style={[styles.tag, { backgroundColor: c[`${thought.type}Tint`] }]}><Text style={[styles.tagText, { color: c[`${thought.type}Text`] }]}>#{tag}</Text></Pressable>)}
          {addingTag ? <TextInput value={newTag} onChangeText={setNewTag} onSubmitEditing={addTag} autoFocus autoCapitalize="none" placeholder="new-tag" placeholderTextColor={c.muted} style={[styles.tagInput, { borderColor: c.line, color: c.text }]} /> : <Pressable onPress={() => setAddingTag(true)} accessibilityRole="button" style={[styles.addTag, { borderColor: c.line }]}><Text style={[styles.tagText, { color: c.muted }]}>+ tag</Text></Pressable>}
          {addingTag && <Pressable onPress={addTag} style={styles.addTag}><Text style={[styles.tagText, { color: c.text }]}>Add</Text></Pressable>}
        </View>}
        {thought.reminder_state === 'scheduled' && thought.reminder_at && <View style={[styles.reminderChip, { backgroundColor: c.ink, flexDirection: 'row', alignItems: 'center', gap: 5 }]}><BellIcon color={c.onInk} /><Text style={[styles.tagText, { color: c.onInk }]}>{reminderTime(thought.reminder_at)}</Text></View>}
        {suggestReminders && thought.reminder_at && Date.parse(thought.reminder_at) > openedAt && thought.reminder_state === 'suggested' && <View style={[styles.reminderCard, sticker(c), { backgroundColor: c.surface }]}>
          <View style={styles.reminderRow}><Svg width={44} height={44} viewBox="0 0 40 40" fill="none" stroke={c.ink} strokeWidth={2.2} strokeLinecap="round"><Path d="M8 12a5 5 0 0 1 7-5M32 12a5 5 0 0 0-7-5M12 34l-2.5 3M28 34l2.5 3" /><Circle cx={20} cy={22} r={12} fill={c.ideaTint} /><Path d="M20 15v7l5 3" strokeWidth={2.4} /></Svg><View style={{ flex: 1 }}><Text style={[styles.reminderTitle, { color: c.text }]}>Remind you {reminderSuggestion(thought.reminder_at)}?</Text><Text style={[type.meta, { color: c.muted }]}>Tap to set a local reminder.</Text></View></View>
          <View style={styles.reminderActions}><Pressable onPress={remindMe} style={[styles.reminderButton, { backgroundColor: c.ink }]}><Text style={[styles.reminderButtonText, { color: c.onInk }]}>Remind me</Text></Pressable><Pressable onPress={dismissReminder} style={[styles.reminderButton, { backgroundColor: c.sunken }]}><Text style={[styles.reminderButtonText, { color: c.text }]}>Not now</Text></Pressable></View>
        </View>}
        <View style={styles.linksSection}>
          <View style={styles.linksHeading}><MapIcon size={20} color={c.text} /><SectionTitle note={links.length}>Linked thoughts</SectionTitle></View>
          {links.length ? links.map((link) => <View key={link.link_id} style={[styles.linkCard, { backgroundColor: link.type ? c[`${link.type}Tint`] : c.surface }]}>
            <Pressable onPress={() => router.push(`/thought/${link.id}`)} accessibilityRole="button" accessibilityLabel={`Open ${link.title || link.text}`} style={styles.linkContent}>
              <Text style={[type.label, { color: link.type ? c[`${link.type}Text`] : c.muted }]}>{RELATION_LABELS[link.relation]}{link.type ? ` · ${thoughtTypes[link.type]?.label}` : ''}</Text>
              <Text style={[styles.linkTitle, { color: c.text }]} numberOfLines={2}>{link.title || link.text}</Text>
              <Text style={[styles.linkReason, { color: c.muted }]}>{link.reason}</Text>
            </Pressable>
            <Pressable onPress={() => confirmRemoveLink(link)} accessibilityRole="button" accessibilityLabel={`Remove link to ${link.title || link.text}`} style={styles.unlink}><TrashIcon size={18} color={c.muted} /></Pressable>
          </View>) : <Text style={[type.meta, { color: c.muted, marginHorizontal: 2 }]}>No linked thoughts yet.</Text>}
        </View>
      </ScrollView>
      <View style={[styles.actionBar, sticker(c), { backgroundColor: c.surface, marginBottom: insets.bottom + 8 }]}>
        <BarButton
          icon={thought.status === 'done' ? <ReopenIcon color={c.text} /> : <DoneIcon color={c.text} />}
          label={thought.status === 'done' ? 'Reopen' : 'Done'}
          color={c.text}
          onPress={() =>
            apply(() => updateThought(db, id, { status: thought.status === 'done' ? 'open' : 'done' }))
          }
        />
        <BarButton
          icon={<ArchiveIcon color={c.text} />}
          label={thought.status === 'archived' ? 'Unarchive' : 'Archive'}
          color={c.text}
          onPress={() =>
            apply(() => updateThought(db, id, { status: thought.status === 'archived' ? 'open' : 'archived' }))
          }
        />
        <BarButton icon={<MapIcon size={22} color={c.text} />} label="On map" color={c.text} onPress={() => router.push({ pathname: "/map", params: { id } })} />
        <BarButton icon={<TrashIcon color={c.text} />} label="Delete" color={c.text} onPress={confirmDelete} />
      </View>
      <Modal visible={typePicker} transparent animationType="fade" onRequestClose={() => setTypePicker(false)}><View style={styles.overlay}><View style={[styles.typeDialog, sticker(c), { backgroundColor: c.surface }]}><Text style={[type.sectionTitle, { color: c.text }]}>Change type</Text>{Object.keys(thoughtTypes).map((kind) => <Pressable key={kind} onPress={() => changeType(kind)} style={styles.typeChoice}><TypePill kind={kind} large /></Pressable>)}<Pressable onPress={() => setTypePicker(false)} style={styles.typeChoice}><Text style={[type.row, { color: c.muted }]}>Cancel</Text></Pressable></View></View></Modal>
    </View>
  );

  return Platform.OS === 'ios' ? (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      {screen}
    </KeyboardAvoidingView>
  ) : (
    screen
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 8, paddingBottom: 22, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8 },
  headerAction: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  headerButton: { fontFamily: font.figtree700, fontSize: 16, lineHeight: 22 },
  metaRow: { paddingHorizontal: 12, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { paddingHorizontal: 12, paddingTop: 10 },
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24, gap: 14 },
  bodyInput: { minHeight: 140, textAlignVertical: 'top' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { minHeight: 30, borderRadius: 10, paddingHorizontal: 12, justifyContent: 'center' },
  tagText: { fontFamily: font.figtree700, fontSize: 13 },
  addTag: { minHeight: 30, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', paddingHorizontal: 12, justifyContent: 'center' },
  tagInput: { minHeight: 36, minWidth: 120, borderWidth: 2, borderRadius: 10, paddingHorizontal: 8 },
  reminderChip: { alignSelf: 'flex-start', minHeight: 30, borderRadius: 10, paddingHorizontal: 12, justifyContent: 'center' },
  reminderCard: { borderRadius: 22, padding: 14, gap: 12 },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reminderTitle: { fontFamily: font.bricolage700, fontSize: 17, lineHeight: 22 },
  reminderActions: { flexDirection: 'row', gap: 8 },
  reminderButton: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  reminderButtonText: { fontFamily: font.figtree700, fontSize: 15 },
  linksSection: { gap: 10, marginTop: 6 }, linksHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkCard: { borderRadius: 18, flexDirection: 'row', alignItems: 'stretch' },
  linkContent: { flex: 1, paddingVertical: 12, paddingLeft: 14, paddingRight: 4, gap: 3, minHeight: 72 },
  linkTitle: { fontFamily: font.figtree700, fontSize: 16, lineHeight: 21 },
  linkReason: { fontFamily: font.figtree400, fontSize: 13, lineHeight: 18 },
  unlink: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, backgroundColor: '#0008', justifyContent: 'center', padding: 24 },
  typeDialog: { padding: 16, borderRadius: 22, gap: 8 },
  typeChoice: { minHeight: 44, justifyContent: 'center' },
  actionBar: {
    marginHorizontal: 16,
    padding: 6,
    gap: 4,
    borderRadius: radius.xl, // 26, the action bar radius
    flexDirection: 'row',
  },
});
