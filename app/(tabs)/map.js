// Map placeholder — the sticker mind map lands in phase 4 (MapTopics.dc.html).
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type, useTheme } from '../../src/theme';

export default function Map() {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={[type.screenTitle, { color: c.text }]}>Map</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.note, { color: c.muted }]}>The mind map arrives in a later phase.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  body: { flex: 1, alignItems: 'center', paddingTop: 48, paddingHorizontal: 16 },
  note: { fontFamily: type.meta.fontFamily, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
