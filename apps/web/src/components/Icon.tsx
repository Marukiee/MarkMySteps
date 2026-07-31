import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'arrow-left'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'plus'
  | 'minus'
  | 'download'
  | 'close'
  | 'gear'
  | 'plane'
  | 'car'
  | 'train'
  | 'bus'
  | 'boat'
  | 'walk'
  | 'pencil'
  | 'compass'
  | 'distance'
  | 'globe'
  | 'check'
  | 'dots'
  | 'pin'
  | 'trash'
  | 'archive'
  | 'camera'
  | 'lock'
  | 'play'
  | 'stop'
  | 'external'
  | 'share'
  | 'people'
  | 'person'
  | 'bell'
  | 'shield'
  | 'help'
  | 'question'
  | 'search'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'settings'
  | 'hourglass'
  | 'cloud-off';

// Single source of truth for line icons. 24×24 viewbox, 2px stroke,
// currentColor — so an icon inherits text color and sizes with `size`.
// WebViews render these reliably where glyph/emoji arrows look inconsistent.
const PATHS: Record<IconName, ReactNode> = {
  'arrow-left': (
    <>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </>
  ),
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  plane: (
    <path d="M17.8 19.2 16 11l3.5-3.5c.9-.9.9-2.4 0-3.3-.9-.9-2.4-.9-3.3 0L12.7 7.7 4.5 5.9c-.4-.1-.8 0-1 .3l-.4.4c-.4.4-.3 1 .1 1.3L9 12l-2.5 2.5H4l-1 1 3 1.5L7.5 21l1-1v-2.5L11 15l3.9 5.8c.3.4.9.5 1.3.1l.4-.4c.3-.3.4-.6.2-1Z" />
  ),
  car: (
    <>
      <path d="M5 13h14l-1.5-4.5A2 2 0 0 0 15.6 7H8.4a2 2 0 0 0-1.9 1.5L5 13Z" />
      <path d="M5 13h14v4a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-4Z" />
      <path d="M7.5 16h.01M16.5 16h.01" />
    </>
  ),
  train: (
    <>
      <rect x="6" y="4" width="12" height="12" rx="2.5" />
      <path d="M6 11h12" />
      <path d="M9 8h.01M15 8h.01" />
      <path d="m8 20 1.5-2M16 20l-1.5-2" />
    </>
  ),
  bus: (
    <>
      <rect x="5" y="4" width="14" height="12" rx="2" />
      <path d="M5 11h14" />
      <path d="M8 16v2M16 16v2" />
      <path d="M7.5 13.5h.01M16.5 13.5h.01" />
    </>
  ),
  boat: (
    <>
      <path d="M3 15h18l-2 4a2 2 0 0 1-1.8 1H6.8A2 2 0 0 1 5 19l-2-4Z" />
      <path d="M5 15V9a2 2 0 0 1 2-2h6l4 4v4" />
      <path d="M10 7V4" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4" r="1.5" />
      <path d="M11 21l2-6-2-2 1-4 3 2 2 1" />
      <path d="m11 13-2 2-2 4" />
    </>
  ),
  pencil: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5Z" />
    </>
  ),
  // Distance covered. A car said one mode of travel and a ruler said a straight
  // line on a desk; what the number measures is the way from where you set off
  // to where you ended up. Two points and the road between them, nothing else.
  // A measure between two ends, the way a ruler reads — the two dots and a
  // dashed curve between them were a lot of shapes for "how far".
  distance: (
    <>
      <path d="M4 6v12" />
      <path d="M20 6v12" />
      <path d="M4 12h16" />
      <path d="m8 9-3 3 3 3" />
      <path d="m16 9 3 3-3 3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  dots: (
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  play: <path d="M8 6.2 18 12 8 17.8Z" fill="currentColor" strokeWidth={2.5} />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <circle cx="17.5" cy="9.5" r="2.4" />
      <path d="M16 14.5a5 5 0 0 1 5 5.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4 3 6.5 7 9 4-2.5 7-5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7" />
      <path d="M12 17h.01" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14V14a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.3-4.3" />
    </>
  ),
  // Bare question mark — for buttons that draw their own round border, so the
  // glyph doesn't end up inside a second circle.
  question: (
    <>
      <path d="M9.2 9.3a2.9 2.9 0 1 1 4 2.7c-.85.45-1.2 1.05-1.2 2" />
      <path d="M12 17.6h.01" />
    </>
  ),
  hourglass: (
    <>
      <path d="M7 4h10M7 20h10" />
      <path d="M7 4c0 4 3 5 5 8 2-3 5-4 5-8" />
      <path d="M7 20c0-4 3-5 5-8 2 3 5 4 5 8" />
    </>
  ),
  'cloud-off': (
    <>
      <path d="M17.6 16.5H7a4 4 0 0 1-.6-7.95" />
      <path d="M8.9 6.4A5.2 5.2 0 0 1 17.5 9.6a3.6 3.6 0 0 1 2.9 4.3" />
      <path d="m3 3 18 18" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** Transport mode → icon, shared by planner + maps. */
export const MODE_ICON: Record<string, IconName> = {
  GROUND: 'car',
  FLIGHT: 'plane',
  TRAIN: 'train',
  BUS: 'bus',
  BOAT: 'boat',
};
