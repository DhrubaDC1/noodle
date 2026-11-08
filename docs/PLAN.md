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
| LLM analysis | Groq `qwen/qwen3.8-27b`, called by the Supabase Edge Function `ai` (never by the app) | Groq *preview* model: the model ID lives in `supabase/functions/ai/config.js`. $0.80 / $4.00 per 1M in/out tokens. OpenAI-compatible API at `https://api.groq.com/openai/v1` |
| Voice transcription | Groq `whisper-large-v3-turbo` | Same function (`transcribe` action), same server-side key |
| Embeddings | On device: `react-native-executorch` (`download` + `createTextEmbedder`), English model all-MiniLM-L6-v2 | Needs New Architecture + a development build |
| Storage | SQLite on the phone, optionally synced to Supabase | Local-first, fully offline. Sync is a separate switch in Settings (off until you turn it on), not part of signing in |
| Sync scope | Thoughts, analysis (title, type, tags, edits) and links sync. Embeddings, audio files, jobs and reminder notifications stay on each phone | Each phone embeds what it receives (cheap, and it stays tied to the model on that phone). A second phone merges by UUID: nothing is replaced unless the other copy is newer |
| Platforms | iOS and Android | iOS share-from-other-apps shows "Coming soon" |
| Capture | Typed text, voice, share (Android), reminders | Reminders are suggested by the LLM and confirmed by a tap |
| Language | English only | |
| Groq API key | Supabase secret `GROQ_API_KEY`, read only by the `ai` function | Not on the phone, not in the bundle. Older versions kept it in `expo-secure-store`; the app deletes that copy on launch |
| Sign-in | Supabase Auth, email one-time code (6 digits) | Optional: signed out, capture, keyword search and everything on the phone work; AI jobs wait. Session kept like Supabase's Expo guide (AES key in `expo-secure-store`). Sign-out keeps local thoughts |
| AI limits | 500 calls per user per UTC day, counted in the `ai_usage` table | Also: thought text 4000 chars, 8 link candidates, audio 5 MB. `AI_DAILY_CAP` secret overrides the cap |

## Architecture

```
On the phone                                         Cloud
Capture screen --save--> SQLite (source of truth) <--sync (phase 6)--> Supabase
                              |
                         queues jobs
                              v
On-device embeddings <--embed-- Job queue (retries offline) --JWT--> Edge Function "ai" --key--> Groq API
                                                                      (analyze / link / transcribe,
                                                                       daily cap in Postgres)
```

| Layer | Choice |
| --- | --- |
| Framework | Expo SDK 58 (JavaScript, no TypeScript), expo-router, EAS development build from phase 3 |
| Local database | expo-sqlite with FTS5 |
| On-device AI | react-native-executorch + its resource downloader |
| LLM and speech | Supabase Edge Function `ai` (`supabase/functions/ai/`, JavaScript) calling Groq; the app calls it with `fetch` and the user's JWT |
| Secrets | Supabase secrets (Groq key); `expo-secure-store` only holds the session's encryption key |
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
2. **Analyze (Groq, via the `ai` function).** One call with a JSON schema returns title, type, tags, entities and an optional reminder time. Prompt includes the current date, timezone (Asia/Dhaka) and the 30 most-used tags. Reasoning low.
3. **Link.** Cosine similarity in JS over all vectors → top 8 above 0.45 (tune later). One call to the function (`link` action) with the new thought and those 8 returns which are related, the relation and a one-line reason.

Search merges FTS5 keyword matches and embedding similarity. Reminders: a "Remind me Fri 6 pm?" chip; tapping schedules a local notification. Brute-force similarity is fine up to ~10k thoughts.

## How sync works

Off by default; Settings > Backup and sync > Sync my thoughts (needs sign-in). Runs in the background (`src/syncRunner.js`, logic in `src/sync.js`): a few seconds after a save or an AI result, when the app comes to the front, and when the network returns. Saving never waits for it.

- **Server:** tables `thoughts`, `analysis`, `links` in Supabase, one set of rows per user (row-level security, no deletes). Phones write only through the function `sync_push` (batches of up to 500 rows); it keeps a row only if its `updated_at` is newer than the stored one.
- **Push:** every row whose `updated_at` is past the saved cursor, oldest first, 200 per request. A deleted thought goes up as a tombstone with no text. Never sent: untranscribed voice notes, and rows without a real UUID.
- **Pull:** rows whose server-side `synced_at` is past the cursor (the server's clock, so a phone that was offline for a week still delivers its old edits), with 10 seconds of overlap. Applied in order thoughts, analysis, links; a remote row replaces the local one only if its `updated_at` is larger.
- **Receiving a thought:** it is embedded locally. Its analysis normally arrives with it; if not, this phone analyses it after a 10 minute wait, and cancels that if the other phone's analysis shows up first.
- **Links:** a re-analysis marks the old links `deleted = 2` (replaced) so the change syncs, and a returning pair is revived under its old id. `deleted = 1` is still "removed by you" and is remembered on every phone.
- **Account switch:** signing in as a different account sends this phone's data to that account from the start.
- **Tests:** `scripts/synccheck.mjs` (two phones and a fake server, part of `npm run selfcheck`) and `npm run sqlcheck` (the migrations in Postgres via PGlite, no Docker).

## Screens

Tabs: Capture, Search, Map, Settings. Plus a Thought detail screen (text, tags, type, reminder chip, related thoughts with reasons, edit, archive).

Mind map is always focused: topic view (bubbles sized by count) by default, or thought view (one thought + links, 2 hops). Tap to re-centre.

## Build phases

- [x] **Phase 1: Capture and find.** Capture screen, list, detail, edit, done/archive/delete, FTS5 search, sync-ready schema.
- [x] **Phase 2: LLM analysis.** Settings with the Groq key (since phase 6 pass A: sign-in and the `ai` function instead), job queue, titles/types/tags, filters, reminder suggestions + notifications. Done when: a new thought is tagged within a few seconds, and offline thoughts catch up when back online.
- [x] **Phase 3: Connections.** On-device embeddings, related thoughts with reasons, search by meaning, back-fill. Done when: "budgeting app idea" finds a thought that only says "track my spending".
- [x] **Phase 4: Mind map.** Topic and thought views, pan, zoom, tap to re-centre.
- [x] **Phase 5: Voice and share.** Mic + Groq Whisper; Android share target; iOS "Coming soon".
- [ ] **Phase 6: Sign-in, server-side AI and sync.**
  - [x] **Pass A: sign-in and the Edge Function.** Email-code sign-in, `ai` function (analyze, link, transcribe) holding the Groq key, daily cap, app jobs call the function, no key on the phone. Setup steps: `supabase/README.md`. Done when: you can sign in with an emailed code and new thoughts, links and voice notes are processed through the function. (Verified on an Android phone: email-code sign-in, analyze, link, voice transcription and sign-out keeping local thoughts. `supabase test db` for the cap SQL has not been run: it needs Docker.)
  - [x] **Pass B: sync.** Push/pull, last write wins, "Backup and sync" in Settings (on/off switch, status, sync now). How it works: "How sync works" below. Setup: run `npx supabase db push --remote` for the new migration. Not built: "Export a backup" (needs `expo-sharing`, a native module, so a new dev build).

## Risks

| Risk | Fallback |
| --- | --- |
| Groq retires the preview model | Change the one model constant |
| API key extractable once others use the app | Solved in phase 6 pass A: the key is a server secret; the daily cap bounds what one account can spend |
| Email code not arriving (Supabase's built-in mailer is rate limited) | Add custom SMTP in the Supabase dashboard before inviting others |
| Bad tags / wrong links | Everything editable; deleted links remembered so they aren't re-suggested |
| Embedding model download fails | Keyword search still works; jobs wait in the queue |
| Sync conflicts across devices | Last write wins per row, by each phone's own clock. A phone with a wrong clock can win or lose unfairly; revisit before public launch (server-assigned versions) |
| No way to delete the cloud copy from the app | Turning sync off stops new uploads only. Delete rows in the Supabase dashboard for now; a "Delete my cloud data" action belongs before any public release |
| Same link made on two phones gets two ids | The pair index keeps one row per phone; a removal on either phone is applied to the other |

Open question: the app's name.
