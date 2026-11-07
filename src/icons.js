// Noodle icons and illustrations, drawn as SVG with paths copied from the
// docs/design/screens/*.dc.html mockups (24px grid, 2.2px round strokes,
// round joins; full-strength type colours never change with the theme).
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

const stroke = (color, w) => ({
  stroke: color,
  strokeWidth: w,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

// ---- Tab icons (with their hand-drawn quirks) ----

// Capture: pencil with a squiggle under it.
export const CaptureIcon = ({ size = 24, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.2)}>
    <Path d="M15 4l5 5-9.5 9.5H5.5v-5Z" />
    <Path d="M3 21.5c1.2-.9 2.3-.9 3.5 0s2.3.9 3.5 0" />
  </Svg>
);

// Search: lens with a glint inside.
export const SearchIcon = ({ size = 24, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.2)}>
    <Circle cx="10.5" cy="10.5" r="6.5" />
    <Path d="m20 20-4.8-4.8" />
    <Path d="M7.6 9.6c.6-1.5 2-2.3 3.6-2.1" />
  </Svg>
);

// Search field icon: same lens, no glint (as in the Search mockup).
export const FieldSearchIcon = ({ size = 20, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.4)}>
    <Circle cx="10.5" cy="10.5" r="6.5" />
    <Path d="m20 20-4.8-4.8" />
  </Svg>
);

// Map: two dots with a noodle between them, plus a third dot.
export const MapIcon = ({ size = 24, color, strokeWidth = 2.2 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, strokeWidth)}>
    <Circle cx="5" cy="17" r="2.4" />
    <Circle cx="19" cy="7" r="2.4" />
    <Circle cx="17" cy="19" r="1.6" />
    <Path d="M7.2 15.8c2.8-1.2 1.4-5.6 4.6-6.2s3.4 1.6 5.2-1" />
  </Svg>
);

// Settings: sliders.
export const SettingsIcon = ({ size = 24, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.2)}>
    <Path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <Circle cx="15" cy="7" r="2.2" />
    <Circle cx="9" cy="17" r="2.2" />
  </Svg>
);

// ---- Small interface icons ----

export const MicIcon = ({ size = 20, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.2)}>
    <Rect x="9" y="3" width="6" height="11" rx="3" />
    <Path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Svg>
);

export const ArrowRightIcon = ({ size = 16, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.6)}>
    <Path d="M5 12h13M13 6l6 6-6 6" />
  </Svg>
);

export const ClearIcon = ({ size = 18, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.4)}>
    <Path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);

export const ChevronIcon = ({ size = 22, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.4)}>
    <Path d="m15 18-6-6 6-6" />
  </Svg>
);

export const DoneIcon = ({ size = 22, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.2)}>
    <Path d="M20 6 9 17l-5-5" />
  </Svg>
);

// Not in a mockup: reopen = the Done arrow turned back round, same style.
export const ReopenIcon = ({ size = 22, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.2)}>
    <Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 3.6L3 8" />
    <Path d="M3 3v5h5" />
  </Svg>
);

export const ArchiveIcon = ({ size = 22, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.2)}>
    <Rect x="3" y="4" width="18" height="4" rx="1" />
    <Path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
  </Svg>
);

export const TrashIcon = ({ size = 22, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.2)}>
    <Path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);

export const BellIcon = ({ size = 13, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.4)}>
    <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
  </Svg>
);

// ---- Thought type icons (13px inside pills, 2.6px stroke per the brand book) ----

export const IdeaIcon = ({ size = 13, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.6)}>
    <Path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3Z" />
  </Svg>
);

export const ProjectIcon = ({ size = 13, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.6)}>
    <Path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
  </Svg>
);

export const TodoIcon = ({ size = 13, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.6)}>
    <Path d="m5 12 5 5L20 7" />
  </Svg>
);

export const MemoryIcon = ({ size = 13, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.6)}>
    <Path d="M6 3h12v18l-6-4-6 4Z" />
  </Svg>
);

export const QuestionIcon = ({ size = 13, color }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...stroke(color, 2.6)}>
    <Path d="M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.7V14M12 18h.01" />
  </Svg>
);

// ---- Brand and illustration ----

// The noodle mark: a squiggle carrying five dots, one per thought type in
// order along the noodle: idea, to-do, memory, question, project.
export const NoodleMark = ({ size = 36, color, bg }) => (
  <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <Path d="M6 26C6 14 15 14 15 22C15 30 25 30 25 20C25 12 34 10 34 18" {...stroke(color, 3.2)} />
    <Circle cx="6" cy="26" r="3.4" fill="#FFC53D" {...stroke(bg, 1.5)} />
    <Circle cx="10.5" cy="16.5" r="3.4" fill="#FF6B4A" {...stroke(bg, 1.5)} />
    <Circle cx="20" cy="27.8" r="3.4" fill="#1FB89A" {...stroke(bg, 1.5)} />
    <Circle cx="29.5" cy="13" r="3.4" fill="#FF5FA2" {...stroke(bg, 1.5)} />
    <Circle cx="34" cy="18" r="3.4" fill="#9580FF" {...stroke(bg, 1.5)} />
  </Svg>
);

// Empty noodle bowl with colourful thought bubbles floating up
// (the CaptureEmpty first-launch illustration).
export const Bowl = ({ width = 240, height = 180, color, surface }) => (
  <Svg width={width} height={height} viewBox="0 0 240 180" fill="none">
    <G {...stroke(color, 2.5)}>
      <Path d="M96 104C96 86 108 86 106 70C104 56 115 52 114 40" />
      <Path d="M120 104C122 90 133 88 129 72C127 64 133 58 133 51" />
      <Path d="M144 104C145 92 156 90 154 78" />
      <Path d="M100 16l-4-4M128 16l4-4M114 10V5" />
    </G>
    <G {...stroke(color, 4)}>
      <Path d="M170 58L210 112" />
      <Path d="M182 52L218 104" />
    </G>
    <Path
      d="M38 104H202C202 142 166 166 120 166C74 166 38 142 38 104Z"
      fill={surface}
      {...stroke(color, 2.5)}
    />
    <Path d="M50 120H190" stroke="#FF6B4A" strokeWidth="6" strokeLinecap="round" />
    <Path d="M62 134H178" stroke="#FFC53D" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 10" />
    <Path d="M32 104H208" {...stroke(color, 2.5)} />
    <G {...stroke(color, 2)}>
      <Circle cx="114" cy="30" r="10" fill="#FFC53D" />
      <Circle cx="78" cy="58" r="7" fill="#1FB89A" />
      <Circle cx="134" cy="45" r="6" fill="#9580FF" />
      <Circle cx="156" cy="72" r="7" fill="#FF6B4A" />
      <Circle cx="170" cy="28" r="8" fill="#FF5FA2" />
    </G>
  </Svg>
);
