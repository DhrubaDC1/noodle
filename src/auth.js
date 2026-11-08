// Supabase client, session and sign-in helpers. Signing in is optional: without a session the app
// still captures, searches by keyword and shows everything on the phone; only the AI jobs wait.
import { createClient } from '@supabase/supabase-js';
import * as aesjs from 'aes-js';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

// Supabase's Expo guide ("Using Supabase with Expo", SecureStore tab): a session is bigger than SecureStore
// likes, so an AES-256 key goes in SecureStore and the encrypted session goes in plain storage.
// Differences from the guide: expo-sqlite's kv-store instead of AsyncStorage (already installed, same
// API) and expo-crypto instead of react-native-get-random-values.
class LargeSecureStore {
  async getItem(key) {
    const encrypted = await Storage.getItem(key);
    if (!encrypted) return null;
    const keyHex = await SecureStore.getItemAsync(key);
    if (!keyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(encrypted)));
  }

  async setItem(key, value) {
    const aesKey = getRandomBytes(32); // a fresh key per write, so a counter value is never reused
    const cipher = new aesjs.ModeOfOperation.ctr(aesKey, new aesjs.Counter(1));
    const encrypted = aesjs.utils.hex.fromBytes(cipher.encrypt(aesjs.utils.utf8.toBytes(value)));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(aesKey));
    await Storage.setItem(key, encrypted);
  }

  async removeItem(key) {
    await Storage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

// Null when .env.local is missing, so the app still runs (signed out) in a build without it.
export const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
export const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: new LargeSecureStore(), autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
}) : null;

export async function getAccessToken() {
  if (!supabase) return null;
  try { return (await supabase.auth.getSession()).data.session?.access_token ?? null; } catch { return null; }
}

export const aiClient = { url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY, getToken: getAccessToken };

// Both return an error message to show, or null on success.
export async function sendCode(email) {
  if (!supabase) return 'Sign-in is not set up in this build.';
  const { error } = await supabase.auth.signInWithOtp({ email });
  return error ? friendly(error, 'Could not send the code. Try again.') : null;
}

export async function verifyCode(email, token) {
  if (!supabase) return 'Sign-in is not set up in this build.';
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  return error ? friendly(error, 'That code did not work. Try again.') : null;
}

function friendly(error, fallback) {
  if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') return 'Too many tries. Wait a minute, then try again.';
  if (error.code === 'otp_expired') return 'That code has expired. Ask for a new one.';
  return fallback;
}

// Signing out keeps every local thought; only the session goes.
export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

const SessionContext = createContext({ session: null, ready: false });
export const useSession = () => useContext(SessionContext);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ session: null, ready: !supabase });
  useEffect(() => {
    // The Groq key used to live on the phone (before phase 6); remove any copy left by an older version.
    SecureStore.deleteItemAsync('groq_api_key').catch(() => {});
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, ready: true }), () => setState((s) => ({ ...s, ready: true })));
    // Keep this callback synchronous: calling Supabase from inside it can deadlock.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, ready: true }));
    // React Native has no tab visibility, so refresh the token only while the app is in front.
    const app = AppState.addEventListener('change', (next) => {
      if (next === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh();
    });
    supabase.auth.startAutoRefresh();
    return () => { listener.subscription.unsubscribe(); app.remove(); supabase.auth.stopAutoRefresh(); };
  }, []);
  const value = useMemo(() => state, [state]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
