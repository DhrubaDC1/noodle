# Noodle design

The app is called **Noodle**. Every screen must match the designs in `docs/design/`. When code and design disagree, the design wins, unless it would break something in PLAN.md (then ask).

Sources (claude.ai, for the owner; Claude Code reads the files below instead):
- Design canvas "Noodle app UI": https://claude.ai/artifact/6xsYNp2vabv9F1wUHL2n7r
- Design system "Noodle": https://claude.ai/artifact/NyKpNZti456R1UL82LfLCf

## Files

| File | What it is |
| --- | --- |
| `design/system/README.md` | The brand book: principles, voice, colour rules, sticker style, icons, illustration. Read first. |
| `design/system/tokens.json` | Every colour (light + dark), text style, spacing step, radius, shadow and border. The single source of values. |
| `design/system/*.svg` | Noodle mark and app icon. |
| `design/screens/Brand.dc.html` | Brand board: logo, type colours, type, icons, small details. |
| `design/screens/Capture.dc.html` | Capture tab with thoughts (phase 1, then tags from phase 2) |
| `design/screens/CaptureEmpty.dc.html` | Capture tab on first launch: empty-bowl illustration |
| `design/screens/Search.dc.html` | Search: type filter chips, "Matching words" and "Similar in meaning" (phase 3) |
| `design/screens/Thought.dc.html` | Thought detail: tinted header, tags, reminder card (phase 2), linked thoughts (phase 3), action bar |
| `design/screens/MapTopics.dc.html` | Map, topic view (phase 4) |
| `design/screens/MapThought.dc.html` | Map, one-thought view (phase 4) |
| `design/screens/Settings.dc.html` | Settings. AI group shown signed in (Account, Sign out, Model); signed out it is one "Sign in · AI is off" row. Sync in phase 6 pass B |
| *(no mockup)* Sign in | Specified under "Sign in" below; built from the same parts as Capture and Settings |

The `.dc.html` files are HTML mockups at 390×844 with inline styles. Read them as the spec: layout, sizes, copy, icon paths. Colours are CSS variables named like the tokens in camelCase (`--projectTint` = `project-tint`); the `light`/`dark` objects at the bottom of each file hold the values. Ignore the `<x-dc>`, `<helmet>` and `DCLogic` wrapper markup.

## Rules that matter most

1. **Colour means something.** Each thought type owns one colour: idea yellow, project violet, to-do coral, memory teal, question pink. Use it only for that type: pill (full strength + `label-ink` text), card background (tint), coloured text (type-text). Everything else is ink, cream and neutrals.
2. **Sticker style** on things you act on: 2px `ink` border + hard `0 4px 0` shadow (compose box, tab bar, search field, settings groups, reminder card, centre map node). Never on thought cards.
3. **Type:** Bricolage Grotesque 700-800 for the wordmark and titles; Figtree for everything else. Wordmark is lowercase "noodle".
4. **Dark mode follows the system** (`useColorScheme`), using the dark token values.
5. **Copy:** use the designs' wording ("What's on your noodle?", "Noodling on it…", "Your bowl is empty").

## Sign in

Optional email-code sign-in (`app/sign-in.js`), a modal opened from the Capture hint or Settings. No mockup; it reuses the system:

- Ink noodle mark top left, close button (44px sunken circle) top right.
- Title in `screen-title` ("Switch on the AI", then "Check your email"), one muted `body` line under it.
- One sticker-small field (`radius-md`). Email step: Figtree 600, 18px. Code step: Bricolage 800, 30px, wide letter-spacing, centred, number pad, `oneTimeCode` autofill; submits itself at 6 digits.
- Primary button "Send code" / "Sign in" (ink, verb first); below it the quiet button "Send again in 42s" then "Send a new code", and a text link "Use a different email".
- Errors are one plain `meta` line in `text` colour under the field ("That code did not work. Try again."): no type colours.
- Signed out, Capture shows a muted underlined line under the compose box: "Sign in to switch on Noodle's AI" (44px tall, opens this screen). It replaces the old "Add your Groq key" hint.

The Groq key is never on the phone: the app signs in to Supabase and calls the `ai` Edge Function, which holds the key.

## React Native notes

- Put the tokens in one theme module (e.g. `src/theme.js`, replacing the colours in `src/ui.js`) exporting light and dark sets, and a `useTheme()` hook built on `useColorScheme()`.
- Fonts: load Bricolage Grotesque and Figtree with `expo-font` (the `@expo-google-fonts/*` packages or font files in `assets/fonts`); hold the splash screen until they load.
- Hard shadow: React Native's `boxShadow` style (New Architecture) accepts `'0 4px 0 #1E1B2E'` on iOS and Android. If it misbehaves, draw an ink View offset 4px behind the element.
- Icons and illustrations: `react-native-svg`, with the paths copied from the `.dc.html` files.
- The floating tab bar is a custom `tabBar` on Expo Router's `Tabs`.
- Search marker highlight: a yellow rounded `Text` background is enough; the gradient edges are optional.
- Touch targets stay ≥ 44px, as in the designs.
