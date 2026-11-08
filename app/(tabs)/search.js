// Search — Search.dc.html.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { embeddingRows, searchThoughts } from '../../src/db';
import { getEmbedder } from '../../src/embeddingModel';
import { ClearIcon, FieldSearchIcon, MapIcon } from '../../src/icons';
import { Empty, SectionTitle, ThoughtCard, dayTime, queryTokens, thoughtTypes } from '../../src/ui';
import { meaningWithoutWords, topSimilar } from '../../src/similarity';
import { font, sticker, type, useTheme } from '../../src/theme';

const TAB_BAR_CLEARANCE = 26 + 70;

export default function Search() {
  const db = useSQLiteContext();
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [meaning, setMeaning] = useState([]);
  const [searchingMeaning, setSearchingMeaning] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const mounted = useRef(true);
  const request = useRef(0);
  const timer = useRef();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { tag } = useLocalSearchParams();
  const selectedTag = typeof tag === 'string' ? tag : null;
  const tokens = queryTokens(query);

  // Re-run on every keystroke and when returning from an edited thought.
  const run = useCallback(() => {
    const serial = ++request.current;
    clearTimeout(timer.current);
    setMeaning([]);
    setSearchingMeaning(Boolean(query.trim()));
    searchThoughts(db, query, selectedType, selectedTag)
      .then((words) => {
        if (!mounted.current || serial !== request.current) return;
        setResults(words);
        if (!query.trim()) { setSearchingMeaning(false); return; }
        timer.current = setTimeout(async () => {
          try {
            const rows = await embeddingRows(db, selectedType, selectedTag);
            if (!rows.length || serial !== request.current) { if (serial === request.current) setSearchingMeaning(false); return; }
            const vector = await (await getEmbedder()).embed(query.trim());
            const matches = topSimilar(vector, rows, 10 + words.length);
            if (mounted.current && serial === request.current) setMeaning(meaningWithoutWords(words, matches));
          } catch { /* keyword results remain available */ }
          finally { if (mounted.current && serial === request.current) setSearchingMeaning(false); }
        }, 250);
      })
      .catch(() => { if (mounted.current && serial === request.current) { setSearchingMeaning(false); Alert.alert('Could not search thoughts'); } });
  }, [db, query, selectedType, selectedTag]);
  useFocusEffect(useCallback(() => { run(); return () => { request.current++; clearTimeout(timer.current); }; }, [run]));
  useEffect(() => {
    const analysis = DeviceEventEmitter.addListener('analysisChanged', run);
    const embedding = DeviceEventEmitter.addListener('embeddingChanged', run);
    return () => { analysis.remove(); embedding.remove(); };
  }, [run]);

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={[type.screenTitle, { color: c.text }]}>Search</Text>
      </View>
      <View style={styles.searchWrap}>
        <View style={[styles.field, sticker(c, true), { backgroundColor: c.surface }]}>
          <FieldSearchIcon color={c.text} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your thoughts"
            placeholderTextColor={c.muted}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={Keyboard.dismiss}
            accessibilityLabel="Search your thoughts"
            style={[styles.fieldText, { color: c.text, fontFamily: font.figtree600 }]}
          />
          {query.trim() ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              style={({ pressed }) => [styles.clear, pressed && { opacity: 0.6 }]}
            >
              <ClearIcon color={c.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        <Pressable onPress={() => setSelectedType(null)} accessibilityRole="button" accessibilityState={{ selected: !selectedType }} style={[styles.filter, { backgroundColor: !selectedType ? c.ink : c.surface, borderColor: !selectedType ? c.ink : c.line }]}>
          <Text style={[styles.filterText, { color: !selectedType ? c.onInk : c.text }]}>All</Text>
        </Pressable>
        {Object.entries(thoughtTypes).map(([kind, meta]) => <Pressable key={kind} onPress={() => setSelectedType(kind)} accessibilityRole="button" accessibilityState={{ selected: selectedType === kind }} style={[styles.filter, { backgroundColor: c[`${kind}Tint`], borderColor: selectedType === kind ? c.ink : 'transparent' }]}>
          <View style={[styles.filterDot, { backgroundColor: c[kind] }]} /><Text style={[styles.filterText, { color: c[`${kind}Text`] }]}>{meta.plural}</Text>
        </Pressable>)}
      </ScrollView>
      {selectedTag && <Pressable onPress={() => router.setParams({ tag: '' })} style={[styles.activeTag, { backgroundColor: c.sunken }]} accessibilityRole="button" accessibilityLabel={`Clear tag ${selectedTag}`}><Text style={[type.meta, { color: c.text }]}>#{selectedTag} ×</Text></Pressable>}
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.list, { paddingTop: 22, paddingBottom: TAB_BAR_CLEARANCE + insets.bottom }]}
        ListHeaderComponent={
          (query.trim() || selectedType || selectedTag) ? (
            <SectionTitle note={results.length}>Matching words</SectionTitle>
          ) : null
        }
        ListEmptyComponent={meaning.length ? null : <Empty>{searchingMeaning ? 'Looking for similar thoughts…' : query.trim() || selectedType || selectedTag ? 'No matches.' : 'Type a word to find a thought.'}</Empty>}
        ListFooterComponent={meaning.length ? <View style={styles.meaningSection}>
          <View style={styles.meaningTitle}><MapIcon size={20} color={c.text} /><SectionTitle note={meaning.length}>Similar in meaning</SectionTitle></View>
          <Text style={[styles.meaningHint, { color: c.muted }]}>No matching words, but about the same thing</Text>
          {meaning.map((item) => <View key={item.id} style={styles.meaningCard}><ThoughtCard item={item} time={dayTime(item.created_at)} /></View>)}
        </View> : null}
        renderItem={({ item }) => <ThoughtCard item={item} time={dayTime(item.created_at)} tokens={tokens} />}
        ItemSeparatorComponent={CardGap}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}

const CardGap = () => <View style={{ height: 10 }} />;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  searchWrap: { paddingHorizontal: 16 },
  field: {
    height: 54,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
  },
  fieldText: {
    fontSize: 18,
    flex: 1,
    height: 54,
    paddingLeft: 10,
    paddingRight: 10,
  },
  clear: {
    width: 44,
    height: 44,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  list: { paddingHorizontal: 16 },
  filters: { paddingHorizontal: 16, paddingTop: 14, gap: 8 },
  filter: { height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 2, flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterText: { fontFamily: font.figtree700, fontSize: 14 },
  filterDot: { width: 10, height: 10, borderRadius: 5 },
  activeTag: { minHeight: 32, marginHorizontal: 16, marginTop: 10, borderRadius: 10, alignSelf: 'flex-start', paddingHorizontal: 10, justifyContent: 'center' },
  meaningSection: { paddingTop: 12 }, meaningTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meaningHint: { marginHorizontal: 4, marginBottom: 10, fontFamily: font.figtree400, fontSize: 13 },
  meaningCard: { marginBottom: 10 },
});
