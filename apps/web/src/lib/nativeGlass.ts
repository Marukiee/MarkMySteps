import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isIosApp } from './native';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GlassGroup extends Box {
  id: string;
  items: (Box & { id: string; symbol: string; label: string })[];
}

interface MmsGlassPlugin {
  supported(): Promise<{ supported: boolean }>;
  set(options: { groups: GlassGroup[] }): Promise<void>;
  addListener(event: 'tap', fn: (e: { id: string }) => void): Promise<PluginListenerHandle>;
}

const MmsGlass = registerPlugin<MmsGlassPlugin>('MmsGlass');

/**
 * The floating buttons that get real Liquid Glass on the iPhone. Each group is
 * one capsule, the way iOS puts related controls together: the way back on
 * its own, the trip's tools side by side. Only buttons that stay put on the
 * screen: one that moves with the page would have to be followed every frame.
 */
const GROUPS: { id: string; selector: string; symbol?: string }[] = [
  { id: 'trip-back', selector: '.trip-detail .trip-fab-back' },
  { id: 'trip-tools', selector: '.trip-detail .trip-fabs > .trip-fab' },
  // Its chevron points down in the icon set and is turned up by CSS.
  { id: 'trip-backtop', selector: '.trip-backtop', symbol: 'chevron.up' },
];

/** The app's icon (Icon's `data-icon`) and the SF Symbol that says the same. */
const SYMBOLS: Record<string, string> = {
  'arrow-left': 'chevron.left',
  'chevron-up': 'chevron.up',
  share: 'square.and.arrow.up',
  map: 'map',
  gear: 'gearshape',
};

/**
 * iPhone: the buttons above are drawn natively in Liquid Glass, and the page's
 * own stay where they are, unseen, so a tap on the glass presses them. Covered
 * by a sheet or the photo viewer, or gone from the page, the glass goes too.
 */
export async function initNativeGlass(): Promise<void> {
  if (!isIosApp()) return;
  // The page's buttons are unseen from their first frame (tripdetail.css),
  // not from the moment the glass took their place: until then they showed in
  // the page's own style and were swapped out a moment later. Taken back on a
  // phone without the glass, long before a trip page is opened.
  const root = document.documentElement;
  root.classList.add('glass-native');
  const { supported } = await MmsGlass.supported().catch(() => ({ supported: false }));
  if (!supported) {
    root.classList.remove('glass-native');
    return;
  }

  const pressable = new Map<string, HTMLElement>();
  let sent = '';
  let queued = 0;

  const read = () => {
    queued = 0;
    pressable.clear();
    const groups: GlassGroup[] = [];
    for (const { id, selector, symbol: fixed } of GROUPS) {
      const items: GlassGroup['items'] = [];
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const icon = el.querySelector<SVGElement>('svg[data-icon]')?.dataset.icon;
        const symbol = fixed ?? (icon ? SYMBOLS[icon] : undefined);
        if (!symbol) continue;
        // On its way out: the glass leaves now, with its own animation.
        if (el.classList.contains('leaving')) continue;
        // Still popping in, so not yet where it ends up; animationend asks
        // again. Transitions are fine: the corners slide with the map.
        if (el.getAnimations().some((a) => a instanceof CSSAnimation && a.playState === 'running')) continue;
        // Unseen but still there to be pressed. Only once: setting a class
        // again is a mutation too, and this runs on every mutation.
        if (!el.classList.contains('glass-mirrored')) el.classList.add('glass-mirrored');
        const r = el.getBoundingClientRect();
        // Whatever is on top at its middle: the button itself, or a sheet,
        // scrim or viewer laid over it.
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (r.width === 0 || !top || !el.contains(top)) continue;
        const label = el.getAttribute('aria-label') ?? '';
        const key = `${id}:${label || icon}`;
        pressable.set(key, el);
        items.push({ id: key, symbol, label, x: r.left, y: r.top, w: r.width, h: r.height });
      }
      if (items.length === 0) continue;
      const x = Math.min(...items.map((i) => i.x));
      const y = Math.min(...items.map((i) => i.y));
      const right = Math.max(...items.map((i) => i.x + i.w));
      const bottom = Math.max(...items.map((i) => i.y + i.h));
      groups.push({ id, items, x, y, w: right - x, h: bottom - y });
    }
    const key = JSON.stringify(groups);
    if (key === sent) return;
    sent = key;
    void MmsGlass.set({ groups }).catch(() => undefined);
  };
  const schedule = () => {
    if (!queued) queued = requestAnimationFrame(read);
  };

  // The same signals the tab bar listens to; not `style`, which the map
  // writes on every frame of a scroll.
  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'aria-hidden', 'aria-label'],
  });
  for (const type of ['transitionend', 'animationend', 'popstate', 'resize']) {
    window.addEventListener(type, schedule, true);
  }
  void MmsGlass.addListener('tap', ({ id }) => pressable.get(id)?.click());
  schedule();
}
