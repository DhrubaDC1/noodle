# Noodle

Catch every thought. Find it again.

Noodle is a personal app for jotting down passing thoughts. It tags each one with AI, links it to earlier thoughts and lays them out on a map. The look is bright and playful, but every colour carries a meaning, and the details are drawn by hand rather than taken from a kit.

The full screens live on the **Noodle app UI** design canvas; this system is the source for its colours, type, shapes and parts.

## Principles

1. **Colour means something.** Each thought type owns one colour, used everywhere that type appears. The interface itself is ink and cream, so colour always tells you something.
2. **Things you touch look like stickers.** Interactive containers get a 2px `ink` outline and a hard `sticker` shadow. Content (thought cards) never does.
3. **Drawn, not assembled.** Icons and illustrations are drawn for Noodle, each with one small quirk.
4. **Saving never waits.** The interface always shows that a thought is safe before the AI is done with it ("Noodling on it…").

## Voice

Short, warm, a little playful, never cute at the cost of clarity.

| Do | Don't |
| --- | --- |
| What's on your noodle? | Enter your thought here |
| Noodling on it… | Processing with AI… |
| Your bowl is empty | No data found |
| Remind you Friday, 6 pm? | Reminder detected |
| Linked thoughts | AI-generated connections |

- Sentence case everywhere, including buttons.
- Buttons are verbs: Save, Remind me, Not now.
- Times are human: "Today, 11:40 am", "Mon 9 Nov, 10 am".
- No emoji in the interface; the illustrations do that job.

## Colour means something

| Type | Means | Full strength | Tint | Text on tint |
| --- | --- | --- | --- | --- |
| Idea | Something new to try | `idea` #FFC53D | `idea-tint` | `idea-text` |
| Project | Bigger things in progress | `project` #9580FF | `project-tint` | `project-text` |
| To-do | Things to get done | `todo` #FF6B4A | `todo-tint` | `todo-text` |
| Memory | Things to remember | `memory` #1FB89A | `memory-tint` | `memory-text` |
| Question | Things to find out | `question` #FF5FA2 | `question-tint` | `question-text` |

How to use them:

- **Full strength** fills type pills and map bubbles' borders, always with `label-ink` text on top. Full-strength colours are the same in light and dark.
- **Tint** is the background of a thought card, a filter chip or a map bubble of that type.
- **Text on tint** is for words in that type's colour: tags, chip labels, relation labels.
- **Never decorate with type colours.** A screen header, button or setting is ink, cream or neutral. The two exceptions: the `marker` highlight on search matches, and the five-dot "Noodling on it…" loader, which uses all five to say "any type".
- Colour is never the only signal: every pill and chip also carries the type's name and icon.

The neutral set: `bg`, `surface`, `sunken`, `text`, `muted`, `line`, `ink`, `on-ink`.

## Type

- **Bricolage Grotesque** (display) for the wordmark, screen titles, thought titles and section headings. Tight tracking, heavy weights (700-800).
- **Figtree** (sans) for everything else: thoughts, labels, buttons.
- Both are Google Fonts; load `Bricolage Grotesque` (opsz 12-96, 600-800) and `Figtree` (400-700).

## Shapes and sticker style

- Corners are generous: `radius-lg` (22px) for cards, `radius-md` (16px) for buttons, `radius-pill` for pills and chips.
- **Sticker style** = `outline` 2px solid `ink` + `sticker` shadow. Use it on: the compose box, the floating tab bar and action bar, the search field (`sticker-small`), settings groups, the reminder card, and the centre node on the map.
- Thought cards are flat tints with no outline, so the stickers stand out as the things you act on.
- A thought still being analysed has a 2px dashed `line` border on `surface`.

## Iconography

- 24px grid, 2.2px round strokes, round joins, `currentColor`.
- Each tab icon has one hand-drawn quirk: a squiggle under the Capture pencil, a glint in the Search lens, a noodle between the Map dots.
- Type icons, at 13px inside pills with a 2.6px stroke: Idea = bulb, Project = folder, To-do = tick, Memory = bookmark, Question = question mark.
- Icons sit in `sunken` tiles (34px, 11px corners) in Settings.

## Illustration

- Thick `ink` outlines (2.5px), flat fills in the type colours, no gradients, no faces.
- Simple objects with a food or kitchen wink: the empty noodle bowl with thought bubbles floating up, an alarm clock for reminders.
- One illustration per screen at most; they appear in empty states and suggestion cards.

## Logo

- The **noodle mark** is a squiggle carrying five dots, one per thought type, in their order along the noodle: idea, to-do, memory, question, project.
- The **wordmark** is "noodle" in Bricolage Grotesque 800, lowercase, letter-spacing -0.04em, set beside the mark.
- The app icon is the mark in cream on an ink rounded square; the alternate is an ink noodle on idea yellow.
- See the Logos assets. Keep clear space of one dot's width around the mark.

## Dark mode

- Ground becomes inky purple (`bg` #16141F), the `ink` outline flips to cream, and the sticker shadow becomes black.
- Full-strength type colours stay the same; tints darken and text-on-tint colours lighten.

## Accessibility

- All text pairs pass 4.5:1 in both themes, including `muted` on every tint.
- Touch targets are at least 44px; tabs are 54px tall.
- Pills always pair colour with a name and icon.
