import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { deleteThought, getThought, updateThought } from '../../src/db';
import { Button, colors, Empty, formatDate } from '../../src/ui';

export default function ThoughtScreen() {
  const { id } = useLocalSearchParams();
  const db = useSQLiteContext();
  const [thought, setThought] = useState(undefined); // undefined = loading, null = not found
  const [text, setText] = useState('');

  useEffect(() => {
    getThought(db, id).then((t) => {
      setThought(t);
      setText(t?.text ?? '');
    });
  }, [db, id]);

  if (thought === undefined) return null;
  if (thought === null) return <Empty>This thought no longer exists.</Empty>;

  const changed = text.trim() && text.trim() !== thought.text;

  async function apply(action) {
    try {
      await action();
      router.back();
    } catch (e) {
      Alert.alert('Could not update', String(e?.message ?? e));
    }
  }

  const confirmDelete = () =>
    Alert.alert('Delete this thought?', 'It will be removed from your list and search.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => apply(() => deleteThought(db, id)) },
    ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
      <Text style={styles.meta}>
        Saved {formatDate(thought.created_at)}
        {thought.updated_at !== thought.created_at ? ` · edited ${formatDate(thought.updated_at)}` : ''}
      </Text>
      <TextInput value={text} onChangeText={setText} multiline style={styles.input} accessibilityLabel="Thought text" />
      {changed ? <Button title="Save changes" onPress={() => apply(() => updateThought(db, id, { text: text.trim() }))} /> : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button
            kind="secondary"
            title={thought.status === 'done' ? 'Reopen' : 'Mark done'}
            onPress={() => apply(() => updateThought(db, id, { status: thought.status === 'done' ? 'open' : 'done' }))}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            kind="secondary"
            title={thought.status === 'archived' ? 'Unarchive' : 'Archive'}
            onPress={() => apply(() => updateThought(db, id, { status: thought.status === 'archived' ? 'open' : 'archived' }))}
          />
        </View>
      </View>
      <Button kind="danger" title="Delete" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  meta: { fontSize: 13, color: colors.muted },
  input: {
    minHeight: 140,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 17,
    lineHeight: 24,
    color: colors.text,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: 10 },
});
