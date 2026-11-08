# Thought Capture App: Plan

Source of truth: https://claude.ai/artifact/RqMHYS7zUEc5RtMVga8d3c (exported Nov 7, 2026). Update both if the plan changes.

## Overview

A personal Expo app (JavaScript only) where you jot a thought in seconds, and an LLM tags it and links it to earlier thoughts so you can find it later by search, topic or mind map.

Core loop:

1. **Capture.** The app opens to a text box. Saving is instant, works offline and never waits on the LLM.
2. **Analyze.** In the background, the LLM returns a title, a type, topics and any time mentioned.
3. **Connect.** An on-device embedding finds the most similar older thoughts; the LLM confirms which are truly related and names the link.
4. **Recall.** Keyword and meaning search, topic clusters, a focused mind map and a timeline.

## Decisions made

| Area | Decision | Note |
| --- | --- | --- |
| Audience | Just the owner now; public later | No choices that block a public release |
| LLM analysis | Groq `qwen/qwen3.8-27b`, called directly from the app | Groq *preview* model: keep the model ID in one config constant. $0.80 / $4.00 per 1M in/out tokens. OpenAI-compatible API at `https://api.groq.com/openai/v1` |
| Voice transcription | Groq `whisper-large-v3-turbo` | Same API key |
| Embeddings | On device: `react-native-executorch` (`download` + `createTextEmbedder`), English model all-MiniLM-L6-v2 | Needs New Architecture + a development build |
| Storage | SQLite on the phone, synced to Supabase later | Local-first, fully offline |
| Platforms | iOS and Android | iOS share-from-other-apps shows "Coming soon" |
| Capture | Typed text, voice, share (Android), reminders | Reminders are suggested by the LLM and confirmed by a tap |
| Language | English only | |
| API key | `expo-secure-store`, entered in Settings | Never bundled in code |

## Architecture

```
On the phone                                         Cloud
Capture screen --save--> SQLite (source of truth) <--sync (phase 6)--> Supabase
                              |
                         queues jobs
                              v
On-device embeddings <--embed-- Job queue (retries offline) --LLM--> Groq API
```

| Layer | Choice |
| --- | --- |
| Framework | Expo SDK 58 (JavaScript, no TypeScript), expo-router, EAS development build from phase 3 |
| Local database | expo-sqlite with FTS5 |
| On-device AI | react-native-executorch + its resource downloader |
| LLM and speech | Groq REST API via `fetch` |
| Secrets | expo-secure-store |
| Audio recording | expo-audio |
| Notifications | expo-notifications |
| Share target | expo-share-intent (Android only for now) |
| Mind map | react-native-svg, d3-force, react-native-gesture-handler |
| Backend (phase 6) | Supabase: auth, Postgres, Edge Functions |

## Data model

Every synced table: UUID `id`, `created_at` / `updated_at` (epoch ms), `deleted` flag (soft delete).

| Table | Columns | Notes |
| --- | --- | --- |
| `thoughts` | seq, id, text, source (typed/voice/share), status (open/done/archived), created_at, updated_at, deleted | Built in phase 1. `seq` is the stable integer rowid used by FTS |
| `analysis` | thought_id, title, type, tags (JSON), entities (JSON), reminder_at, model, analyzed_at | type: idea, project, todo, memory, question |
| `embeddings` | thought_id, vector (blob), model, created_at | `model` allows re-embedding after a model change |
| `links` | id, from_id, to_id, relation, reason, strength, created_at, deleted | relation e.g. same-project, follow-up, contradicts |
| `jobs` | id, thought_id, kind (analyze/embed/link/transcribe), attempts, next_try_at, last_error | Local only |
| `thoughts_fts` | text (+ title, tags from phase 2) | FTS5, external content on `thoughts` |

## How analysis and connections work

Saving a thought queues jobs that run in the background and retry with backoff when offline. The full history is never sent to the LLM.

1. **Embed (on device).** all-MiniLM-L6-v2 → 384-number vector.
2. **Analyze (Groq).** One call with a JSON schema returns title, type, tags, entities and an optional reminder time. Prompt includes the current date, timezone (Asia/Dhaka) and the 30 most-used tags. Reasoning low.
3. **Link.** Cosine similarity in JS over all vectors → top 8 above 0.45 (tune later). One Groq call with the new thought and those 8 returns which are related, the relation and a one-line reason.

Search merges FTS5 keyword matches and embedding similarity. Reminders: a "Remind me Fri 6 pm?" chip; tapping schedules a local notification. Brute-force similarity is fine up to ~10k thoughts.

## Screens

Tabs: Capture, Search, Map, Settings. Plus a Thought detail screen (text, tags, type, reminder chip, related thoughts with reasons, edit, archive).

Mind map is always focused: topic view (bubbles sized by count) by default, or thought view (one thought + links, 2 hops). Tap to re-centre.

## Build phases

- [x] **Phase 1: Capture and find.** Capture screen, list, detail, edit, done/archive/delete, FTS5 search, sync-ready schema.
- [x] **Phase 2: LLM analysis.** Settings with the Groq key, job queue, titles/types/tags, filters, reminder suggestions + notifications. Done when: a new thought is tagged within a few seconds, and offline thoughts catch up when back online.
- [x] **Phase 3: Connections.** On-device embeddings, related thoughts with reasons, search by meaning, back-fill. Done when: "budgeting app idea" finds a thought that only says "track my spending".
- [x] **Phase 4: Mind map.** Topic and thought views, pan, zoom, tap to re-centre.
- [ ] **Phase 5: Voice and share.** Mic + Groq Whisper; Android share target; iOS "Coming soon".
- [ ] **Phase 6: Sync.** Supabase sign-in, push/pull by `updated_at`, last write wins. Move the Groq call into a Supabase Edge Function before any public release.

## Risks

| Risk | Fallback |
| --- | --- |
| Groq retires the preview model | Change the one model constant |
| API key extractable once others use the app | Phase 6 Edge Function |
| Bad tags / wrong links | Everything editable; deleted links remembered so they aren't re-suggested |
| Embedding model download fails | Keyword search still works; jobs wait in the queue |
| Sync conflicts across devices | Last write wins per row; revisit before public launch |

Open question: the app's name.
