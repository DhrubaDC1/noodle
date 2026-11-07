# Thoughts

Capture a thought in seconds, find it later. Expo (JavaScript), SDK 58.

## Run it

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go. Phase 1 uses only modules that ship in Expo Go.
From phase 3 (on-device embeddings) you'll need a development build: `npx eas-cli@latest build --profile development`.

## What's here (phase 1)

- `app/(tabs)/index.js`: capture screen and recent thoughts
- `app/(tabs)/search.js`: keyword search (SQLite FTS5, prefix matching)
- `app/thought/[id].js`: edit, mark done, archive, delete
- `src/db.js`: schema, migrations and every query
- `src/ui.js`: colours and shared components

Deletes are soft (`deleted = 1`) and every row has a UUID and timestamps, so sync can be added later without a schema rewrite.

## Check

```bash
npm run selfcheck
```

Runs the database layer against Node's built-in SQLite (Node 22+).
