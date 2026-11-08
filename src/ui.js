// Shared Noodle components. Colours, type and stickers come from src/theme.js
// (the token module); icons come from src/icons.js. Every screen must match
// docs/DESIGN.md — build screens with these parts so they can't drift.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Bowl,
  CaptureIcon,
  SearchIcon,
  MapIcon,
  SettingsIcon,
  MicIcon,
  ArrowRightIcon,
  IdeaIcon, ProjectIcon, TodoIcon, MemoryIcon, QuestionIcon,
  BellIcon,
} from './icons';
import { font, radius, space, sticker, type, useTheme } from './theme';

// ---------------------------------------------------------------- dates
// Human times, per the brand voice: "Today, 11:40 am", "Mon 9 Nov, 10 am".

const timeOptions = { hour: 'numeric', minute: '2-digit' };

const weekday = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });
const shortDate = (d) => `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`;
const timeText = (d) => d.toLocaleTimeString(undefined, timeOptions).toLowerCase();
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const sameYear = (a, b) => a.getFullYear() === b.getFullYear();

// Capture list rows: "11:40 am" today, "9 Nov" earlier.
export function listTime(ms) {
  const d = new Date(ms);
  return sameDay(d, new Date()) ? timeText(d) : shortDate(d) + (sameYear(d, new Date()) ? '' : ` ${d.getFullYear()}`);
}

// Search results: "Today", "2 Nov".
export function dayTime(ms) {
  const d = new Date(ms);
  return sameDay(d, new Date()) ? 'Today' : shortDate(d) + (sameYear(d, new Date()) ? '' : ` ${d.getFullYear()}`);
}

// Thought detail meta: "Today, 11:40 am", "Mon 9 Nov, 10 am".
export function moment(ms) {
  const d = new Date(ms);
  const now = new Date();
  const time = timeText(d);
  if (sameDay(d, now)) return `Today, ${time}`;
  if (sameYear(d, now)) return `${weekday(d)} ${shortDate(d)}, ${time}`;
  return `${weekday(d)} ${shortDate(d)} ${d.getFullYear()}, ${time}`;
}

// Capture header: "Sat, 7 Nov".
export function headerDate() {
  const d = new Date();
  return `${weekday(d)}, ${shortDate(d)}`;
}

// Group the list into day sections: Today, Yesterday, Mon 9 Nov…
export function daySections(items) {
  const sections = [];
  let current;
  for (const item of items) {
    const title = dayHeading(item.created_at);
    if (!current || current.title !== title) {
      current = { title, data: [], notFirst: sections.length > 0 };
      sections.push(current);
    }
    current.data.push(item);
  }
  return sections;
}

function dayHeading(ms) {
  const d = new Date(ms);
  const today0 = new Date();
  today0.setHours(0, 0, 0, 0);
  const day0 = new Date(d);
  day0.setHours(0, 0, 0, 0);
  const days = Math.round((today0 - day0) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const year = sameYear(d, new Date()) ? '' : ` ${d.getFullYear()}`;
  return `${weekday(d)} ${shortDate(d)}${year}`;
}

// ---------------------------------------------------------------- search highlight
// FTS5 matches word prefixes ("budget" finds "budgeting"), so the highlight
// looks for whole words that start with a query token and paints them with
// the marker idea colour: a yellow rounded Text background, per DESIGN.md.

export function queryTokens(query) {
  const words = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map((w) => w.toLowerCase());
}

function highlightParts(text, tokens) {
  const re = /[\p{L}\p{N}]+/gu;
  const ranges = [];
  for (let m; (m = re.exec(text)); ) {
    const word = m[0].toLowerCase();
    if (tokens.some((t) => word.startsWith(t))) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  if (!ranges.length) return null;
  const parts = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push({ hit: false, text: text.slice(at, start) });
    parts.push({ hit: true, text: text.slice(start, end) });
    at = end;
  }
  if (at < text.length) parts.push({ hit: false, text: text.slice(at) });
  return parts;
}

export function Highlight({ text, tokens, style, numberOfLines }) {
  const { colors: c } = useTheme();
  const parts = tokens?.length ? highlightParts(text, tokens) : null;
  if (!parts) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        part.hit ? (
          <Text
            key={i}
            style={{
              backgroundColor: c.idea,
              color: c.labelInk,
              borderRadius: 4,
              paddingHorizontal: 2,
              overflow: 'hidden',
            }}
          >
            {part.text}
          </Text>
        ) : (
          part.text
        )
      )}
    </Text>
  );
}

// ---------------------------------------------------------------- parts

// "Save [→]" — the compose box's primary button (ink, filled, verb first).
// `kind="secondary"` gives the quiet sunken button. Sentence case everywhere.
export function Button({ title, onPress, disabled, kind = 'primary' }) {
  const { colors: c } = useTheme();
  const primary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: primary ? c.ink : c.sunken },
        (disabled || pressed) && { opacity: 0.5 },
      ]}
    >
      <Text
        style={[
          styles.buttonLabel,
          { color: primary ? c.onInk : c.text, fontFamily: primary ? font.figtree700 : font.figtree600 },
        ]}
      >
        {title}
      </Text>
      {primary ? <ArrowRightIcon size={16} color={c.onInk} /> : null}
    </Pressable>
  );
}

// Section heading: Bricolage title with a muted Figtree note ("3 thoughts").
export function SectionTitle({ children, note, style }) {
  const { colors: c } = useTheme();
  return (
    <Text style={[type.sectionTitle, { color: c.text }, styles.sectionTitle, style]}>
      {children}
      {note != null && <Text style={[styles.sectionNote, { color: c.muted }]}> {note}</Text>}
    </Text>
  );
}

// A thought card in a list. Phase 1 has no type yet, so there is no tint,
// no pill and no tags — the card stays a flat surface with its time, exactly
// like the design's not-yet-analysed thought, minus the dashed analysis border.
export const thoughtTypes = {
  idea: { label: 'Idea', plural: 'Ideas', Icon: IdeaIcon },
  project: { label: 'Project', plural: 'Projects', Icon: ProjectIcon },
  todo: { label: 'To-do', plural: 'To-dos', Icon: TodoIcon },
  memory: { label: 'Memory', plural: 'Memories', Icon: MemoryIcon },
  question: { label: 'Question', plural: 'Questions', Icon: QuestionIcon },
};

export function tagsOf(item) {
  try { return JSON.parse(item.tags ?? '[]'); } catch { return []; }
}

export function reminderTime(value) {
  const date = new Date(value);
  const day = date.toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  const time = date.toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(':00 ', ' ');
  return `${day}, ${time}`;
}

export function reminderSuggestion(value) {
  const date = new Date(value);
  const day = date.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', weekday: 'long' });
  const time = date.toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }).toLowerCase().replace(':00 ', ' ');
  return `${day}, ${time}`;
}

export function TypePill({ kind, large = false }) {
  const { colors: c } = useTheme();
  const meta = thoughtTypes[kind];
  if (!meta) return null;
  const Icon = meta.Icon;
  return <View style={[styles.typePill, { backgroundColor: c[kind], height: large ? 26 : 24 }]}>
    <Icon color={c.labelInk} size={large ? 14 : 13} />
    <Text style={[type.label, { color: c.labelInk, fontSize: large ? 13 : 12 }]}>{meta.label}</Text>
  </View>;
}

export function ThoughtCard({ item, time, tokens }) {
  const { colors: c } = useTheme();
  const done = item.status === 'done';
  const pending = Boolean(item.pending_job) || !item.title;
  const tags = tagsOf(item);
  return (
      <Pressable onPress={() => { Keyboard.dismiss(); router.push(`/thought/${item.id}`); }}
        accessibilityRole="button" accessibilityLabel={pending ? item.text : item.title}
        style={({ pressed }) => [styles.card, { backgroundColor: pending ? c.surface : c[`${item.type}Tint`] }, pending && { borderWidth: 2, borderStyle: 'dashed', borderColor: c.line }, pressed && { opacity: 0.5 }]}>
        <View style={styles.cardTop}>
          {pending ? <View style={styles.pendingRow}>
            {['idea', 'project', 'todo', 'memory', 'question'].map((kind) => <View key={kind} style={[styles.pendingDot, { backgroundColor: c[kind] }]} />)}
            <Text style={[type.label, { color: c.muted }]}numberOfLines={1}>{item.last_error ? `Retrying: ${item.last_error}` : 'Noodling on it…'}</Text>
          </View> : <TypePill kind={item.type} />}
          <View style={{ flex: 1 }} />
          <Text style={[type.label, { color: c.muted, fontFamily: font.figtree600 }]}>{time}</Text>
        </View>
        {pending ? <Highlight text={item.text} tokens={tokens} style={[styles.cardText, { color: c.text }]} numberOfLines={4} /> : <>
          <Highlight text={item.title} tokens={tokens} style={[type.cardTitle, { color: done ? c.muted : c.text }, done && styles.cardDone]} numberOfLines={2} />
          <Highlight text={item.text} tokens={tokens} style={[type.snippet, { color: c.muted }]} numberOfLines={2} />
          <View style={styles.tagsRow}>
            {tags.map((tag) => <Pressable key={tag} onPress={(event) => { event.stopPropagation(); router.push({ pathname: '/search', params: { tag } }); }} hitSlop={10}
              accessibilityRole="button" accessibilityLabel={`Filter by ${tag}`} style={[styles.cardTag, { backgroundColor: c.surface }]}>
              <Text style={[styles.cardTagText, { color: c[`${item.type}Text`] }]}>#{tag}</Text>
            </Pressable>)}
            {item.reminder_state === 'scheduled' && item.reminder_at && <View style={[styles.cardTag, { backgroundColor: c.ink, flexDirection: 'row', gap: 5 }]}><BellIcon color={c.onInk} /><Text style={[styles.cardTagText, { color: c.onInk }]}>{reminderTime(item.reminder_at)}</Text></View>}
          </View>
        </>}
      </Pressable>
  );
}

// Quiet empty-state line for lists (the Capture one is CaptureEmpty below).
export function Empty({ children }) {
  const { colors: c } = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyText, { color: c.muted }]}>{children}</Text>
    </View>
  );
}

// One tab-bar / action-bar button: icon over its 11px label, at least 54px
// tall. Tabs: the active tab is filled ink; action-bar buttons pass `color`
// for plain text-coloured buttons (700 weight, as in the Thought mockup).
export function BarButton({ icon, label, active = false, color, onPress, accessibilityLabel, disabled = false }) {
  const { colors: c } = useTheme();
  const tint = active ? c.onInk : color ?? c.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.barButton,
        active && { backgroundColor: c.ink },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.6 },
      ]}
    >
      {icon}
      <Text style={[type.tab, { color: tint, fontFamily: active || color ? font.figtree700 : font.figtree600 }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// The floating sticker tab bar (custom `tabBar` on Expo Router's Tabs):
// surface pill, 2px ink border, hard shadow, ink-filled active tab.
const TAB_ICONS = { index: CaptureIcon, search: SearchIcon, map: MapIcon, settings: SettingsIcon };

export function FloatingTabBar({ state, descriptors, navigateToTab, insets }) {
  const { colors: c } = useTheme();
  return (
    <View
      style={[
        styles.tabBar,
        sticker(c),
        { bottom: insets.bottom, backgroundColor: c.surface },
      ]}
    >
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const active = index === state.index;
        const Icon = TAB_ICONS[route.name];
        return (
          <BarButton
            key={route.key}
            icon={<Icon color={active ? c.onInk : c.muted} />}
            label={descriptor.options.title ?? route.name}
            active={active}
            accessibilityLabel={`${descriptor.options.title ?? route.name} tab`}
            onPress={() => { Keyboard.dismiss(); navigateToTab(route.key); }}
          />
        );
      })}
    </View>
  );
}

// "What's on your noodle?" — the sticker compose box from Capture.dc.html.
// Phase 1 has no voice capture yet; the mic only reports it is coming.
export function ComposeBox({ value, onChangeText, onSave }) {
  const { colors: c } = useTheme();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  const micComingSoon = () =>
    Alert.alert('Coming soon', 'Voice notes arrive in a later phase.');
  return (
    <View style={[styles.compose, sticker(c), { backgroundColor: c.surface }]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="What's on your noodle?"
        placeholderTextColor={c.muted}
        multiline
        accessibilityLabel="New thought"
        style={[type.compose, { color: c.text }, styles.composeInput]}
      />
      <View style={styles.composeRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Record a voice note"
          onPress={micComingSoon}
          style={({ pressed }) => [styles.micButton, { backgroundColor: c.sunken }, pressed && { opacity: 0.6 }]}
        >
          <MicIcon size={20} color={c.text} />
        </Pressable>
        {keyboardOpen && <Pressable onPress={Keyboard.dismiss} accessibilityRole="button" accessibilityLabel="Close keyboard" style={styles.keyboardDone}><Text style={[type.meta, { color: c.text }]}>Done</Text></Pressable>}
        <View style={{ flex: 1 }} />
        <Button title="Save" onPress={onSave} disabled={!value.trim()} />
      </View>
    </View>
  );
}

// First launch (CaptureEmpty.dc.html), limited to phase 1.
export function CaptureEmpty() {
  const { colors: c } = useTheme();
  return (
    <View style={styles.captureEmpty}>
      <Bowl color={c.ink} surface={c.surface} />
      <Text style={[type.emptyTitle, { color: c.text }, styles.captureEmptyTitle]}>Your bowl is empty</Text>
      <Text style={[styles.bowlBody, { color: c.muted }]}>
        Jot down anything on your mind. Find it again whenever you need it.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- styles

const styles = StyleSheet.create({
  button: {
    height: 44,
    borderRadius: radius.md, // 16
    paddingLeft: 20,
    paddingRight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonLabel: { fontSize: 15, lineHeight: 20 },
  sectionTitle: { marginHorizontal: 4, marginBottom: space.s2 },
  sectionNote: { fontFamily: font.figtree600, fontSize: 13, lineHeight: 18 },
  card: {
    borderRadius: radius.lg, // 22
    paddingTop: 14,
    paddingHorizontal: space.s4,
    paddingBottom: space.s4,
    gap: space.s2,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.s2 },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 13, paddingHorizontal: 8 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  pendingDot: { width: 6, height: 6, borderRadius: 3 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cardTag: { minHeight: 24, borderRadius: 9, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  cardTagText: { fontFamily: font.figtree600, fontSize: 12 },
  cardText: { fontFamily: font.figtree500, fontSize: 16, lineHeight: 22 },
  cardDone: { textDecorationLine: 'line-through' },
  empty: { alignItems: 'center', paddingTop: 48, paddingHorizontal: space.s4 },
  emptyText: { fontFamily: font.figtree600, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  captureEmpty: {
    alignItems: 'center',
    // The screen's content container already pads 16px; the mock centers the
    // bowl at 28px from the screen edge (22px top, like CaptureEmpty.dc.html).
    paddingHorizontal: 12,
    paddingTop: 22,
    gap: 10,
  },
  captureEmptyTitle: { marginTop: space.s1 },
  bowlBody: { fontFamily: font.figtree400, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  barButton: {
    flex: 1,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 20,
  },
  tabBar: {
    position: 'absolute',
    left: space.s4,
    right: space.s4,
    flexDirection: 'row',
    gap: space.s1,
    padding: 6,
    borderRadius: radius.xl, // 26
  },
  compose: {
    marginHorizontal: space.s4,
    padding: 14,
    paddingBottom: space.s3,
    borderRadius: 24,
    gap: 10,
  },
  composeInput: { minHeight: 72, textAlignVertical: 'top' },
  composeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  micButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  keyboardDone: { minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
});
