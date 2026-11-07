import { Tabs } from 'expo-router';
import { colors } from '../../src/ui';

// shortcut: text-only tabs; add icons when a Map and Settings tab arrive
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 15, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Capture' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
    </Tabs>
  );
}
