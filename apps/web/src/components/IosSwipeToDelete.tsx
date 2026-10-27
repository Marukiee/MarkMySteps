import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { haptic } from '../lib/haptics';
import { t } from '../i18n';

export interface SwipeRowProps {
  onDelete: () => void;
  /** What the delete does, for the screen reader: "Stop verwijderen". */
  label: string;
  /** Long-pressing the row starts a reorder instead of a swipe. */
  onDragStart?: () => void;
  onDragMove?: (dy: number) => void;
  onDragEnd?: () => void;
  dragging?: boolean;
  /** Set while the delete is on its way; when it ends with the row still
   *  here, the server said no and the card comes back. */
  removing?: boolean;
  /** Read-only row: hand the card straight through, no gesture on it. */
  disabled?: boolean;
  children: ReactNode;
}

/** The row that is open now: opening another closes it, as in any iOS list. */
let closeOpenRow: (() => void) | null = null;

/** Between the card and its button, as iOS 27 draws it. */
const GAP_PX = 16;
/** The button's height; it does not grow with a taller card. */
const ACTION_PX = 27;
/** Dragged past this share of the card, letting go deletes without the tap. */
const FULL_FRACTION = 0.55;
/** How far ahead a flick counts, in seconds of its speed. */
const PROJECT_S = 0.12;

/**
 * Swipe to delete the way the iPhone does it, for the app on iOS.
 *
 * Only to the left. The card follows the finger and a red capsule appears in
 * the space it leaves. Let go past half the capsule and the row stays open, so
 * deleting takes a deliberate tap; drag on past half the card and the capsule
 * takes over the row, and letting go then deletes at once. Any touch elsewhere,
 * a tap on the card or a scroll puts an open row away again.
 *
 * Android keeps its own swipe (ComposeSwipeToDelete in TripPlanner): there the
 * row goes on release, in either direction.
 */
export function IosSwipeToDelete({
  onDelete,
  label,
  onDragStart,
  onDragMove,
  onDragEnd,
  dragging,
  removing,
  disabled,
  children,
}: SwipeRowProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);

  // Runs off the animation loop and writes to the DOM directly, as the Android
  // swipe does: a React render per frame of a drag is what makes it feel cheap.
  const anim = useRef({
    x: 0,
    v: 0,
    target: 0,
    stiffness: 0,
    damping: 0,
    /** 0 while the capsule keeps its text at the screen edge, 1 once a full
     *  swipe has it follow the card. */
    fill: 0,
    fillTarget: 0,
    raf: 0,
    last: 0,
    fling: null as null | { from: number; to: number; start: number; ms: number },
  });
  const ctl = useRef({ commit: () => {}, close: () => {} });
  const callbacks = useRef({ onDragStart, onDragMove, onDragEnd, onDelete });
  callbacks.current = { onDragStart, onDragMove, onDragEnd, onDelete };

  useEffect(() => {
    const box = boxRef.current;
    const fg = fgRef.current;
    const action = actionRef.current;
    const content = contentRef.current;
    if (!box || !fg || !action || !content) return;
    const a = anim.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let open = false;
    let natural = content.offsetWidth;
    let holdTimer: number | null = null;
    let swallowTimer: number | null = null;
    let swallowClick = false;
    const g = {
      startX: 0,
      startY: 0,
      base: 0,
      axis: 'none' as 'none' | 'x' | 'y' | 'ignore',
      mode: 'idle' as 'idle' | 'swipe' | 'drag',
      armed: false,
      wasOpen: false,
      lastX: 0,
      lastT: 0,
      prevX: 0,
      prevT: 0,
    };

    const cardWidth = () => fg.offsetWidth || 320;
    const openX = () => -(natural + GAP_PX);

    const paint = () => {
      fg.style.transform = a.x === 0 ? '' : `translateX(${a.x}px)`;
      const room = Math.min(-a.x - GAP_PX, cardWidth());
      if (room <= 0) {
        action.style.visibility = 'hidden';
        return;
      }
      action.style.visibility = 'visible';
      // Narrower than it is tall it would be a sliver: it grows as a dot first.
      const width = Math.max(room, ACTION_PX);
      action.style.width = `${width}px`;
      action.style.transform = `translateY(-50%) scale(${Math.min(1, room / ACTION_PX)})`;
      // Uncovered bit by bit, the text rides along with the card. Pulled wider
      // than it needs, it waits at the screen edge until a full swipe calls it
      // over to the card, the way UIKit's own rows do it.
      const spare = Math.max(0, width - natural);
      content.style.transform = spare > 0 ? `translateX(${spare * (1 - a.fill)}px)` : '';
      content.style.opacity = String(Math.min(1, Math.max(0, (room - natural * 0.4) / (natural * 0.6))));
    };

    const step = () => {
      const now = performance.now();
      const elapsed = Math.min(64, now - a.last);
      a.last = now;
      let moving = false;
      if (a.fling) {
        const p = Math.min(1, (now - a.fling.start) / a.fling.ms);
        const eased = 1 - Math.pow(1 - p, 3);
        a.x = a.fling.from + (a.fling.to - a.fling.from) * eased;
        if (p < 1) moving = true;
        else a.fling = null;
      } else if (a.stiffness > 0) {
        // Sub-stepped: a stiff spring is unstable at 60 Hz in one go.
        const steps = Math.max(1, Math.ceil((elapsed / 1000) * 240));
        const dt = elapsed / 1000 / steps;
        for (let i = 0; i < steps; i++) {
          a.v += (-a.stiffness * (a.x - a.target) - a.damping * a.v) * dt;
          a.x += a.v * dt;
        }
        if (Math.abs(a.x - a.target) < 0.25 && Math.abs(a.v) < 2) {
          a.x = a.target;
          a.v = 0;
          a.stiffness = 0;
        } else {
          moving = true;
        }
      }
      const towards = a.fillTarget - a.fill;
      if (Math.abs(towards) > 0.002) {
        a.fill += towards * (1 - Math.exp(-elapsed / 60));
        moving = true;
      } else {
        a.fill = a.fillTarget;
      }
      paint();
      a.raf = moving ? requestAnimationFrame(step) : 0;
    };

    const run = () => {
      if (a.raf) return;
      a.last = performance.now();
      a.raf = requestAnimationFrame(step);
    };

    /** dampingRatio 1 is no bounce at all, which is how iOS settles a row. */
    const springTo = (target: number, stiffness: number, dampingRatio: number) => {
      a.fling = null;
      a.target = target;
      if (reduced) {
        a.x = target;
        a.v = 0;
        a.stiffness = 0;
        a.fill = a.fillTarget;
      } else {
        a.stiffness = stiffness;
        a.damping = 2 * dampingRatio * Math.sqrt(stiffness);
      }
      run();
    };

    const cancelHold = () => {
      if (holdTimer) window.clearTimeout(holdTimer);
      holdTimer = null;
    };

    const setReachable = (yes: boolean) => {
      action.setAttribute('aria-hidden', String(!yes));
      action.tabIndex = yes ? 0 : -1;
    };

    const onOutsideTouch = (e: TouchEvent) => {
      if (!box.contains(e.target as Node)) close();
    };

    const onAnyScroll = () => close();

    const forget = () => {
      open = false;
      setReachable(false);
      document.removeEventListener('touchstart', onOutsideTouch, true);
      document.removeEventListener('scroll', onAnyScroll, true);
      if (closeOpenRow === close) closeOpenRow = null;
    };

    function close() {
      forget();
      a.fillTarget = 0;
      springTo(0, 520, 1);
    }

    const settleOpen = () => {
      if (closeOpenRow && closeOpenRow !== close) closeOpenRow();
      closeOpenRow = close;
      open = true;
      setReachable(true);
      document.addEventListener('touchstart', onOutsideTouch, true);
      document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
      a.fillTarget = 0;
      springTo(openX(), 520, 1);
    };

    /** Off it goes to the left, the capsule taking the row, and the list closes
     *  the gap while it leaves. */
    const commit = () => {
      forget();
      cancelHold();
      a.fillTarget = 1;
      a.v = 0;
      a.stiffness = 0;
      if (reduced) {
        a.x = -cardWidth() * 1.1;
        a.fill = 1;
        paint();
      } else {
        a.fling = { from: a.x, to: -cardWidth() * 1.1, start: performance.now(), ms: 240 };
        run();
      }
      callbacks.current.onDelete();
    };

    ctl.current = { commit, close };

    const onStart = (e: TouchEvent) => {
      // A row inside another row would otherwise move its parent along.
      e.stopPropagation();
      const touch = e.touches[0]!;
      g.startX = g.lastX = g.prevX = touch.clientX;
      g.startY = touch.clientY;
      g.lastT = g.prevT = e.timeStamp;
      g.axis = 'none';
      g.mode = 'idle';
      g.armed = a.fillTarget === 1;
      g.wasOpen = open;
      // Caught mid-flight, it carries on from where it is.
      a.fling = null;
      a.stiffness = 0;
      a.v = 0;
      g.base = a.x;
      natural = content.offsetWidth;
      if (!callbacks.current.onDragStart || open) return;
      cancelHold();
      // Hold still for a moment and the row comes up for reordering; move
      // first and it is a swipe or a scroll instead.
      holdTimer = window.setTimeout(() => {
        if (g.mode !== 'idle') return;
        g.mode = 'drag';
        haptic('long-press');
        callbacks.current.onDragStart?.();
      }, 380);
    };

    const onMove = (e: TouchEvent) => {
      e.stopPropagation();
      const touch = e.touches[0]!;
      const moveX = touch.clientX - g.startX;
      const moveY = touch.clientY - g.startY;
      if (g.mode === 'drag') {
        e.preventDefault();
        callbacks.current.onDragMove?.(moveY);
        return;
      }
      if (g.axis === 'none') {
        if (Math.abs(moveX) < 10 && Math.abs(moveY) < 10) return;
        cancelHold();
        if (Math.abs(moveX) <= Math.abs(moveY)) {
          g.axis = 'y';
          // Scrolling the list puts an open row away, here too.
          if (open) close();
          return;
        }
        // Nothing is waiting on the left: a closed row stays put.
        if (g.base === 0 && moveX > 0) {
          g.axis = 'ignore';
          return;
        }
        g.axis = 'x';
        g.mode = 'swipe';
      }
      if (g.axis !== 'x') return;
      e.preventDefault();
      g.prevX = g.lastX;
      g.prevT = g.lastT;
      g.lastX = touch.clientX;
      g.lastT = e.timeStamp;
      a.x = Math.min(0, g.base + moveX);
      const armed = -a.x > cardWidth() * FULL_FRACTION;
      if (armed !== g.armed) {
        g.armed = armed;
        a.fillTarget = armed ? 1 : 0;
        haptic(armed ? 'threshold-on' : 'threshold-off');
      }
      if (a.raf) return;
      paint();
      if (a.fill !== a.fillTarget) run();
    };

    const onEnd = (e: TouchEvent) => {
      e.stopPropagation();
      cancelHold();
      if (g.mode === 'drag') {
        g.mode = 'idle';
        callbacks.current.onDragEnd?.();
        return;
      }
      const swiped = g.mode === 'swipe';
      g.mode = 'idle';
      if (!swiped) {
        // A tap on an open card only closes it: the nights buttons under the
        // finger are not what was meant.
        if (g.wasOpen && g.axis === 'none' && fg.contains(e.target as Node)) {
          swallowClick = true;
          if (swallowTimer) window.clearTimeout(swallowTimer);
          swallowTimer = window.setTimeout(() => (swallowClick = false), 400);
          close();
        }
        return;
      }
      if (g.armed) {
        commit();
        return;
      }
      const dt = g.lastT - g.prevT;
      const speed = dt > 0 && e.timeStamp - g.lastT < 80 ? ((g.lastX - g.prevX) / dt) * 1000 : 0;
      // The spring carries on at the finger's speed instead of starting cold.
      a.v = speed;
      if (a.x + speed * PROJECT_S < openX() / 2) settleOpen();
      else close();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!swallowClick || !fg.contains(e.target as Node)) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    };

    box.addEventListener('touchstart', onStart, { passive: true });
    box.addEventListener('touchmove', onMove, { passive: false });
    box.addEventListener('touchend', onEnd);
    box.addEventListener('touchcancel', onEnd);
    box.addEventListener('click', onClickCapture, true);
    return () => {
      box.removeEventListener('touchstart', onStart);
      box.removeEventListener('touchmove', onMove);
      box.removeEventListener('touchend', onEnd);
      box.removeEventListener('touchcancel', onEnd);
      box.removeEventListener('click', onClickCapture, true);
      forget();
      cancelHold();
      if (swallowTimer) window.clearTimeout(swallowTimer);
      if (a.raf) cancelAnimationFrame(a.raf);
      a.raf = 0;
    };
  }, [disabled]);

  // Refused by the server: the row stayed, so its card comes back.
  const wasRemoving = useRef(false);
  useEffect(() => {
    if (wasRemoving.current && !removing) ctl.current.close();
    wasRemoving.current = !!removing;
  }, [removing]);

  if (disabled) return <>{children}</>;

  return (
    <div className="swipe-row ios-swipe" ref={boxRef} data-dragging={dragging}>
      <button
        type="button"
        ref={actionRef}
        className="ios-swipe-action"
        aria-label={label}
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => ctl.current.commit()}
      >
        <span className="ios-swipe-action-content" ref={contentRef}>
          <Icon name="trash" size={14} />
          {t('common.delete')}
        </span>
      </button>
      <div className="swipe-fg" ref={fgRef}>
        {children}
      </div>
      {/* An iPad with a trackpad has no swipe either. */}
      <button type="button" className="swipe-x" aria-label={label} onClick={onDelete}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
