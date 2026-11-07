import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { addThought, listThoughts } from '../../src/db';
import { Button, colors, Empty, ThoughtRow } from '../../src/ui';

export default function Capture() {
  const db = useSQLiteContext();
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);

  const load = useCallback(() => {
    listThoughts(db).then(setItems);
  }, [db]);
  useFocusEffect(load);

  async function save() {
    const t = text.trim();
    if (!t) return;
    try {
      await addThought(db, randomUUID(), t);
      setText(''); // only clear once it is safely stored
      load();
    } catch (e) {
      Alert.alert('Could not save', String(e?.message ?? e));
    }
  }

  return (
    <View style={styles.screen}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="What's on your mind?"
        placeholderTextColor={colors.muted}
        multiline
        autoFocus
        style={styles.input}
        accessibilityLabel="New thought"
      />
      <Button title="Save" onPress={save} disabled={!text.trim()} />
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <ThoughtRow item={item} />}
        ListEmptyComponent={<Empty>Your saved thoughts will show up here.</Empty>}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  input: {
    minHeight: 96,
    maxHeight: 200,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 17,
    color: colors.text,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
});
