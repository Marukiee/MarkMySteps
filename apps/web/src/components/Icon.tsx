import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'arrow-left'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'plus'
  | 'minus'
  | 'download'
  | 'close'
  | 'book'
  | 'calendar'
  | 'eye'
  | 'eye-off'
  | 'map'
  | 'locate'
  | 'frame'
  | 'sparkle'
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
  | 'bolt'
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
  'chevron-up': <path d="m6 15 6-6 6 6" />,
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
  // Seen from above and symmetrical about its own spine. The banking
  // silhouette it replaces leaned to one side, which reads as a mistake the
  // moment it sits in a row of other icons — or gets turned to follow a curve.
  plane: (
    <path d="M12 2c1.1 0 1.8 1.5 1.8 3.4v3.3l7.7 4.5v2.2l-7.7-2.4v4.2l2.8 1.9v1.9L12 19.9l-4.6 1.1v-1.9l2.8-1.9v-4.2L2.5 15.4v-2.2l7.7-4.5V5.4C10.2 3.5 10.9 2 12 2Z" />
  ),
  car: (
    <>
      {/* Side view, one outline for the whole body, and the sill drawn only
          where the wheels are not — nothing crosses anything, so a translucent
          copy of this shows no seams. */}
      <path d="M2.5 16.4V13.7c0-.6.36-1.14.92-1.36L6 11.2l2.2-2.9c.4-.53 1.03-.85 1.7-.85h4.2c.67 0 1.3.32 1.7.85l2.2 2.9 2.58 1.14c.56.22.92.76.92 1.36v2.7" />
      <path d="M6 11.2h12" />
      <path d="M12 7.45v3.75" />
      <path d="M2.5 16.4h2.6M9.1 16.4h5.8M18.9 16.4h2.6" />
      <circle cx="7.1" cy="16.5" r="2" />
      <circle cx="16.9" cy="16.5" r="2" />
    </>
  ),
  train: (
    <>
      {/* A carriage on rails: a rounded body with one wide window, the doors
          under it, and the track it stands on. The old one was a box with two
          dots that read as a washing machine at small sizes. */}
      <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5V14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
      <path d="M5.5 10.5h13" />
      <path d="M12 3v7.5" />
      <path d="M8.6 13.2h.01M15.4 13.2h.01" />
      {/* Seen head on, standing in front of it: the wheels are two short
          uprights coming straight down out of the body, not circles you would
          only see from the side. */}
      <path d="M8.6 16v3.4M15.4 16v3.4" />
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
      {/* Mid-stride, leaning into it, with a pack on the back and a pole — a
          walker rather than the stick figure it was. */}
      <circle cx="13.5" cy="3.8" r="1.8" />
      <path d="M13 7.4 10 9.6l-1 4" />
      <path d="M13 7.4h1.2l2.3 3.4 2 1.2" />
      <path d="m13 11.4-.6 4 2.6 5.3" />
      <path d="m12.4 15.4-3.2 1.5-1 4.3" />
      <path d="M18.4 8.6 20 21" />
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
  // A measure between two ends, the way a ruler reads — two dots joined by a
  // dashed curve were a lot of shapes for "how far".
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
  bolt: <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />,
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
  book: (
    <>
      <path d="M4 5.5A2 2 0 0 1 6 3.5h13v14H6a2 2 0 0 0-2 2Z" />
      <path d="M4 19.5a2 2 0 0 1 2-2h13v3H6a2 2 0 0 1-2-1Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M10.6 6.1A8.6 8.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3 3.6" />
      <path d="M6.3 7.6A16 16 0 0 0 2.5 12S6 18 12 18a8.9 8.9 0 0 0 3.5-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </>
  ),
  /* A folded paper map: the button that opens what the map is showing. */
  map: (
    <>
      <path d="M9 4.2 3.5 6.4v13.4L9 17.6l6 2.2 5.5-2.2V4.2L15 6.4Z" />
      <path d="M9 4.2v13.4M15 6.4v13.4" />
    </>
  ),
  /* Four corner brackets: fit the whole thing back into view. */
  frame: (
    <>
      <path d="M4 9V5.6A1.6 1.6 0 0 1 5.6 4H9" />
      <path d="M15 4h3.4A1.6 1.6 0 0 1 20 5.6V9" />
      <path d="M20 15v3.4a1.6 1.6 0 0 1-1.6 1.6H15" />
      <path d="M9 20H5.6A1.6 1.6 0 0 1 4 18.4V15" />
    </>
  ),
  /* Crosshair: take me to where I am. */
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z" />
      <path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z" />
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
