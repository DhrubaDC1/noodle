import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { searchThoughts } from '../../src/db';
import { colors, Empty, ThoughtRow } from '../../src/ui';

export default function Search() {
  const db = useSQLiteContext();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  // Re-run on every keystroke and when returning from an edited thought.
  const run = useCallback(() => {
    searchThoughts(db, query).then(setResults);
  }, [db, query]);
  useFocusEffect(run);

  return (
    <View style={styles.screen}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search your thoughts"
        placeholderTextColor={colors.muted}
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={styles.input}
        accessibilityLabel="Search"
      />
      <FlatList
        data={results}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <ThoughtRow item={item} />}
        ListEmptyComponent={<Empty>{query.trim() ? 'No matches.' : 'Type a word to find a thought.'}</Empty>}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  },
});
