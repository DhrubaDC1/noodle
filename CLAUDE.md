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
- Groq model IDs live in one config constant (the main model is a preview model and may be retired).
- The Groq API key is read from `expo-secure-store`; never hardcode or commit keys.
- Shared colours and components are in `src/ui.js`; reuse them.
- Install packages with `npx expo install <pkg>`.

## Checks before calling a task done

- `npm run selfcheck` passes (database layer against Node's built-in SQLite). Extend it when `src/db.js` changes.
- `npx expo export --platform android` and `--platform ios` bundle without errors.
- Update the phase checklist in `docs/PLAN.md` when a phase is finished.
