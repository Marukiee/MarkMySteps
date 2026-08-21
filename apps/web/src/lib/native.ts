import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Style, StatusBar } from '@capacitor/status-bar';
import { DEFAULT_SERVER_URL } from '../config';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Public web origin for building shareable links. In the APK
 * `window.location.origin` is the WebView's internal scheme (localhost), so
 * fall back to the configured public site URL.
 */
export function webBase(): string {
  return isNativeApp() ? DEFAULT_SERVER_URL : window.location.origin;
}

/** Native status bar: overlay the web content, icon colour follows the theme. */
export function initStatusBar(): void {
  if (!isNativeApp()) return;
  void StatusBar.setOverlaysWebView({ overlay: true });
  // Fully transparent bar so the page/globe shows through instead of a solid
  // white strip. (Some Android builds keep a background even when overlaying.)
  void StatusBar.setBackgroundColor({ color: '#00000000' }).catch(() => undefined);
  syncStatusBarTheme();
  // Re-sync whenever the app theme changes.
  window.addEventListener('mms-theme', syncStatusBarTheme);
  // Coming back from the background is where the transparency tends to get
  // dropped, so claim it again every time.
  document.addEventListener('resume', refreshStatusBar);
  window.addEventListener('focus', refreshStatusBar);
}

/**
 * Re-asserts the transparent overlay. Some Android builds hand the bar back a
 * background of their own after a resume or a theme change, which turns the
 * strip above the page into a solid block.
 */
export function refreshStatusBar(): void {
  if (!isNativeApp()) return;
  void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
  void StatusBar.setBackgroundColor({ color: '#00000000' }).catch(() => undefined);
  syncStatusBarTheme();
}

/**
 * Icon colour for a coloured banner running up under the bar. The bar itself
 * stays transparent — the page paints through it — so only the icons change.
 * Pass null to hand them back to the theme.
 */
export function setStatusBarTint(color: string | null, lightIcons = true): void {
  if (!isNativeApp()) return;
  if (color === null) {
    refreshStatusBar();
    return;
  }
  void StatusBar.setStyle({ style: lightIcons ? Style.Dark : Style.Light }).catch(() => undefined);
}

/**
 * Forces light status-bar icons while something dark fills the top of the
 * screen. The satellite map is the case that needs it: in the light theme the
 * icons are dark, and over aerial imagery they all but disappear. Pass false to
 * hand them back to the theme.
 */
export function setDarkBackdrop(on: boolean): void {
  darkBackdrop = on;
  syncStatusBarTheme();
}

let darkBackdrop = false;

function syncStatusBarTheme(): void {
  if (!isNativeApp()) return;
  const dark = document.documentElement.dataset.theme === 'dark' || darkBackdrop;
  // Style.Dark = light icons (for a dark UI); Style.Light = dark icons.
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
}

/**
 * Android back gesture: navigate back in history, exit the app at the root.
 *
 * A predictive-back version of this (the page shrinking under your finger) was
 * tried and removed: transforming the app makes every `position: fixed` element
 * — the tab bar in particular — scale along with it, which reads as the bar
 * jumping. Doing it properly needs the previous page rendered underneath, i.e. a
 * layered router, so plain navigation it is.
 */
export function initBackButton(): void {
  if (!isNativeApp()) return;
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== '/') {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });
}

/**
 * Publishes `--vh-stable`: the viewport height WITHOUT the on-screen keyboard.
 *
 * Android resizes the WebView when the keyboard opens, so plain `vh` units
 * shrink mid-interaction — the fixed map panel and the sheet under it jumped and
 * left a bar along the map's edge. We therefore only adopt a *larger* height (or
 * a rotation), never the keyboard's shrink.
 */
export function initStableViewport(): void {
  let stable = 0;
  const apply = (px: number) => {
    stable = px;
    document.documentElement.style.setProperty('--vh-stable', `${px}px`);
  };
  apply(window.innerHeight);

  window.addEventListener('resize', () => {
    if (window.innerHeight > stable) apply(window.innerHeight);
  });
  // A rotation legitimately makes the viewport shorter — re-measure from scratch
  // once the new size has settled.
  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => apply(window.innerHeight), 250);
  });
}

/**
 * Brings the focused field into view once the on-screen keyboard has settled.
 *
 * Android scrolls the field into view itself, but it does so against the
 * pre-keyboard viewport, so a field low on the page ends up right under the
 * keyboard or hidden behind a sticky map. Waiting for visualViewport to report
 * its new height and then centring the field in what's left is the only way to
 * land in the right place.
 */
/**
 * How much of the screen the on-screen keyboard is covering, as `--kb-inset`.
 *
 * Android does not agree with itself about what a keyboard does to a page: on
 * some builds the layout viewport shrinks (fixed things land above the keys),
 * on others it does not (fixed things stay behind them). Reading the visual
 * viewport gives the same answer either way, and a sheet that pads itself by
 * this much keeps its content reachable while its background still runs to the
 * bottom edge of the screen — no rounded corner floating above the keys.
 */
export function initKeyboardInset(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    // Under about 90px it is a browser bar, not a keyboard.
    document.documentElement.style.setProperty('--kb-inset', covered > 90 ? `${covered}px` : '0px');
  };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
}

export function initKeyboardScroll(): void {
  let target: HTMLElement | null = null;
  let timer = 0;

  const centre = () => {
    if (!target || !target.isConnected) return;
    const vv = window.visualViewport;
    const viewTop = vv?.offsetTop ?? 0;
    const viewBottom = viewTop + (vv?.height ?? window.innerHeight);
    // A pinned map covers the top of the page on a phone, so "visible" starts
    // below it, not at the top of the viewport.
    const usableTop = Math.max(viewTop, stickyTopBottom());
    const rect = target.getBoundingClientRect();

    // Only move when the field is actually out of reach — behind the keyboard,
    // or hidden under the map. A field you can already see stays put.
    const hiddenBelow = rect.bottom > viewBottom - 12;
    const hiddenAbove = rect.top < usableTop + 12;
    if (!hiddenBelow && !hiddenAbove) return;

    // Land it a little above the middle of the usable strip, leaving room for
    // the suggestion list that usually drops out of a search field.
    const wanted = usableTop + (viewBottom - usableTop) * 0.32;
    const delta = rect.top - wanted;
    if (Math.abs(delta) < 8) return;
    const scroller = scrollParent(target);
    if (scroller) scroller.scrollBy({ top: delta, behavior: 'smooth' });
    else window.scrollBy({ top: delta, behavior: 'smooth' });
  };

  /** Bottom edge of whatever is pinned across the top of the page, if anything. */
  function stickyTopBottom(): number {
    let bottom = 0;
    for (const node of document.querySelectorAll<HTMLElement>('.trip-map-panel, .plan-map')) {
      const position = getComputedStyle(node).position;
      if (position !== 'sticky' && position !== 'fixed') continue;
      const rect = node.getBoundingClientRect();
      if (rect.top <= 4 && rect.bottom > bottom) bottom = rect.bottom;
    }
    return bottom;
  }

  const schedule = () => {
    window.clearTimeout(timer);
    // The keyboard animates in; measuring before it settles gives the old size.
    timer = window.setTimeout(centre, 260);
  };

  document.addEventListener('focusin', (event) => {
    const el = event.target as HTMLElement | null;
    if (!el) return;
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el.isContentEditable) return;
    if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'button'].includes(el.type)) {
      return;
    }
    target = el;
    schedule();
  });

  document.addEventListener('focusout', () => {
    target = null;
    window.clearTimeout(timer);
  });

  // Fires when the keyboard actually opens or closes.
  window.visualViewport?.addEventListener('resize', schedule);
}

/** Nearest ancestor that actually scrolls vertically. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (
      (overflow === 'auto' || overflow === 'scroll') &&
      node.scrollHeight > node.clientHeight + 4
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** Current keyboard-independent viewport height in px. */
export function stableViewportHeight(): number {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--vh-stable'),
  );
  return Number.isFinite(v) && v > 0 ? v : window.innerHeight;
}

/** Opens a URL outside the WebView (system browser / matching app). */
export function openExternal(url: string): void {
  if (isNativeApp()) {
    window.open(url, '_system');
  } else {
    window.open(url, '_blank', 'noreferrer');
  }
}

const ONBOARDED_KEY = 'mms.onboarded';

export function isOnboarded(): boolean {
  return localStorage.getItem(ONBOARDED_KEY) === '1';
}

export function markOnboarded(): void {
  localStorage.setItem(ONBOARDED_KEY, '1');
}

export function resetOnboarding(): void {
  localStorage.removeItem(ONBOARDED_KEY);
}
