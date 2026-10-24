import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isIosApp } from './native';

interface TabBarState {
  /** Which tab is on, as an index into the page's own tab bar; -1 for none. */
  active: number;
  visible: boolean;
  titles: string[];
  /** The accent the page is using right now, light or dark. */
  tint: string;
}

interface MmsTabBarPlugin {
  set(state: TabBarState): Promise<{ height: number }>;
  addListener(event: 'select', fn: (e: { index: number }) => void): Promise<PluginListenerHandle>;
}

const MmsTabBar = registerPlugin<MmsTabBarPlugin>('MmsTabBar');

/**
 * iPhone: the system's tab bar takes the place of the page's, so it is the
 * same Liquid Glass bar every other app has. The page's bar stays in the
 * layout, unseen, and keeps deciding: which tab is on, and whether there is a
 * bar at all. Tucked away inside a trip, gone from a page without one, or
 * covered by a sheet or the photo viewer: the system bar goes with it.
 */
export function initNativeTabBar(): void {
  if (!isIosApp()) return;
  document.documentElement.classList.add('native-tabbar');
  let sent = '';
  let queued = 0;

  const read = () => {
    queued = 0;
    const nav = document.querySelector<HTMLElement>('.bottomnav');
    const links = nav ? Array.from(nav.querySelectorAll<HTMLAnchorElement>('a')) : [];
    let visible = false;
    if (nav && !nav.classList.contains('tucked') && getComputedStyle(nav).display !== 'none') {
      const r = nav.getBoundingClientRect();
      // Whatever is on top in the middle of the bar: the bar itself, or a
      // sheet, scrim or viewer laid over it. Slid out of sight (typing) it is
      // below the screen and nothing is found there.
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(24, r.height / 2));
      visible = r.top < window.innerHeight && !!top && nav.contains(top);
    }
    const state: TabBarState = {
      active: links.findIndex((a) => a.classList.contains('active')),
      visible,
      titles: links.map((a) => a.textContent?.trim() ?? ''),
      tint: getComputedStyle(document.documentElement).getPropertyValue('--accent-ink').trim(),
    };
    const key = JSON.stringify(state);
    if (key === sent) return;
    sent = key;
    void MmsTabBar.set(state)
      .then(({ height }) => {
        // The page's own bar is exactly as tall, so everything that clears it
        // clears the system bar too.
        if (height > 0) document.documentElement.style.setProperty('--native-tabbar-h', `${height}px`);
      })
      .catch(() => undefined);
  };
  const schedule = () => {
    if (!queued) queued = requestAnimationFrame(read);
  };

  // Sheets and viewers mount and unmount; tabs and tucking change a class.
  // Not `style`: the map writes that on every frame of a scroll.
  new MutationObserver(schedule).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'aria-hidden'],
  });
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });
  for (const type of ['transitionend', 'animationend', 'focusin', 'focusout', 'popstate', 'resize']) {
    window.addEventListener(type, schedule, true);
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule);

  void MmsTabBar.addListener('select', ({ index }) => {
    // The page's own link, so a tap on the system bar is exactly a tap on it.
    document.querySelectorAll<HTMLAnchorElement>('.bottomnav a')[index]?.click();
  });
  schedule();
}
