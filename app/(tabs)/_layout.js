// The floating sticker tab bar is a custom `tabBar` on Expo Router's Tabs
// (docs/DESIGN.md); each tab draws its own in-screen header.
import { Tabs } from 'expo-router';
import { FloatingTabBar } from '../../src/ui';

export default function TabLayout() {
  return (
    <Tabs tabBar={(props) => <FloatingTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Capture' }} />
      <Tabs.Screen name="search" options={{ title: 'Search' }} />
      <Tabs.Screen name="map" options={{ title: 'Map' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
