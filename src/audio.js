// Voice recording (expo-audio) and the recordings kept in the document directory.
import { randomUUID } from 'expo-crypto';
import { AudioQuality, IOSOutputFormat, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { MAX_RECORD_MS } from './config';
import { addVoiceThought } from './db';

// Speech needs little: 16 kHz mono AAC at 32 kbps (Groq downsamples to 16 kHz mono anyway).
// 2 minutes is about 0.5 MB, far under Groq's 25 MB limit.
const SPEECH = {
  extension: '.m4a', sampleRate: 16000, numberOfChannels: 1, bitRate: 32000, directory: 'document',
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

// The database stores paths relative to the document directory: iOS changes its absolute path between installs.
export const audioFile = (path) => (path.startsWith('file:') ? new File(path) : new File(Paths.document, path));
export function removeAudio(path) {
  const file = audioFile(path);
  if (file.exists) file.delete();
}
function relativePath(uri) {
  const base = Paths.document.uri.endsWith('/') ? Paths.document.uri : `${Paths.document.uri}/`;
  return uri.startsWith(base) ? uri.slice(base.length) : uri;
}

export const MIC_OFF = "Microphone is off. Allow it for Noodle in your phone's settings to record.";

export function useVoiceRecorder(db, onSaved) {
  const recorder = useAudioRecorder(SPEECH);
  const state = useAudioRecorderState(recorder, 200);
  const [active, setActive] = useState(false);
  const [notice, setNotice] = useState(null);
  const activeRef = useRef(false); // the timer and AppState callbacks outlive renders
  const busy = useRef(false);
  const timer = useRef(null);
  const latest = useRef(null);

  async function start() {
    if (busy.current || activeRef.current) return;
    busy.current = true;
    setNotice(null);
    try {
      let permission = await getRecordingPermissionsAsync();
      if (permission.status === 'undetermined') permission = await requestRecordingPermissionsAsync(); // first tap only
      if (!permission.granted) { setNotice(MIC_OFF); return; }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync({ ...SPEECH, fileName: `voice-${randomUUID()}` });
      recorder.record();
      activeRef.current = true;
      setActive(true);
      timer.current = setTimeout(() => latest.current.finish(true), MAX_RECORD_MS);
    } catch { setNotice('Could not start recording.'); }
    finally { busy.current = false; }
  }

  async function finish(save) {
    if (busy.current || !activeRef.current) return;
    busy.current = true;
    clearTimeout(timer.current);
    try {
      const ms = Math.min(recorder.getStatus().durationMillis, MAX_RECORD_MS);
      await recorder.stop();
      activeRef.current = false;
      setActive(false);
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording');
      const path = relativePath(uri);
      if (!save) { try { removeAudio(path); } catch { /* temp file, harmless */ } return; }
      // If this throws the audio file stays on disk, so the recording is not lost.
      await addVoiceThought(db, randomUUID(), path, ms);
      onSaved();
    } catch (error) {
      activeRef.current = false;
      setActive(false);
      Alert.alert('Could not save recording', String(error?.message ?? error));
    } finally { busy.current = false; }
  }

  useEffect(() => { latest.current = { finish }; });
  useEffect(() => {
    // Don't lose a recording the OS is about to suspend.
    const sub = AppState.addEventListener('change', (next) => { if (next === 'background') latest.current.finish(true); });
    return () => { sub.remove(); clearTimeout(timer.current); };
  }, []);

  return { active, ms: Math.min(state.durationMillis ?? 0, MAX_RECORD_MS), notice, start, stop: () => finish(true), cancel: () => finish(false) };
}
