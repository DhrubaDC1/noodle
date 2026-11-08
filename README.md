# Thoughts

Capture a thought in seconds, find it later. Expo (JavaScript), SDK 58.

## Run it

```bash
npm install
npx expo start
```

For Expo Go, press `s` in the Expo terminal if needed to switch the QR code to Expo Go.

## Android development build

The development build lets the app use native libraries in phase 3. Confirm the current app works in it before adding `react-native-executorch`.

1. Sign in to an Expo account: `npx eas-cli@latest login` (skip if already signed in).
2. Build the installable APK: `npx eas-cli@latest build --platform android --profile development`. On the first build, accept or choose the Android application ID and let EAS generate an Android keystore. EAS may also link this project to your Expo account and update `app.json`.
3. When the build finishes, open its Expo build page on your Android phone. Tap **Install**, download the APK, and open it to install. Allow your browser to install apps if Android asks. Keep Expo Go installed; this is a separate app.
4. Connect phone and computer to the same Wi-Fi. Run `npx expo start --dev-client`, then scan the terminal QR code with your phone camera. Open the link in the installed development build. You can also open the build from your home screen and select the running development server.
5. Compare with Expo Go: launch without errors; capture a thought; find it in Search; edit, archive, and delete a test thought; open Map and Settings; set a reminder and verify its notification. If you use a Groq key, add it in Settings and verify analysis too. Data and the Groq key in Expo Go do not automatically move into the development build.

Do not add `react-native-executorch` until this phone check passes. Rebuild the development build whenever a native dependency or native app configuration changes; JavaScript changes only need the development server.

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
