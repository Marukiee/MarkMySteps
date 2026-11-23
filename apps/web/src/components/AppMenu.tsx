import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';
import { haptic } from '../lib/haptics';
import './appmenu.css';

export interface MenuEntry {
  label: ReactNode;
  icon?: IconName;
  /** Red, for delete and leave. */
  danger?: boolean;
  /** A choice: true is the chosen one (filled, with a tick), false an option. */
  selected?: boolean;
  /** Choices of one kind (a group of only inline entries) sit side by side as
   *  connected buttons, the chosen one an accent pill. */
  inline?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** Open and close timings, the same as the native AppMenu (Menu.kt). */
const OPEN_MS = 240;
const CLOSE_MS = 220;
/** After a choice the menu waits a moment, so you see the pill move over. */
const PICK_HOLD_MS = 420;
export const MENU_CLOSE_MS = CLOSE_MS;
export const MENU_PICK_HOLD_MS = PICK_HOLD_MS;
const MARGIN = 12;

/**
 * The one ⋯ menu of the app, Material 3 Expressive's segmented menu as the
 * native apps draw it: rounded groups (28px at the outside, 10px where they
 * meet), items inset 4px with concentric corners (24px at the menu's edge, 6px
 * between), a fine edge and no shadow.
 *
 * It grows out of its own button: at the start the shape is exactly that
 * button (same box, fully round, in the button's colour), then it opens from
 * the button's top right corner into the whole menu, 240 ms emphasized. Closing
 * (a choice, Escape, a tap beside it, scrolling) folds it back into the button
 * in 220 ms. The button itself crossfades: it hands over to the menu in the
 * first part of opening and comes back in the last part of closing. All of it
 * runs on CSS transitions, so closing halfway through opening turns back from
 * where it is instead of starting over.
 */
export function AppMenu({
  anchor,
  open,
  onClose,
  groups,
  buttonColor,
  dark = false,
  minWidth = 200,
  header,
}: {
  /** The button it grows out of. */
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  groups: MenuEntry[][];
  /** The button's own fill, where the shape starts. Leave it out for a bare
   *  icon button: then no round fill ever shows. */
  buttonColor?: string;
  /** Dark tones, for a dark screen such as the photo viewer. */
  dark?: boolean;
  minWidth?: number;
  /** Something to read above the choices (whose account this is), in a
   *  group of its own. */
  header?: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(false);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Mount on open; on close, fold back and unmount once the motion is done.
  // A timer rather than transitionend: with reduced motion the end event is
  // not reliable, and the menu must never stay behind as an invisible layer.
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      haptic('light');
    } else if (mounted) {
      setExpanded(false);
      timer.current = window.setTimeout(() => {
        setMounted(false);
        setPlace(null);
        setStart(null);
      }, CLOSE_MS + 40);
    }
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Placed on its button (top on the button's top, or upwards with its bottom on the button's bottom; right edge on the button's
  // right edge), moved only as far as needed to stay on screen. The start
  // shape is the button's box within the menu, fully round.
  useLayoutEffect(() => {
    if (!mounted || !open || !anchor || !ref.current) return;
    const b = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(MARGIN, b.right - m.width), Math.max(MARGIN, vw - m.width - MARGIN));
    // Room below: its top on the button's top. No room (a card low on the page): it opens upwards with its
    // bottom on the button's bottom, so it still comes out of the button rather than from below it.
    const fits = b.top + m.height <= vh - MARGIN;
    const top = Math.min(
      Math.max(MARGIN, fits ? b.top : b.bottom - m.height),
      Math.max(MARGIN, vh - m.height - MARGIN),
    );
    setPlace({ left, top });
    const t = Math.max(0, b.top - top);
    const l = Math.max(0, b.left - left);
    const r = Math.max(0, left + m.width - b.right);
    const btm = Math.max(0, top + m.height - b.bottom);
    setStart(`inset(${t}px ${r}px ${btm}px ${l}px round ${b.height / 2}px)`);
  }, [mounted, open, anchor]);

  // One frame in the start shape, then the transition carries it open.
  useEffect(() => {
    if (!open || !start) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setExpanded(true)));
    return () => cancelAnimationFrame(id);
  }, [open, start]);

  // The button hands over to the menu: gone in the first 30% of opening, back
  // in the last 30% of closing, so its own fill never jumps back in a frame.
  useEffect(() => {
    if (!anchor) return;
    if (open) {
      anchor.style.transition = `opacity ${Math.round(OPEN_MS * 0.3)}ms linear`;
      anchor.style.opacity = '0';
    } else {
      anchor.style.transition = `opacity ${Math.round(CLOSE_MS * 0.3)}ms linear ${Math.round(CLOSE_MS * 0.7)}ms`;
      anchor.style.opacity = '';
      const id = window.setTimeout(() => {
        anchor.style.transition = '';
      }, CLOSE_MS + 40);
      return () => window.clearTimeout(id);
    }
  }, [open, anchor]);

  // A tap beside it, Escape, scrolling or resizing folds it away.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor?.contains(target)) return;
      closeRef.current();
      // A tap beside the menu only puts it away, as on the native apps: the
      // click that follows must not open the trip card under the finger too.
      const swallow = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      document.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => document.removeEventListener('click', swallow, true), 400);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    const away = (e: Event) => {
      if (ref.current?.contains(e.target as Node)) return;
      closeRef.current();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [open, anchor]);

  if (!mounted) return null;

  const shown = groups.filter((g) => g.length > 0);
  const style = {
    left: place?.left ?? -9999,
    top: place?.top ?? 0,
    minWidth,
    clipPath: expanded ? 'inset(0px 0px 0px 0px round 28px)' : start ?? undefined,
    '--menu-tint': buttonColor ?? 'transparent',
  } as CSSProperties;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={`app-menu ${expanded ? 'expanded' : ''} ${dark ? 'app-menu-dark' : ''} ${
        buttonColor ? 'tinted' : ''
      } ${place ? '' : 'measuring'}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="app-menu-content">
        {header && <div className="app-menu-group app-menu-head first">{header}</div>}
        {shown.map((entries, g) => {
          const inlines = entries.filter((e) => e.inline);
          const lines = entries.filter((e) => !e.inline);
          const first = g === 0 && !header;
          const last = g === shown.length - 1;
          return (
            <div
              key={g}
              className={`app-menu-group ${first ? 'first' : ''} ${last ? 'last' : ''}`}
            >
              {inlines.length > 0 && (
                <div className="app-menu-choices" role="group">
                  {inlines.map((e, i) => (
                    <button
                      key={i}
                      type="button"
                      role="menuitemradio"
                      aria-checked={!!e.selected}
                      disabled={e.disabled}
                      className={`app-menu-choice ${e.selected ? 'on' : ''}`}
                      onClick={() => {
                        if (e.selected) {
                          closeRef.current();
                          return;
                        }
                        haptic('light');
                        e.onClick();
                        window.setTimeout(() => closeRef.current(), PICK_HOLD_MS);
                      }}
                    >
                      {e.selected && <Icon name="check" size={16} strokeWidth={2.4} />}
                      <span>{e.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {lines.map((e, i) => {
                const on = e.selected === true;
                const topEdge = first && inlines.length === 0 && i === 0;
                const bottomEdge = last && i === lines.length - 1;
                return (
                  <button
                    key={i}
                    type="button"
                    role={e.selected === undefined ? 'menuitem' : 'menuitemradio'}
                    aria-checked={e.selected === undefined ? undefined : on}
                    disabled={e.disabled}
                    className={`app-menu-item ${on ? 'on' : ''} ${e.danger ? 'danger' : ''} ${
                      topEdge ? 'edge-top' : ''
                    } ${bottomEdge ? 'edge-bottom' : ''}`}
                    onClick={() => {
                      if (e.selected === false) haptic('light');
                      closeRef.current();
                      e.onClick();
                    }}
                  >
                    {e.icon && <Icon name={e.icon} size={20} />}
                    <span className="app-menu-label">{e.label}</span>
                    {on && <Icon name="check" size={18} strokeWidth={2.4} className="app-menu-tick" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
