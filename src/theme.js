// Noodle design tokens — the single source of values.
// Source: docs/design/system/tokens.json (+ the light/dark CSS variables
// inside each docs/design/screens/*.dc.html mockup). See docs/DESIGN.md:
// colour means something (one colour per thought type), stickers = 2px ink
// border + hard 0 4px 0 shadow, dark mode follows the system setting.
import { useColorScheme } from 'react-native';
import {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';

// Font identifier strings for `fontFamily` — load these with useFonts()
// (see fontAssets below) before any component hits the screen.
export const font = {
  bricolage700: 'BricolageGrotesque_700Bold',
  bricolage800: 'BricolageGrotesque_800ExtraBold',
  figtree400: 'Figtree_400Regular',
  figtree500: 'Figtree_500Medium',
  figtree600: 'Figtree_600SemiBold',
  figtree700: 'Figtree_700Bold',
};

// The actual TTF assets, keyed by the names they are registered under.
export const fontAssets = {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
};

// Colours, exactly as in the mockups' `light`/`dark` objects. Full-strength
// type colours and label-ink are the same in both themes.
export const light = {
  bg: '#FFFBF5',
  surface: '#FFFFFF',
  sunken: '#F6EFE4',
  text: '#1E1B2E',
  muted: '#6A6478',
  line: '#EADFCF',
  ink: '#1E1B2E',
  onInk: '#FFFBF5',
  stickerShadow: '#1E1B2E',
  labelInk: '#1E1B2E',
  idea: '#FFC53D',
  ideaTint: '#FFF1C7',
  ideaText: '#7A5200',
  project: '#9580FF',
  projectTint: '#EDE8FF',
  projectText: '#4B2FD6',
  todo: '#FF6B4A',
  todoTint: '#FFE3DB',
  todoText: '#B63212',
  memory: '#1FB89A',
  memoryTint: '#D5F5EC',
  memoryText: '#0B6E5B',
  question: '#FF5FA2',
  questionTint: '#FFE0EE',
  questionText: '#B01E62',
};

export const dark = {
  bg: '#16141F',
  surface: '#221F2E',
  sunken: '#2C2839',
  text: '#F6F2EA',
  muted: '#ABA4BA',
  line: '#3A3450',
  ink: '#F6F2EA',
  onInk: '#16141F',
  stickerShadow: '#000000',
  labelInk: '#1E1B2E',
  idea: '#FFC53D',
  ideaTint: '#3A2F12',
  ideaText: '#FFD66B',
  project: '#9580FF',
  projectTint: '#2A2350',
  projectText: '#C2B5FF',
  todo: '#FF6B4A',
  todoTint: '#3E1F18',
  todoText: '#FF9A80',
  memory: '#1FB89A',
  memoryTint: '#12352E',
  memoryText: '#5FE0C2',
  question: '#FF5FA2',
  questionTint: '#3F1A2C',
  questionText: '#FF8FC0',
};

// Type colours used at full strength never change with the theme.
export const labelInk = '#1E1B2E';

// Dark mode follows the system setting (app.json userInterfaceStyle: "automatic").
export function useTheme() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  return {
    dark: isDark,
    colors: isDark ? dark : light,
  };
}

// Text styles from tokens.json ("letterSpacing": "-0.04em" and friends are px).
export const type = {
  // Display — Bricolage Grotesque, tight tracking, heavy weights.
  wordmark: { fontFamily: font.bricolage800, fontSize: 30, lineHeight: 34, letterSpacing: -1.2 },
  screenTitle: { fontFamily: font.bricolage800, fontSize: 34, lineHeight: 38, letterSpacing: -1.02 },
  detailTitle: { fontFamily: font.bricolage800, fontSize: 32, lineHeight: 36, letterSpacing: -0.96 },
  emptyTitle: { fontFamily: font.bricolage800, fontSize: 26, lineHeight: 30, letterSpacing: -0.52 },
  cardTitle: { fontFamily: font.bricolage700, fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  sectionTitle: { fontFamily: font.bricolage700, fontSize: 18, lineHeight: 24, letterSpacing: -0.18 },
  // Text — Figtree for everything else.
  compose: { fontFamily: font.figtree500, fontSize: 18, lineHeight: 25 },
  body: { fontFamily: font.figtree400, fontSize: 17, lineHeight: 26 },
  row: { fontFamily: font.figtree600, fontSize: 16, lineHeight: 22 },
  snippet: { fontFamily: font.figtree400, fontSize: 14, lineHeight: 20 },
  meta: { fontFamily: font.figtree600, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: font.figtree700, fontSize: 12, lineHeight: 16 },
  tab: { fontFamily: font.figtree700, fontSize: 11, lineHeight: 14 },
};

export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 26 };

export const radius = { sm: 9, md: 16, lg: 22, xl: 26, pill: 999 };

// Sticker style: 2px ink border + hard drop shadow ("0 4px 0"). Pass
// `small` for the search field's lighter 0 3px 0 shadow.
export function sticker(colors, small = false) {
  return {
    borderWidth: 2,
    borderColor: colors.ink,
    boxShadow: `${small ? '0 3px 0' : '0 4px 0'} ${colors.stickerShadow}`,
  };
}
