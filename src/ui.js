import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export const colors = {
  bg: '#F7F6F3',
  card: '#FFFFFF',
  text: '#1F1E1C',
  muted: '#77736C',
  border: '#E3E0DA',
  accent: '#3B5BDB',
  danger: '#C92A2A',
};

export const formatDate = (ms) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function ThoughtRow({ item }) {
  return (
    <Link href={`/thought/${item.id}`} asChild>
      <Pressable style={styles.row}>
        <Text style={[styles.text, item.status === 'done' && styles.done]} numberOfLines={3}>
          {item.text}
        </Text>
        <Text style={styles.meta}>
          {formatDate(item.created_at)}
          {item.status !== 'open' ? ` · ${item.status}` : ''}
        </Text>
      </Pressable>
    </Link>
  );
}

export function Button({ title, onPress, disabled, kind = 'primary' }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' ? styles.primary : styles.secondary,
        (disabled || pressed) && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.buttonText, kind !== 'primary' && { color: kind === 'danger' ? colors.danger : colors.text }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export const Empty = ({ children }) => (
  <View style={styles.empty}>
    <Text style={styles.meta}>{children}</Text>
  </View>
);

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  text: { fontSize: 16, lineHeight: 22, color: colors.text },
  done: { textDecorationLine: 'line-through', color: colors.muted },
  meta: { fontSize: 13, color: colors.muted, marginTop: 6 },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 32 },
});
