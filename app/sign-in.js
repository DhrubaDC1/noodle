// Sign in with an emailed 6-digit code (docs/DESIGN.md, "Sign in"). Optional: closing this screen
// leaves the app fully usable, only the AI waits.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { configured, sendCode, useSession, verifyCode } from '../src/auth';
import { ClearIcon, NoodleMark } from '../src/icons';
import { font, radius, sticker, type, useTheme } from '../src/theme';
import { Button } from '../src/ui';

const RESEND_SECONDS = 60; // Supabase allows one email a minute
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignIn() {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('email'); // 'email' | 'code'
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [wait, setWait] = useState(0);
  const verifying = useRef(false);

  useEffect(() => { if (session) router.back(); }, [session]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const address = email.trim().toLowerCase();

  async function send() {
    if (busy || !EMAIL.test(address)) return;
    setBusy(true); setMessage(null);
    const error = await sendCode(address);
    setBusy(false);
    if (error) { setMessage(error); return; }
    setCode(''); setStep('code'); setWait(RESEND_SECONDS);
  }

  async function verify(value) {
    if (verifying.current || value.length !== 6) return;
    verifying.current = true; setBusy(true); setMessage(null);
    const error = await verifyCode(address, value);
    verifying.current = false; setBusy(false);
    if (error) { setMessage(error); setCode(''); }
    // On success the session arrives and the effect above closes this screen.
  }

  function change(text) {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) verify(digits);
  }

  const onCode = step === 'code';
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, { backgroundColor: c.bg, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
    <View style={styles.top}>
      <NoodleMark size={36} color={c.ink} bg={c.bg} />
      <View style={{ flex: 1 }} />
      <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => [styles.close, { backgroundColor: c.sunken }, pressed && { opacity: 0.6 }]}>
        <ClearIcon size={20} color={c.text} />
      </Pressable>
    </View>
    <View style={styles.body}>
      <Text style={[type.screenTitle, { color: c.text }]}>{onCode ? 'Check your email' : 'Switch on the AI'}</Text>
      <Text style={[type.body, { color: c.muted }]}>
        {onCode ? `We sent a 6-digit code to ${address}.` : 'Sign in and Noodle can tag your thoughts and link them up. Your notes stay on this phone either way.'}
      </Text>
      {!configured && <Text style={[type.meta, { color: c.text }]}>Sign-in is not set up in this build yet.</Text>}
      <View style={[styles.field, sticker(c, true), { backgroundColor: c.surface }]}>
        {onCode ? (
          <TextInput key="code" value={code} onChangeText={change} editable={!busy} autoFocus keyboardType="number-pad" maxLength={6}
            textContentType="oneTimeCode" autoComplete="one-time-code" placeholder="000000" placeholderTextColor={c.line}
            accessibilityLabel="6-digit code" style={[styles.input, styles.codeInput, { color: c.text }]} />
        ) : (
          <TextInput key="email" value={email} onChangeText={setEmail} editable={!busy} autoFocus autoCapitalize="none" autoCorrect={false}
            keyboardType="email-address" textContentType="emailAddress" autoComplete="email" returnKeyType="send" onSubmitEditing={send}
            placeholder="you@example.com" placeholderTextColor={c.muted} accessibilityLabel="Email" style={[styles.input, { color: c.text }]} />
        )}
      </View>
      {message && <Text accessibilityLiveRegion="polite" style={[type.meta, { color: c.text }]}>{message}</Text>}
      <View style={styles.actions}>
        {onCode ? <>
          <Button title={busy ? 'Checking…' : 'Sign in'} onPress={() => verify(code)} disabled={busy || code.length !== 6} />
          <Button kind="secondary" title={wait > 0 ? `Send again in ${wait}s` : 'Send a new code'} onPress={send} disabled={busy || wait > 0} />
          <Pressable onPress={() => { setStep('email'); setMessage(null); setCode(''); }} accessibilityRole="button" style={styles.link}>
            <Text style={[type.meta, { color: c.muted }]}>Use a different email</Text>
          </Pressable>
        </> : <Button title={busy ? 'Sending…' : 'Send code'} onPress={send} disabled={busy || !configured || !EMAIL.test(address)} />}
      </View>
    </View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center' },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, paddingTop: 28, gap: 14 },
  field: { borderRadius: radius.md, marginTop: 6 },
  input: { minHeight: 56, paddingHorizontal: 16, fontFamily: font.figtree600, fontSize: 18 },
  codeInput: { fontFamily: font.bricolage800, fontSize: 30, letterSpacing: 10, textAlign: 'center' },
  actions: { gap: 10, alignItems: 'flex-start' },
  link: { minHeight: 44, justifyContent: 'center' },
});
