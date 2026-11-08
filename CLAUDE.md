# Thoughts app

Personal thought-capture app: type a thought, an LLM tags it and links it to earlier ones, find it later by search or mind map. Full plan, decisions and phases: @docs/PLAN.md

@AGENTS.md

## Project rules (these override AGENTS.md where they differ)

- **JavaScript only.** No TypeScript, no `.ts`/`.tsx` files, skip `tsc`.
- Routes live in `app/` (not `src/app/`). Non-route code lives in `src/`.
- All SQLite access goes through `src/db.js`; screens get the db with `useSQLiteContext()` and pass it in.
- Schema changes: bump `PRAGMA user_version` with a new migration step in `migrate()`; never edit an applied step.
- Keep every table sync-ready: UUID `id` (`expo-crypto` `randomUUID`), `created_at`/`updated_at` in epoch ms, soft delete via `deleted = 1`.
- Saving a thought must never wait on the network. LLM and embedding work goes through the background job queue.
- The Groq key lives only as the Supabase secret `GROQ_API_KEY`; the app never holds it. The app calls the `ai` Edge Function (`supabase/functions/ai/`) with the user's JWT via `src/ai.js`. Never hardcode or commit keys.
- Groq model IDs live in one place: `supabase/functions/ai/config.js` (the main model is a preview model and may be retired).
- Signing in is optional. Signed out, capture, keyword search and everything local keep working and AI jobs wait quietly. Sign-out never deletes local thoughts.
- Supabase CLI config, migrations, templates, the function and its tests live in `supabase/` (JavaScript, not TypeScript). The project URL and publishable key come from `.env.local` as `EXPO_PUBLIC_SUPABASE_*` (gitignored; template `.env.local.example`).
- Sync is opt-in (Settings switch), runs only in the background, and never blocks saving. Its SQL lives in `src/db.js`, its logic in `src/sync.js` (no React Native imports), its trigger in `src/syncRunner.js`. Every synced table needs `updated_at`, and every writer must bump it. Embeddings, audio, jobs and reminder state never sync.
- `supabase/functions/ai/core.js` is shared by the function and the app (limits and validators only, no Deno or model IDs); keep it free of imports.
- Shared tokens (colours, type, spacing, stickers) live in `src/theme.js`; shared components in `src/ui.js`; icons in `src/icons.js` — reuse them.
- **Every screen must match `docs/DESIGN.md` and the mockups in `docs/design/` — when code and design disagree, the design wins.**
- Install packages with `npx expo install <pkg>`.

## Checks before calling a task done

- `npm run selfcheck` passes (database layer against Node's built-in SQLite, plus the AI request/response checks). Extend it when `src/db.js`, `src/ai.js` or `supabase/functions/ai/core.js` change.
- `npm run test:function` passes when `supabase/functions/ai/` changes. `npm run sqlcheck` passes when `supabase/migrations/` change (Postgres via PGlite, no Docker; `npx supabase test db` is the optional check on the real stack).
- `npx expo export --platform android` and `--platform ios` bundle without errors.
- Update the phase checklist in `docs/PLAN.md` when a phase is finished.
