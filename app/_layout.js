// Holds the splash screen until Bricolage Grotesque and Figtree are loaded,
// per docs/DESIGN.md. Type colours etc. come from src/theme.js.
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SQLiteProvider } from 'expo-sqlite';
import { ShareIntentProvider } from 'expo-share-intent';
import { Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../src/auth';
import { migrate } from '../src/db';
import { fontAssets } from '../src/theme';
import AnalysisRunner from '../src/queue';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontsError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontsLoaded || fontsError) {
      if (fontsError) console.warn('Font loading failed:', fontsError);
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontsError]);

  if (!fontsLoaded && !fontsError) return null;

  return (
    <ShareIntentProvider options={{ disabled: Platform.OS !== 'android' }}>
      <AuthProvider>
        <SQLiteProvider databaseName="thoughts.db" onInit={migrate}>
          <AnalysisRunner />
          <StatusBar style="auto" />
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="thought/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="sign-in" options={{ headerShown: false, presentation: 'modal' }} />
          </Stack>
        </SQLiteProvider>
      </AuthProvider>
    </ShareIntentProvider>
  );
}
