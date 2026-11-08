// Function-side settings. The app never sees the Groq key or Groq's URL.
// The main model is a Groq preview model and may be retired: change CHAT_MODEL here and redeploy.
export const CHAT_MODEL = 'qwen/qwen3.8-27b';
export const STT_MODEL = 'whisper-large-v3-turbo';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const TIMEZONE = 'Asia/Dhaka';
export const DEFAULT_DAILY_CAP = 500; // calls per user per UTC day; override with the AI_DAILY_CAP secret
export const CHAT_TIMEOUT_MS = 20000;
export const STT_TIMEOUT_MS = 60000;
