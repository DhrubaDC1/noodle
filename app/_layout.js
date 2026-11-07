import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { migrate } from '../src/db';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="thoughts.db" onInit={migrate}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="thought/[id]" options={{ title: 'Thought' }} />
      </Stack>
    </SQLiteProvider>
  );
}
