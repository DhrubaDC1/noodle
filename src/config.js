// Public project settings, read from .env.local at bundle time (see .env.local.example). Safe to ship:
// the publishable key only lets a signed-in user call the "ai" function; the Groq key lives on the server.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const MAX_RECORD_MS = 120000;
